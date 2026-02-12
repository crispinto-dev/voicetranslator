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
    const { language = 'en', mode = 'normal' } = req.body;

    console.log(`Generating ephemeral token for language: ${language}, mode: ${mode}`);

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

    // Different instructions based on mode
    let instructions;

    if (mode === 'stt-only') {
      // STT-only mode: just transcribe, no translation (translation happens server-side)
      instructions = `You are a speech-to-text transcriber. Just listen and transcribe.`;
    } else if (mode === 'museum') {
      // Museum Guide Mode: TEXT-ONLY output for dual device streaming
      instructions = `You are a professional simultaneous interpreter for museum/tour guides, translating into ${targetLanguageName}.

DUAL DEVICE TEXT-ONLY MODE:
1. The guide speaks in their native language (typically Italian)
2. You translate into ${targetLanguageName} in real-time
3. Output ONLY the translated text - NO audio, NO commentary, NO explanations
4. Your text output will be sent to visitor devices for local text-to-speech playback

TRANSLATION BEHAVIOR:
- Translate each complete sentence or phrase AS SOON as you understand it
- Don't wait for long pauses - maintain continuous flow like a professional interpreter
- Keep translations concise, natural, and suitable for text-to-speech synthesis
- Match the guide's meaning precisely - don't add or remove content
- If the guide pauses between topics, produce separate translation chunks

TEXT OUTPUT REQUIREMENTS:
- Output ONLY the translation text, nothing else
- Do NOT produce any audio output
- Do NOT add meta-commentary like "Translation:" or "[Speaking]"
- Do NOT add punctuation marks beyond normal sentence structure
- Keep each response clean and ready for immediate TTS playback

QUALITY FOR TTS:
- Use standard/formal register appropriate for museum/cultural context
- Avoid abbreviations that TTS might mispronounce
- Structure sentences for natural speech rhythm when read aloud
- Be a transparent interpretation layer - visitors should feel like they're hearing the guide directly in ${targetLanguageName}

You are providing professional-quality text translation for museum tour interpretation.`;
    } else {
      // Normal/Half-Duplex Mode: Traditional conversation-style translation
      instructions = `You are a professional real-time translator, translating into ${targetLanguageName}.

HALF-DUPLEX MODE:
1. The user speaks in their language, then pauses
2. You translate what they said into ${targetLanguageName}
3. The user listens to your translation through their headphones
4. ONLY output the translation - never add comments, explanations, or your own words
5. Wait for the user to finish speaking before translating

TRANSLATION BEHAVIOR:
- Translate complete sentences or utterances after the user stops speaking
- Be accurate, natural, and fluent in ${targetLanguageName}
- Match the user's tone and emotion
- Keep translations concise but complete
- Don't add or remove meaning from the original

TURN-TAKING:
- User speaks → You listen
- User stops → You translate
- Translation completes → User can speak again
- This is traditional half-duplex turn-taking conversation

QUALITY:
- Prioritize accuracy and naturalness
- Use appropriate register (formal/informal) based on context
- Avoid filler words, hesitations, or meta-commentary
- Be a transparent translation layer

You are a professional real-time translator for personal conversations and interactions.`;
    }

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
          model: 'gpt-4o-realtime-preview-2024-12-17',  // Match client session model
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

// ==========================================
// TRANSLATION FUNCTION (server-side)
// ==========================================

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

async function translateText({ sourceText, targetLang }) {
  const targetLanguageName = languageNames[targetLang] || 'English';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',  // Fast and cheap for translation
      messages: [
        {
          role: 'system',
          content: `You are a professional simultaneous interpreter for museum tours.
Translate the following Italian text into ${targetLanguageName}.
Output ONLY the translation, nothing else. No quotes, no explanations.
Keep it natural and suitable for text-to-speech.`
        },
        { role: 'user', content: sourceText }
      ],
      max_tokens: 500,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Translation API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const translated = data.choices?.[0]?.message?.content?.trim() || '';
  return translated;
}

// ==========================================
// SSE ENDPOINTS FOR DUAL DEVICE MODE
// ==========================================

let currentClient = null;
let globalEventId = 0;

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

function sseSend(res, { id, event, data }) {
  if (id != null) res.write(`id: ${id}\n`);
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Ricevitore: SSE (un solo client)
app.get("/sse", (req, res) => {
  const lang = (req.query.lang || "en").toString().toLowerCase();
  console.log(`[SSE] Receiver connected with language: ${lang}`);

  sseHeaders(res);
  currentClient = { res, lang };
  sseSend(res, { id: ++globalEventId, event: "hello", data: { lang } });

  const hb = setInterval(() => {
    try {
      sseSend(res, { event: "ping", data: { t: Date.now() } });
    } catch (e) {
      console.error('[SSE] Heartbeat error:', e);
    }
  }, 15000);

  req.on("close", () => {
    console.log('[SSE] Receiver disconnected');
    clearInterval(hb);
    currentClient = null;
  });
});

// Preset suggestions from visitor (P3: auto-preset on backlog)
let suggestedPresets = {};  // { lang: presetName }

app.post("/preset-suggest", (req, res) => {
  const { lang, preset } = req.body || {};
  if (lang && preset) {
    suggestedPresets[lang] = preset;
    console.log(`[Preset] Visitor suggests "${preset}" for lang "${lang}"`);
  }
  res.json({ ok: true });
});

// Per-language debounce state for translation batching (reduces API calls, improves coherence)
const pendingByLang = new Map();   // lang → { texts[], ts, seq }
const timerByLang   = new Map();   // lang → timeoutId
const DEBOUNCE_MS = 250;

// Ingest: riceve chunk dalla guida, accumula con debounce, poi traduce
app.post("/ingest", (req, res) => {
  const { sourceText, ts, seq, lang } = req.body || {};

  if (!sourceText || !lang) {
    return res.status(400).json({ ok: false, error: 'Missing sourceText or lang' });
  }

  console.log(`[Ingest] Received source (IT) seq:${seq} -> ${lang}: "${sourceText.substring(0, 60)}..."`);

  const receiverOk = currentClient && currentClient.lang === lang.toLowerCase();

  // Respond immediately to guide (don't block on translation)
  res.json({
    ok: true,
    hasReceiver: receiverOk,
    receiverLang: currentClient?.lang ?? null,
    accepted: receiverOk,
    suggestedPreset: suggestedPresets[lang] || null
  });

  // If no receiver, don't accumulate or translate
  if (!receiverOk) return;

  const lk = lang.toLowerCase();

  // Accumulate text for this language's debounce bucket
  const pending = pendingByLang.get(lk);
  if (!pending) {
    pendingByLang.set(lk, { lang: lk, texts: [sourceText], ts, seq });
  } else {
    pending.texts.push(sourceText);
    pending.seq = seq;
    pending.ts = ts;
  }

  // Reset this language's debounce timer
  const oldTimer = timerByLang.get(lk);
  if (oldTimer) clearTimeout(oldTimer);

  timerByLang.set(lk, setTimeout(async () => {
    timerByLang.delete(lk);
    const batch = pendingByLang.get(lk);
    pendingByLang.delete(lk);
    if (!batch) return;

    const combinedText = batch.texts.join(' ');
    try {
      console.log(`[Ingest] Translating batch (${batch.texts.length} chunk(s)) to ${batch.lang}...`);
      const translated = await translateText({ sourceText: combinedText, targetLang: batch.lang });
      console.log(`[Ingest] Translation: "${translated.substring(0, 60)}..."`);

      if (currentClient && currentClient.lang === batch.lang) {
        sseSend(currentClient.res, {
          id: ++globalEventId,
          event: "chunk",
          data: { text: translated, ts: batch.ts ?? Date.now(), seq: batch.seq }
        });
        console.log(`[Ingest] Sent batched translation to receiver (${batch.lang})`);
      }
    } catch (e) {
      console.error('[Ingest] Batch translation error:', e);
    }
  }, DEBOUNCE_MS));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('OpenAI API Key:', process.env.OPENAI_API_KEY ? 'Set' : 'Missing');
});
