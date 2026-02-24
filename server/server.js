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

// ==========================================
// RATE LIMITER (no external dependencies)
// ==========================================

const rateLimits = new Map(); // key → { count, resetAt }

// Cleanup expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits) {
    if (now > v.resetAt) rateLimits.delete(k);
  }
}, 60000);

function rateLimit(limit, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const entry = rateLimits.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (++entry.count > limit) {
      console.warn(`[RateLimit] ${ip} exceeded ${limit} req/${windowMs}ms on ${req.path}`);
      return res.status(429).json({ error: 'Too many requests, try again later.' });
    }
    next();
  };
}

// ==========================================
// SUPPORTED LANGUAGES (for validation)
// ==========================================

const SUPPORTED_LANGS = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko', 'ar', 'ru']);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Endpoint to generate ephemeral API key for Realtime API
app.post('/api/realtime/token', rateLimit(5, 60000), async (req, res) => {
  try {
    const { language = 'en', mode = 'normal' } = req.body;

    console.log(`Generating ephemeral token for language: ${language}, mode: ${mode}`);

    const languageNames = {
      'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
      'it': 'Italian', 'pt': 'Portuguese', 'zh': 'Chinese', 'ja': 'Japanese',
      'ko': 'Korean', 'ar': 'Arabic', 'ru': 'Russian'
    };

    const targetLanguageName = languageNames[language] || 'English';

    let instructions;

    if (mode === 'stt-only') {
      instructions = `You are a speech-to-text transcriber. Just listen and transcribe.`;
    } else if (mode === 'museum') {
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

    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime',
          model: 'gpt-4o-realtime-preview-2024-12-17',
          instructions: instructions
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
    res.json({ token: data.value, expiresAt: data.expires_at, instructions });

  } catch (error) {
    console.error('Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate token', message: error.message });
  }
});

// Endpoint to update session instructions (for language change)
app.post('/api/realtime/instructions', (req, res) => {
  const { language } = req.body;
  const languageNames = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'it': 'Italian', 'pt': 'Portuguese', 'zh': 'Chinese', 'ja': 'Japanese',
    'ko': 'Korean', 'ar': 'Arabic', 'ru': 'Russian'
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
  'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
  'it': 'Italian', 'pt': 'Portuguese', 'zh': 'Chinese', 'ja': 'Japanese',
  'ko': 'Korean', 'ar': 'Arabic', 'ru': 'Russian'
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
      model: 'gpt-4o-mini',
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
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ==========================================
// SESSION LOG
// ==========================================

// In-memory log, max 1000 entries (auto-rotate)
const sessionLog = [];

// ==========================================
// SSE MULTI-CLIENT STATE
// ==========================================

// Map<clientId, { res, lang, connectedAt }>
const sseClients = new Map();
let globalEventId = 0;
let clientCounter = 0;
let totalChunksTranslated = 0;
const serverStartTime = Date.now();

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function sseSend(res, { id, event, data }) {
  if (id != null) res.write(`id: ${id}\n`);
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Broadcast to all SSE clients listening for a given language.
// Returns the number of clients successfully reached.
function broadcastToLang(lang, payload) {
  let sent = 0;
  for (const [id, client] of sseClients) {
    if (client.lang !== lang) continue;
    try {
      sseSend(client.res, payload);
      sent++;
    } catch (e) {
      console.error(`[SSE] Send error to client #${id}:`, e.message);
      sseClients.delete(id);
    }
  }
  return sent;
}

// SSE endpoint — supports any number of concurrent receivers per language
app.get('/sse', (req, res) => {
  const lang = (req.query.lang || 'en').toString().toLowerCase();
  const clientId = ++clientCounter;

  console.log(`[SSE] Client #${clientId} connected (${lang}), total: ${sseClients.size + 1}`);

  sseHeaders(res);
  sseClients.set(clientId, { res, lang, connectedAt: Date.now() });
  sseSend(res, { id: ++globalEventId, event: 'hello', data: { lang, clientId } });

  // Also push current visitor settings so a late-joining client gets the right TTS rate
  const settings = visitorSettings.get(lang);
  if (settings) {
    sseSend(res, { event: 'settings', data: settings });
  }

  const hb = setInterval(() => {
    try {
      sseSend(res, { event: 'ping', data: { t: Date.now() } });
    } catch (e) {
      console.error(`[SSE] Heartbeat error for client #${clientId}:`, e.message);
      clearInterval(hb);
      sseClients.delete(clientId);
    }
  }, 15000);

  req.on('close', () => {
    console.log(`[SSE] Client #${clientId} disconnected, remaining: ${sseClients.size - 1}`);
    clearInterval(hb);
    sseClients.delete(clientId);
  });
});

// Status endpoint — useful for monitoring and debugging
app.get('/status', (_req, res) => {
  const byLang = {};
  for (const { lang } of sseClients.values()) {
    byLang[lang] = (byLang[lang] || 0) + 1;
  }
  res.json({
    clients: sseClients.size,
    byLang,
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    totalChunksTranslated,
    sessionLogEntries: sessionLog.length,
    pendingLangs: [...pendingByLang.keys()]
  });
});

// ==========================================
// SESSION LOG ENDPOINTS
// ==========================================

app.get('/session-log', (_req, res) => {
  res.json({ entries: sessionLog.length, log: sessionLog });
});

app.get('/session-log/csv', (_req, res) => {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  const header = 'timestamp,lang,seq,latencyMs,sourceText,translatedText\n';
  const rows = sessionLog.map(e =>
    [e.timestamp, e.lang, e.seq ?? '', e.latencyMs, esc(e.sourceText), esc(e.translatedText)].join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="avatour-session-log.csv"');
  res.send(header + rows);
});

// ==========================================
// VISITOR SETTINGS (TTS rate, etc.)
// ==========================================

// Stores the latest settings per language, so late-joining clients receive them.
const visitorSettings = new Map();  // lang → { ttsRate, ... }

app.post('/visitor-settings', (req, res) => {
  const { lang, ttsRate } = req.body || {};
  if (!lang) return res.status(400).json({ ok: false, error: 'Missing lang' });

  const lk = lang.toLowerCase();
  const rate = Math.min(2.0, Math.max(0.5, parseFloat(ttsRate) || 1.0));
  visitorSettings.set(lk, { ttsRate: rate });

  const sent = broadcastToLang(lk, {
    id: ++globalEventId,
    event: 'settings',
    data: { ttsRate: rate }
  });

  console.log(`[Settings] TTS rate ${rate} broadcast to ${sent} client(s) (${lk})`);
  res.json({ ok: true, sent });
});

// ==========================================
// PRESET SUGGESTIONS (from visitor auto-preset)
// ==========================================

let suggestedPresets = {};  // { lang: presetName }

app.post('/preset-suggest', (req, res) => {
  const { lang, preset } = req.body || {};
  if (lang && preset) {
    suggestedPresets[lang] = preset;
    console.log(`[Preset] Visitor suggests "${preset}" for lang "${lang}"`);
  }
  res.json({ ok: true });
});

// ==========================================
// SMART DEBOUNCE + TRANSLATION PIPELINE
// ==========================================

// Per-language state
const pendingByLang = new Map();   // lang → { texts[], ts, seq, maxTimer }
const timerByLang   = new Map();   // lang → debounce timeoutId

// 50ms window just to coalesce bursts from network jitter.
// The guide already does micro-chunking, so a large debounce is redundant.
const DEBOUNCE_MS  = 50;
// Absolute safety valve: if a batch hasn't been flushed in 3s, force it.
const MAX_WAIT_MS  = 3000;

async function flushLang(lk) {
  // Cancel the debounce timer if it fired us (no-op if called by maxTimer)
  const deb = timerByLang.get(lk);
  if (deb) { clearTimeout(deb); timerByLang.delete(lk); }

  const batch = pendingByLang.get(lk);
  if (!batch) return;
  pendingByLang.delete(lk);
  clearTimeout(batch.maxTimer);

  const combinedText = batch.texts.join(' ');
  console.log(`[Ingest] Translating ${batch.texts.length} chunk(s) → ${lk}: "${combinedText.substring(0, 80)}"`);

  const flushStartMs = Date.now();
  try {
    const translated = await translateText({ sourceText: combinedText, targetLang: lk });
    const latencyMs = Date.now() - flushStartMs;
    console.log(`[Ingest] → "${translated.substring(0, 80)}" (${latencyMs}ms)`);
    totalChunksTranslated++;

    // Persist to session log
    sessionLog.push({
      timestamp: new Date().toISOString(),
      seq: batch.seq,
      lang: lk,
      sourceText: combinedText,
      translatedText: translated,
      latencyMs
    });
    if (sessionLog.length > 1000) sessionLog.shift();

    const sent = broadcastToLang(lk, {
      id: ++globalEventId,
      event: 'chunk',
      data: { text: translated, ts: batch.ts ?? Date.now(), seq: batch.seq }
    });
    console.log(`[Ingest] Broadcast to ${sent} client(s) (${lk})`);
  } catch (e) {
    console.error('[Ingest] Translation error:', e.message);
  }
}

// Ingest: receives source text chunks from the guide device
app.post('/ingest', rateLimit(30, 60000), (req, res) => {
  const { sourceText, ts, seq, lang } = req.body || {};

  // Input validation
  if (typeof sourceText !== 'string' || sourceText.length === 0 || sourceText.length > 1000) {
    return res.status(400).json({ ok: false, error: 'sourceText missing, empty, or too long (max 1000 chars)' });
  }
  if (!lang) {
    return res.status(400).json({ ok: false, error: 'Missing lang' });
  }

  const lk = lang.toLowerCase();

  if (!SUPPORTED_LANGS.has(lk)) {
    return res.status(400).json({ ok: false, error: `Unsupported language: ${lk}` });
  }
  if (seq !== undefined && (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0)) {
    return res.status(400).json({ ok: false, error: 'Invalid seq: must be a non-negative number' });
  }

  const receiverCount = [...sseClients.values()].filter(c => c.lang === lk).length;
  const hasReceiver   = receiverCount > 0;

  console.log(`[Ingest] seq:${seq} → ${lk} (${receiverCount} receiver(s)): "${sourceText.substring(0, 60)}"`);

  // Respond immediately so the guide isn't blocked on our translation latency
  res.json({
    ok: true,
    hasReceiver,
    clientCount: receiverCount,
    accepted: hasReceiver,
    suggestedPreset: suggestedPresets[lang] || null
  });

  if (!hasReceiver) return;

  // Accumulate into this language's batch
  const existing = pendingByLang.get(lk);
  if (!existing) {
    // New batch: arm the absolute max-wait safety timer
    const maxTimer = setTimeout(() => {
      console.warn(`[Ingest] Force-flush after ${MAX_WAIT_MS}ms for ${lk}`);
      flushLang(lk);
    }, MAX_WAIT_MS);
    pendingByLang.set(lk, { texts: [sourceText], ts, seq, maxTimer });
  } else {
    existing.texts.push(sourceText);
    existing.seq = seq;
    if (!existing.ts) existing.ts = ts;
  }

  // (Re)start the short debounce timer
  const old = timerByLang.get(lk);
  if (old) clearTimeout(old);
  timerByLang.set(lk, setTimeout(() => flushLang(lk), DEBOUNCE_MS));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('OpenAI API Key:', process.env.OPENAI_API_KEY ? 'Set' : 'Missing');
});
