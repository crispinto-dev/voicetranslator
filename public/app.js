// Voice Translator using OpenAI Agents SDK
// The SDK uses WebRTC in browser which automatically handles microphone and speaker

import { RealtimeAgent, RealtimeSession } from '@openai/agents-realtime';

class VoiceTranslator {
  constructor() {
    this.session = null;
    this.agent = null;
    this.isRunning = false;
    this.targetLanguage = 'en';
    this.isMuted = false;
    this.fullDuplexMode = false;  // Full duplex mode (simultaneous translation)

    this.initializeUI();
    this.registerServiceWorker();
  }

  initializeUI() {
    this.startButton = document.getElementById('startButton');
    this.statusIndicator = document.getElementById('statusIndicator');
    this.statusText = document.getElementById('statusText');
    this.languageSelect = document.getElementById('languageSelect');
    this.originalText = document.getElementById('originalText');
    this.translatedText = document.getElementById('translatedText');
    this.testFileButton = document.getElementById('testFileButton');
    this.audioFileInput = document.getElementById('audioFileInput');
    this.fullDuplexToggle = document.getElementById('fullDuplexToggle');

    this.startButton.addEventListener('click', () => this.toggleTranslation());
    this.languageSelect.addEventListener('change', (e) => this.changeLanguage(e.target.value));

    // Full duplex mode toggle
    if (this.fullDuplexToggle) {
      this.fullDuplexToggle.addEventListener('change', (e) => {
        this.fullDuplexMode = e.target.checked;
        console.log('[App] Full duplex mode:', this.fullDuplexMode ? 'enabled' : 'disabled');

        // If session is active, restart to apply changes
        if (this.isRunning) {
          const wasRunning = this.isRunning;
          this.stopTranslation();
          if (wasRunning) {
            setTimeout(() => this.startTranslation(), 500);
          }
        }
      });
    }

    // File upload event handlers (for testing)
    if (this.testFileButton) {
      this.testFileButton.addEventListener('click', () => {
        this.audioFileInput.click();
      });
    }

    if (this.audioFileInput) {
      this.audioFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          alert('Test con file non ancora implementato con Agents SDK');
        }
      });
    }
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('Service Worker registered:', registration);
      } catch (error) {
        console.error('Service Worker registration failed:', error);
      }
    }
  }

  async toggleTranslation() {
    if (!this.isRunning) {
      await this.startTranslation();
    } else {
      this.stopTranslation();
    }
  }

  async startTranslation() {
    try {
      this.updateStatus('initializing', 'Inizializzazione...');

      // Get ephemeral token from backend
      const tokenResponse = await fetch('/api/realtime/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          language: this.targetLanguage
        })
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        throw new Error(error.message || 'Impossibile ottenere il token');
      }

      const { token, instructions } = await tokenResponse.json();
      console.log('[App] Got ephemeral token');
      console.log('[App] Instructions:', instructions.substring(0, 100) + '...');

      // Create the translator agent
      this.agent = new RealtimeAgent({
        name: 'Translator',
        instructions: instructions
      });

      // Create session
      this.session = new RealtimeSession(this.agent, {
        model: 'gpt-4o-realtime-preview-2024-12-17'
      });

      // Set up event handlers
      this.setupEventHandlers();

      // Connect using the ephemeral token
      // WebRTC in browser automatically handles microphone and speaker
      this.updateStatus('connecting', 'Connessione...');
      await this.session.connect({
        apiKey: token
      });

      console.log('[App] Connected to OpenAI Realtime API via WebRTC');

      // Full Duplex Mode: Configure for true simultaneous translation
      if (this.fullDuplexMode) {
        try {
          if (this.session.transport && this.session.transport.send) {
            // Configure session for simultaneous interpretation
            this.session.transport.send({
              type: 'session.update',
              session: {
                turn_detection: null,  // Disable VAD completely
                input_audio_transcription: {
                  model: 'whisper-1'  // Enable transcription to help model understand input
                }
              }
            });
            console.log('[App] Full Duplex: Configured for simultaneous translation');

            // More aggressive commit interval for sentence-by-sentence translation
            // Commit every 800ms to catch complete sentences quickly
            this.commitInterval = setInterval(() => {
              if (this.session && this.session.transport && this.session.transport.send) {
                try {
                  this.session.transport.send({
                    type: 'input_audio_buffer.commit'
                  });
                  this.session.transport.send({
                    type: 'response.create',
                    response: {
                      modalities: ['text', 'audio'],
                      instructions: 'Translate the last sentence immediately into the target language.'
                    }
                  });
                } catch (err) {
                  console.warn('[App] Commit error:', err);
                }
              }
            }, 800);
            console.log('[App] Full Duplex: Aggressive commit mode (800ms intervals)');
          }
        } catch (e) {
          console.error('[App] Full duplex configuration error:', e);
        }
      } else {
        console.log('[App] Half Duplex: Using server VAD (turn detection enabled)');
      }

      this.updateStatus('listening', 'In ascolto...');

      this.isRunning = true;
      this.startButton.textContent = 'Ferma Traduzione';
      this.startButton.classList.add('active');

    } catch (error) {
      console.error('[App] Failed to start translation:', error);
      this.updateStatus('error', 'Errore: ' + error.message);
      this.stopTranslation();
    }
  }

  setupEventHandlers() {
    if (!this.session) return;

    // Listen to transport events from the Realtime API
    this.session.on('transport_event', (event) => {
      // Log events for debugging
      if (event.type) {
        console.log('[Realtime Event]', event.type, event);
      }

      // Handle specific event types
      switch (event.type) {
        case 'conversation.item.input_audio_transcription.completed':
          // User's speech was transcribed
          if (event.transcript) {
            console.log('[App] User said:', event.transcript);
            this.originalText.textContent = event.transcript;
          }
          break;

        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta':
          // Translation text streaming
          if (event.delta) {
            this.translatedText.textContent += event.delta;
          }
          break;

        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          // Translation complete
          if (event.transcript) {
            console.log('[App] Translation:', event.transcript);
            this.translatedText.textContent = event.transcript;
          }
          break;

        case 'response.audio.delta':
          // Audio is being played (ducking could be implemented here)
          this.updateStatus('playing', 'Riproduzione...');
          break;

        case 'response.audio.done':
          // Audio playback finished
          this.updateStatus('listening', 'In ascolto...');
          break;

        case 'input_audio_buffer.speech_started':
          this.updateStatus('listening', 'In ascolto...');
          // Clear previous translation when new speech starts
          this.translatedText.textContent = '';
          break;

        case 'input_audio_buffer.speech_stopped':
          this.updateStatus('translating', 'Elaborazione...');
          break;

        case 'error':
          console.error('[App] Realtime API error:', event.error);
          this.updateStatus('error', 'Errore: ' + (event.error?.message || 'Errore sconosciuto'));
          break;
      }
    });

    // Handle agent changes (handoffs)
    this.session.on('agent_updated', (newAgent) => {
      console.log('[App] Agent updated:', newAgent.name);
    });

    // Handle history updates
    this.session.on('history_updated', (history) => {
      console.log('[App] History updated, items:', history.length);
    });
  }

  stopTranslation() {
    // Stop periodic commit interval
    if (this.commitInterval) {
      clearInterval(this.commitInterval);
      this.commitInterval = null;
    }

    if (this.session) {
      this.session.close();
      this.session = null;
    }

    this.isRunning = false;
    this.startButton.textContent = 'Avvia Traduzione';
    this.startButton.classList.remove('active');
    this.updateStatus('disconnected', 'Disconnesso');
  }

  async changeLanguage(language) {
    this.targetLanguage = language;
    console.log('[App] Language changed to:', language);

    // If session is active, we need to update the agent instructions
    if (this.session && this.isRunning) {
      // Get new instructions for the language
      const response = await fetch('/api/realtime/instructions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ language })
      });

      const { instructions } = await response.json();

      // Update the agent with new instructions
      if (this.agent) {
        this.agent.instructions = instructions;
        // Try to update the session with new agent config
        try {
          await this.session.updateAgent(this.agent);
          console.log('[App] Agent instructions updated for', language);
        } catch (error) {
          console.warn('[App] Could not update agent dynamically, will apply on next session');
        }
      }
    }
  }

  updateStatus(state, text) {
    this.statusIndicator.className = 'status-indicator ' + state;
    this.statusText.textContent = text;
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new VoiceTranslator();
});
