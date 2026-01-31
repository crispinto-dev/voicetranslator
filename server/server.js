import dotenv from 'dotenv';

// IMPORTANT: Load environment variables BEFORE importing local modules
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve static files from dist/ in production, public/ in development
const staticDir = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '../dist')
  : path.join(__dirname, '../public');

console.log(`Serving static files from: ${staticDir}`);
app.use(express.static(staticDir));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Endpoint to generate ephemeral API key for Realtime API
app.post('/api/realtime/token', async (req, res) => {
  try {
    const { language = 'en' } = req.body;

    console.log(`Generating ephemeral token for language: ${language}`);

    const languageNames = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'zh': 'Chinese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'ar': 'Arabic',
      'ru': 'Russian'
    };

    const targetLanguageName = languageNames[language] || 'English';

    const instructions = `You are a professional simultaneous interpreter for tour guides, translating into ${targetLanguageName}.

GUIDE INTERPRETATION MODE:
1. Translate each sentence/phrase AS SOON as it's complete - don't wait for the guide to stop talking
2. Your translations will be queued and played continuously for listeners in headphones
3. The guide speaks fluently without pausing - you must keep up with continuous translation
4. ONLY output the translation - never add comments, greetings, or your own words
5. Maintain the same tone, emotion, and speaking style as the guide
6. Each translation you generate will be queued and played in sequence without interruption

CRITICAL AUDIO BEHAVIOR (FULL DUPLEX):
- Your audio output plays on a SEPARATE, INDEPENDENT channel from input
- When you are speaking a translation, the guide can START speaking new content
- Your audio will NEVER be interrupted - it plays to completion
- New input is buffered and queued while you're speaking
- This creates true simultaneous interpretation like professional human interpreters
- There will be natural latency - listeners hear translations slightly delayed from live speech

AUDIO QUEUEING:
- Your audio translations are automatically queued and played back-to-back
- While translation N is playing, you're already listening and preparing translation N+1
- Multiple translations can queue and will play in sequence without any interruption
- This creates a continuous, uninterrupted audio stream for the listeners

BEHAVIOR:
- Translate complete sentences or phrases as soon as you recognize them
- Be concise and accurate - match the guide's pace
- If you hear silence, stay silent

You are a transparent real-time interpretation layer for professional tour guides.`;

    // Use client_secrets endpoint for WebRTC connections
    // Disable turn_detection for simultaneous translation
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        expires_after: {
          anchor: 'created_at',
          seconds: 600
        },
        session: {
          type: 'realtime',
          model: 'gpt-4o-realtime-preview',
          instructions: instructions
          // Note: turn_detection must be disabled via session.update after connection
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    console.log('Ephemeral token generated successfully');

    // client_secrets endpoint returns { value, expires_at, session }
    res.json({
      token: data.value,
      expiresAt: data.expires_at,
      instructions: instructions
    });

  } catch (error) {
    console.error('Error generating token:', error);
    res.status(500).json({
      error: 'Failed to generate token',
      message: error.message
    });
  }
});

// Endpoint to update session instructions (for language change)
app.post('/api/realtime/instructions', (req, res) => {
  const { language } = req.body;

  const languageNames = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'ar': 'Arabic',
    'ru': 'Russian'
  };

  const targetLanguageName = languageNames[language] || 'English';

  const instructions = `You are a real-time simultaneous translator. Your ONLY job is to translate everything you hear into ${targetLanguageName}.

CRITICAL RULES:
1. ONLY output the translation - never add explanations, comments, or your own words
2. Translate IMMEDIATELY as you hear speech
3. Maintain the same tone and emotion as the original
4. If you hear silence or unclear audio, stay silent
5. Do NOT greet, ask questions, or engage in conversation
6. Translate everything literally and accurately

You are a transparent translation layer - the user should feel like they're hearing the original speaker in ${targetLanguageName}.`;

  res.json({ instructions });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('OpenAI API Key:', process.env.OPENAI_API_KEY ? 'Set' : 'Missing');
});
