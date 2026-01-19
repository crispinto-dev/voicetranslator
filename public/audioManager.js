export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.microphone = null;
    this.processor = null;
    this.gainNode = null;
    this.isPlaying = false;
    this.originalGain = 1.0;
    this.duckedGain = 0.1;
    this.isFileMode = false;
    this.fileAudioBuffer = null;
    this.fileSourceNode = null;
  }

  async initialize() {
    try {
      // STEP 1: Enumerate all available audio devices
      console.log('==========================================');
      console.log('🎤 ENUMERATING ALL AUDIO DEVICES:');
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter(device => device.kind === 'audioinput');

      console.log(`Found ${audioInputs.length} audio input devices:`);
      audioInputs.forEach((device, index) => {
        console.log(`  [${index}] ${device.label || 'Unknown Device'}`);
        console.log(`      deviceId: ${device.deviceId}`);
        console.log(`      groupId: ${device.groupId}`);
      });
      console.log('==========================================');

      // STEP 2: Get microphone access
      console.log('🎤 Requesting microphone access...');
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // STEP 3: Identify which device is actually being used
      const audioTrack = this.mediaStream.getAudioTracks()[0];
      console.log('==========================================');
      console.log('✅ MICROPHONE ACCESS GRANTED!');
      console.log('🔊 CURRENTLY USING DEVICE:');
      console.log(`  Label: ${audioTrack.label}`);
      console.log(`  Device ID: ${audioTrack.getSettings().deviceId}`);
      console.log(`  Sample Rate: ${audioTrack.getSettings().sampleRate} Hz`);
      console.log(`  Channel Count: ${audioTrack.getSettings().channelCount}`);
      console.log(`  Echo Cancellation: ${audioTrack.getSettings().echoCancellation}`);
      console.log(`  Noise Suppression: ${audioTrack.getSettings().noiseSuppression}`);
      console.log(`  Auto Gain Control: ${audioTrack.getSettings().autoGainControl}`);
      console.log('==========================================');

      // Create audio context with constraint-free initialization
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Create audio nodes
      this.microphone = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.originalGain;

      // Create script processor for audio data (deprecated but widely supported)
      const bufferSize = 4096;
      this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      // Connect nodes
      this.microphone.connect(this.gainNode);
      this.gainNode.connect(this.processor);

      // Connect to a silent destination to keep the processor active
      const silentNode = this.audioContext.createGain();
      silentNode.gain.value = 0;
      this.processor.connect(silentNode);
      silentNode.connect(this.audioContext.destination);

      console.log('Audio initialized successfully');
      console.log('AudioContext sample rate:', this.audioContext.sampleRate);
      console.log('Processor buffer size:', bufferSize);
      return true;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      throw error;
    }
  }

  onAudioData(callback) {
    if (this.processor) {
      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const sampleRate = e.inputBuffer.sampleRate;

        // Resample to 24kHz for OpenAI Realtime API if needed
        let processedData = inputData;
        if (sampleRate !== 24000) {
          const resampleRatio = 24000 / sampleRate;
          const newLength = Math.floor(inputData.length * resampleRatio);
          processedData = new Float32Array(newLength);

          for (let i = 0; i < newLength; i++) {
            const srcIndex = i / resampleRatio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
            const fraction = srcIndex - srcIndexFloor;

            processedData[i] = inputData[srcIndexFloor] * (1 - fraction) +
                               inputData[srcIndexCeil] * fraction;
          }
        }

        // Convert Float32Array to Int16Array for OpenAI Realtime API (PCM16)
        const int16Data = new Int16Array(processedData.length);
        for (let i = 0; i < processedData.length; i++) {
          const s = Math.max(-1, Math.min(1, processedData[i]));
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        callback(int16Data);
      };
    }
  }

  async playAudioBuffer(audioData) {
    try {
      console.log(`[AudioManager] playAudioBuffer called with ${audioData.length} samples`);

      // Duck the microphone while playing
      this.duckMicrophone();

      if (!this.audioContext) {
        console.log('[AudioManager] Initializing audio context');
        await this.initialize();
      }

      // Ensure audio context is running
      if (this.audioContext.state === 'suspended') {
        console.log('[AudioManager] Resuming suspended audio context');
        await this.audioContext.resume();
      }

      // Create a new audio context for playback with proper sample rate (24kHz to match OpenAI Realtime API)
      const playbackContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000
      });
      console.log(`[AudioManager] Created playback context with sample rate: ${playbackContext.sampleRate}`);

      // Convert Int16Array to Float32Array
      const float32Data = new Float32Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        float32Data[i] = audioData[i] / (audioData[i] < 0 ? 0x8000 : 0x7FFF);
      }
      console.log(`[AudioManager] Converted to Float32: ${float32Data.length} samples`);

      // Check audio levels (using loop to avoid stack overflow)
      let maxValue = 0;
      let sumValue = 0;
      for (let i = 0; i < float32Data.length; i++) {
        const absVal = Math.abs(float32Data[i]);
        if (absVal > maxValue) maxValue = absVal;
        sumValue += absVal;
      }
      const avgValue = sumValue / float32Data.length;
      console.log(`[AudioManager] Audio levels: max=${maxValue.toFixed(4)}, avg=${avgValue.toFixed(4)}`);

      // Create audio buffer with 24kHz sample rate (OpenAI Realtime API PCM16 format)
      const audioBuffer = playbackContext.createBuffer(1, float32Data.length, 24000);
      audioBuffer.getChannelData(0).set(float32Data);
      console.log(`[AudioManager] Audio buffer created: duration=${audioBuffer.duration.toFixed(2)}s`);

      // Create gain node to boost volume if needed
      const gainNode = playbackContext.createGain();

      // Calculate dynamic gain based on max value
      let gainValue = 1.0;
      if (maxValue > 0 && maxValue < 0.1) {
        // Audio is very quiet, boost significantly
        gainValue = Math.min(50, 0.5 / maxValue); // Target 0.5 peak volume
      } else if (maxValue < 0.5) {
        gainValue = 10.0;
      }

      gainNode.gain.value = gainValue;
      console.log(`[AudioManager] Gain set to: ${gainNode.gain.value.toFixed(1)} (max audio level was ${maxValue.toFixed(4)})`);

      // Create source and play
      const source = playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      gainNode.connect(playbackContext.destination);

      this.isPlaying = true;

      source.onended = () => {
        console.log('[AudioManager] Audio playback ended');
        this.isPlaying = false;
        this.unduckMicrophone();
        playbackContext.close();
      };

      console.log('[AudioManager] Starting audio playback...');
      source.start(0);
      console.log('[AudioManager] Audio playback started successfully');
    } catch (error) {
      console.error('Error playing audio:', error);
      this.isPlaying = false;
      this.unduckMicrophone();
      throw error;
    }
  }

  duckMicrophone() {
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(this.duckedGain, this.audioContext.currentTime);
      console.log('Microphone ducked');
    }
  }

  unduckMicrophone() {
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(this.originalGain, this.audioContext.currentTime);
      console.log('Microphone restored');
    }
  }

  async loadAudioFile(file) {
    try {
      console.log(`[AudioManager] Loading audio file: ${file.name}`);

      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();

      // Create audio context if not exists
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      // Decode audio data
      this.fileAudioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.isFileMode = true;

      console.log(`[AudioManager] File loaded successfully:`);
      console.log(`  Duration: ${this.fileAudioBuffer.duration.toFixed(2)}s`);
      console.log(`  Sample Rate: ${this.fileAudioBuffer.sampleRate} Hz`);
      console.log(`  Channels: ${this.fileAudioBuffer.numberOfChannels}`);

      return true;
    } catch (error) {
      console.error('[AudioManager] Error loading audio file:', error);
      this.isFileMode = false;
      throw error;
    }
  }

  startFilePlayback(callback, onComplete) {
    if (!this.fileAudioBuffer) {
      console.error('[AudioManager] No audio file loaded');
      return;
    }

    console.log('[AudioManager] Starting file playback for processing');
    console.log(`[AudioManager] Buffer: ${this.fileAudioBuffer.duration.toFixed(2)}s, ${this.fileAudioBuffer.sampleRate}Hz, ${this.fileAudioBuffer.numberOfChannels} channels`);

    // Get the audio data from the buffer (use first channel for mono)
    const originalData = this.fileAudioBuffer.getChannelData(0);
    const originalSampleRate = this.fileAudioBuffer.sampleRate;
    const targetSampleRate = 24000;

    // Resample to 24kHz for OpenAI Realtime API
    console.log(`[AudioManager] Resampling from ${originalSampleRate}Hz to ${targetSampleRate}Hz`);
    const resampleRatio = targetSampleRate / originalSampleRate;
    const resampledLength = Math.floor(originalData.length * resampleRatio);
    const resampledData = new Float32Array(resampledLength);

    for (let i = 0; i < resampledLength; i++) {
      const srcIndex = i / resampleRatio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, originalData.length - 1);
      const fraction = srcIndex - srcIndexFloor;
      resampledData[i] = originalData[srcIndexFloor] * (1 - fraction) +
                         originalData[srcIndexCeil] * fraction;
    }

    // Convert to Int16 PCM
    const int16Data = new Int16Array(resampledLength);
    for (let i = 0; i < resampledLength; i++) {
      const s = Math.max(-1, Math.min(1, resampledData[i]));
      int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    console.log(`[AudioManager] Processed audio: ${int16Data.length} samples (${(int16Data.length / targetSampleRate).toFixed(2)}s at 24kHz)`);

    // Send audio in chunks simulating real-time streaming
    // OpenAI expects chunks similar to microphone input
    const chunkSize = 2048; // samples per chunk (about 85ms at 24kHz)
    const chunkDurationMs = (chunkSize / targetSampleRate) * 1000;
    let offset = 0;
    let chunkCount = 0;

    this.filePlaybackInterval = setInterval(() => {
      if (offset >= int16Data.length) {
        // All audio sent
        clearInterval(this.filePlaybackInterval);
        this.filePlaybackInterval = null;
        console.log(`[AudioManager] File playback completed: sent ${chunkCount} chunks`);
        if (onComplete) {
          onComplete();
        }
        return;
      }

      // Extract chunk
      const end = Math.min(offset + chunkSize, int16Data.length);
      const chunk = int16Data.slice(offset, end);

      callback(chunk);

      chunkCount++;
      if (chunkCount % 50 === 0) {
        const progress = ((offset / int16Data.length) * 100).toFixed(1);
        console.log(`[AudioManager] Sent ${chunkCount} chunks (${progress}% complete)`);
      }

      offset = end;
    }, chunkDurationMs);

    console.log(`[AudioManager] Started streaming: ${Math.ceil(int16Data.length / chunkSize)} chunks, ${chunkDurationMs.toFixed(1)}ms interval`);
  }

  stop() {
    // Stop file playback interval if active
    if (this.filePlaybackInterval) {
      clearInterval(this.filePlaybackInterval);
      this.filePlaybackInterval = null;
    }

    // Stop file source if in file mode
    if (this.fileSourceNode) {
      this.fileSourceNode.stop();
      this.fileSourceNode.disconnect();
      this.fileSourceNode = null;
    }

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
    }

    if (this.microphone) {
      this.microphone.disconnect();
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Don't close audio context in file mode, just reset the flag
    if (this.isFileMode) {
      this.isFileMode = false;
      this.fileAudioBuffer = null;
    } else if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
