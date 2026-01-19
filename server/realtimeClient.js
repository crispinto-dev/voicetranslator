import WebSocket from 'ws';

export class OpenAIRealtimeClient {
  constructor(apiKey, targetLanguage = 'en') {
    this.apiKey = apiKey;
    this.targetLanguage = targetLanguage;
    this.ws = null;
    this.onAudioCallback = null;
    this.onTranscriptCallback = null;
    this.onErrorCallback = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.ws.on('open', () => {
        console.log('OpenAI Realtime API connected');

        // Configure session
        this.sendEvent({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: this.getSystemInstructions(),
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1'
            },
            turn_detection: null,
            temperature: 0.8,
            max_response_output_tokens: 4096
          }
        });

        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        console.error('OpenAI Realtime WebSocket error:', error);
        if (this.onErrorCallback) {
          this.onErrorCallback(error);
        }
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('OpenAI Realtime API disconnected');
      });
    });
  }

  getSystemInstructions() {
    const languageNames = {
      'en': 'inglese',
      'it': 'italiano',
      'es': 'spagnolo',
      'fr': 'francese',
      'de': 'tedesco',
      'pt': 'portoghese',
      'zh': 'cinese',
      'ja': 'giapponese',
      'ko': 'coreano',
      'ar': 'arabo',
      'ru': 'russo'
    };

    const targetLangName = languageNames[this.targetLanguage] || this.targetLanguage;

    return `You are a translator. Translate everything you hear to ${targetLangName}.
Respond ONLY with the translation, nothing else.

Examples:
User: "Ciao, come stai?"
You: "Hello, how are you?"

User: "Buongiorno"
You: "Good morning"

Never add phrases like "The translation is..." or explanations. Just translate directly.`;
  }

  handleMessage(data) {
    try {
      const event = JSON.parse(data);

      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          console.log('Session configured:', event.type);
          break;

        case 'input_audio_buffer.speech_started':
          console.log('Speech detected');
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log('Speech ended');
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // User's speech transcription
          console.log('Input transcription completed:', event.transcript);
          if (this.onTranscriptCallback && event.transcript) {
            this.onTranscriptCallback({
              text: event.transcript,
              isFinal: true,
              type: 'input'
            });
          }
          break;

        case 'conversation.item.created':
          console.log('Conversation item created:', event.item?.type);
          if (event.item?.type === 'message' && event.item?.role === 'user') {
            // User message was created, check for transcript
            console.log('User message content:', JSON.stringify(event.item.content).substring(0, 200));
          }
          break;

        case 'input_audio_buffer.committed':
          console.log('Audio buffer committed successfully');
          break;

        case 'response.audio_transcript.delta':
          // Assistant's response text (incremental)
          if (this.onTranscriptCallback && event.delta) {
            this.onTranscriptCallback({
              text: event.delta,
              isFinal: false,
              type: 'output'
            });
          }
          break;

        case 'response.audio_transcript.done':
          // Assistant's complete response text
          if (this.onTranscriptCallback && event.transcript) {
            this.onTranscriptCallback({
              text: event.transcript,
              isFinal: true,
              type: 'output'
            });
          }
          break;

        case 'response.audio.delta':
          // Audio chunk from assistant
          if (this.onAudioCallback && event.delta) {
            // delta is base64 encoded PCM16 audio
            const audioBuffer = Buffer.from(event.delta, 'base64');
            this.onAudioCallback(audioBuffer);
          }
          break;

        case 'response.audio.done':
          console.log('Audio response completed');
          if (this.onAudioCallback) {
            this.onAudioCallback(null, true); // Signal end of audio
          }
          break;

        case 'error':
          console.error('OpenAI Realtime API error:', event.error);
          if (this.onErrorCallback) {
            this.onErrorCallback(new Error(event.error.message));
          }
          break;

        case 'response.done':
          console.log('Response completed:', JSON.stringify(event, null, 2));
          if (event.response?.status === 'failed') {
            console.error('Response failed with error:', JSON.stringify(event.response.status_details, null, 2));
          }
          break;

        case 'response.created':
          console.log('Response created');
          break;

        case 'response.output_item.added':
          console.log('Output item added:', event.item?.type);
          break;

        case 'response.content_part.added':
          console.log('Content part added:', event.part?.type);
          break;

        case 'response.text.delta':
          console.log('Text delta:', event.delta);
          break;

        case 'response.text.done':
          console.log('Text done:', event.text);
          break;

        default:
          // Log all unhandled events for debugging
          console.log('Unhandled event type:', event.type);
          break;
      }
    } catch (error) {
      console.error('Error parsing Realtime API message:', error);
    }
  }

  sendEvent(event) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  sendAudio(audioBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Convert buffer to base64
      const base64Audio = audioBuffer.toString('base64');

      this.sendEvent({
        type: 'input_audio_buffer.append',
        audio: base64Audio
      });
    }
  }

  commitAudioBuffer() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Commit the audio buffer
      this.sendEvent({
        type: 'input_audio_buffer.commit'
      });

      // Request a response
      this.sendEvent({
        type: 'response.create',
        response: {
          modalities: ['text', 'audio']
        }
      });
    }
  }

  setTargetLanguage(language) {
    this.targetLanguage = language;

    // Update session with new instructions
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendEvent({
        type: 'session.update',
        session: {
          instructions: this.getSystemInstructions()
        }
      });
    }
  }

  onAudio(callback) {
    this.onAudioCallback = callback;
  }

  onTranscript(callback) {
    this.onTranscriptCallback = callback;
  }

  onError(callback) {
    this.onErrorCallback = callback;
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
