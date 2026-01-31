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

    const instructions = `You are a real-time simultaneous interpreter translating into ${targetLanguageName}.

CRITICAL INSTRUCTIONS FOR SIMULTANEOUS TRANSLATION:
1. Translate SENTENCE BY SENTENCE as soon as each sentence is completed - DO NOT wait for the speaker to stop talking
2. Start translating immediately when you recognize a complete phrase or sentence
3. Continue translating while the speaker is still talking - this is SIMULTANEOUS interpretation
4. ONLY output the translation - never add comments, explanations, or your own words
5. Maintain the same tone, emotion, and speaking style as the original
6. If you hear silence or unclear audio, stay silent
7. Do NOT greet, introduce yourself, ask questions, or engage in conversation

STREAMING BEHAVIOR:
- As soon as you hear a complete sentence or phrase, translate it immediately
- Don't wait for pauses or end of speech
- Translate continuously in real-time while listening
- This is full-duplex simultaneous interpretation - you can listen and speak at the same time

You are a transparent real-time translation layer.`;

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
