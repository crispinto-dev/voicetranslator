import { createClient } from '@deepgram/sdk';

export class DeepgramTTSHandler {
  constructor(apiKey) {
    this.deepgram = createClient(apiKey);
  }

  async textToSpeech(text, language = 'en') {
    try {
      // Map language codes to appropriate Deepgram voices
      const voiceMap = {
        'en': 'aura-asteria-en',
        'it': 'aura-asteria-en', // Deepgram has limited language support
        'es': 'aura-asteria-en',
        'fr': 'aura-asteria-en',
        'de': 'aura-asteria-en',
        'pt': 'aura-asteria-en',
        'zh': 'aura-asteria-en',
        'ja': 'aura-asteria-en',
        'ko': 'aura-asteria-en',
        'ar': 'aura-asteria-en',
        'ru': 'aura-asteria-en'
      };

      const voice = voiceMap[language] || 'aura-asteria-en';

      const response = await this.deepgram.speak.request(
        { text },
        {
          model: voice,
          encoding: 'linear16',
          sample_rate: 48000,
          container: 'none'
        }
      );

      // Get the audio stream
      const stream = await response.getStream();

      if (!stream) {
        throw new Error('No audio stream received from Deepgram TTS');
      }

      // Collect all chunks
      const chunks = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Concatenate all chunks into a single buffer
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const audioBuffer = new Uint8Array(totalLength);
      let offset = 0;

      for (const chunk of chunks) {
        audioBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      return Buffer.from(audioBuffer);
    } catch (error) {
      console.error('Deepgram TTS error:', error);
      throw new Error('Text-to-speech failed');
    }
  }
}
