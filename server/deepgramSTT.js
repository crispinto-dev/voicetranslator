import { createClient } from '@deepgram/sdk';

export class DeepgramSTTHandler {
  constructor(apiKey) {
    this.deepgram = createClient(apiKey);
    this.connection = null;
  }

  async startStreaming(onTranscript, onError) {
    try {
      this.connection = this.deepgram.listen.live({
        model: 'nova-2',
        language: 'it',
        smart_format: true,
        interim_results: true,
        utterance_end_ms: 1000,
        vad_events: true,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
        endpointing: 300
      });

      this.connection.on('open', () => {
        console.log('Deepgram STT connection opened');
      });

      // Listen for all possible event names
      this.connection.on('transcript', (data) => {
        console.log('Deepgram transcript event received:', JSON.stringify(data).substring(0, 200));
        this.handleTranscript(data, onTranscript);
      });

      this.connection.on('Results', (data) => {
        console.log('Deepgram Results event received:', JSON.stringify(data).substring(0, 200));
        this.handleTranscript(data, onTranscript);
      });

      this.connection.on('Metadata', (data) => {
        console.log('Deepgram metadata:', data);
      });

      this.connection.on('error', (error) => {
        console.error('Deepgram STT error:', error);
        onError(error);
      });

      this.connection.on('close', () => {
        console.log('Deepgram STT connection closed');
      });

      return this.connection;
    } catch (error) {
      console.error('Failed to start Deepgram STT:', error);
      throw error;
    }
  }

  handleTranscript(data, onTranscript) {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    const isFinal = data.is_final;
    const speechFinal = data.speech_final;

    if (transcript && transcript.trim().length > 0) {
      onTranscript({
        text: transcript,
        isFinal: isFinal || speechFinal,
        language: data.channel?.alternatives?.[0]?.languages?.[0] || 'unknown'
      });
    }
  }

  sendAudio(audioData) {
    if (this.connection && this.connection.getReadyState() === 1) {
      this.connection.send(audioData);
    }
  }

  close() {
    if (this.connection) {
      this.connection.finish();
      this.connection = null;
    }
  }
}
