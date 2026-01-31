# Voice Translator Real-Time

PWA per traduzione vocale simultanea real-time usando OpenAI Realtime API.

## Stack Tecnologico

- **Backend**: Node.js + Express + WebSocket
- **AI**: OpenAI Realtime API (STT + LLM + TTS integrati)
- **Frontend**: Vanilla JS + Web Audio API
- **PWA**: Service Worker + Manifest

## Funzionalità

- ✅ Trascrizione vocale in tempo reale
- ✅ Traduzione automatica istantanea
- ✅ Sintesi vocale della traduzione
- ✅ Audio ducking automatico (riduce microfono durante riproduzione)
- ✅ 11 lingue supportate (EN, IT, ES, FR, DE, PT, ZH, JA, KO, AR, RU)
- ✅ UI responsive e minimale
- ✅ Installabile come PWA

## Flusso

```
Microfono (streaming continuo)
    → WebSocket Client
    → Express Server
    → OpenAI Realtime API (STT + Translation + TTS)
    → WebSocket Client
    → Speaker
```

## Setup

### 1. Installa dipendenze

```bash
npm install
```

### 2. Configura variabili d'ambiente

Crea un file `.env` nella root del progetto:

```env
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
```

**Nota**: Puoi ottenere la tua API key OpenAI da [platform.openai.com](https://platform.openai.com/api-keys)

### 3. Avvia il server

```bash
npm start
```

### 4. Apri il browser

Vai su [http://localhost:3000](http://localhost:3000)

## Utilizzo

1. **Seleziona la lingua target** dal dropdown
2. Clicca **"Start Translation"**
3. **Parla nel microfono** nella tua lingua
4. Ascolta la **traduzione automatica** in tempo reale

Il sistema:
- Trascrive automaticamente ciò che dici
- Traduce nella lingua selezionata usando GPT-4o
- Riproduce l'audio della traduzione
- Riduce il volume del microfono durante la riproduzione (ducking) per evitare echo

## Architettura

### Server (`server/`)

- **`server.js`**: Server Express + WebSocket che gestisce le connessioni client
- **`realtimeClient.js`**: Client WebSocket per OpenAI Realtime API

### Client (`public/`)

- **`index.html`**: UI principale
- **`app.js`**: Gestione WebSocket e logica applicazione
- **`audioManager.js`**: Gestione audio (capture microfono, playback, ducking)
- **`sw.js`**: Service Worker per funzionalità PWA
- **`manifest.json`**: Manifest PWA
- **`styles.css`**: Stili UI

## API OpenAI Realtime

Il progetto usa [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) che fornisce:

- **Speech-to-Text** (Whisper integrato)
- **LLM** (GPT-4o con istruzioni per traduzione)
- **Text-to-Speech** (voce Alloy)

Tutto in un'unica connessione WebSocket, semplificando notevolmente l'architettura.

### Configurazione Sessione

```javascript
{
  modalities: ['text', 'audio'],
  instructions: "Sei un traduttore. Traduci in {lingua_target}...",
  voice: 'alloy',
  input_audio_format: 'pcm16',
  output_audio_format: 'pcm16',
  turn_detection: {
    type: 'server_vad',
    threshold: 0.5,
    silence_duration_ms: 500
  }
}
```

## Formato Audio

- **Input**: PCM16, 16kHz, mono (dal microfono)
- **Output**: PCM16, 24kHz, mono (da OpenAI TTS)

## Lingue Supportate

- 🇬🇧 English (en)
- 🇮🇹 Italiano (it)
- 🇪🇸 Español (es)
- 🇫🇷 Français (fr)
- 🇩🇪 Deutsch (de)
- 🇵🇹 Português (pt)
- 🇨🇳 中文 (zh)
- 🇯🇵 日本語 (ja)
- 🇰🇷 한국어 (ko)
- 🇸🇦 العربية (ar)
- 🇷🇺 Русский (ru)

## Deployment su VPS

### Prerequisiti

- VPS con Ubuntu/Debian
- Dominio con DNS configurato (es: `translate.musound.it`)
- Node.js 18+ installato
- Nginx installato

### 1. Clona il repository

```bash
cd /var/www
git clone https://github.com/crispinto-dev/voicetranslator.git
cd voicetranslator
```

### 2. Installa dipendenze

```bash
npm install
```

### 3. Configura variabili d'ambiente

```bash
cp .env.example .env
nano .env
```

Aggiungi la tua chiave API OpenAI:

```env
OPENAI_API_KEY=sk-proj-...
PORT=3000
NODE_ENV=production
```

### 4. Build del frontend

**IMPORTANTE**: Il frontend usa moduli npm che devono essere bundlati per il browser.

```bash
npm run build
```

Questo comando crea la cartella `dist/` con i file bundlati da Vite.

### 5. Avvia con PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 6. Configura Nginx

**IMPORTANTE**: WebRTC richiede HTTPS. Configurazione HTTP non funzionerà.

```bash
# Installa Certbot per Let's Encrypt
sudo apt install certbot python3-certbot-nginx

# Genera certificato SSL
sudo certbot --nginx -d translate.musound.it

# Copia la configurazione Nginx
sudo cp nginx.example.conf /etc/nginx/sites-available/voicetranslator
sudo ln -s /etc/nginx/sites-available/voicetranslator /etc/nginx/sites-enabled/

# Testa e riavvia Nginx
sudo nginx -t
sudo systemctl reload nginx
```

### 7. Verifica

Apri `https://translate.musound.it` nel browser.

### Aggiornamenti

Per aggiornare l'app dopo modifiche:

```bash
cd /var/www/voicetranslator
git pull
npm install
npm run build  # IMPORTANTE: rebuilda il frontend
pm2 restart voicetranslator
```

## Risoluzione Problemi

### L'audio non viene riprodotto

1. Verifica che il volume del sistema sia alzato
2. Controlla la console del browser per errori
3. Assicurati che il browser abbia i permessi per l'audio

### La trascrizione non funziona

1. Verifica i permessi del microfono nel browser
2. Controlla che la connessione WebSocket sia attiva
3. Verifica la chiave API OpenAI nel file `.env`

### Errore "WebSocket connection failed"

1. Verifica che il server sia in esecuzione (`npm start`)
2. Controlla che la porta 3000 non sia occupata
3. Ricarica la pagina con Ctrl+Shift+R

## Vantaggi OpenAI Realtime API

### Rispetto all'architettura precedente (Deepgram):

- ✅ **Più semplice**: Un'unica API invece di tre (STT, Translation, TTS)
- ✅ **Più veloce**: Latenza ridotta grazie all'integrazione nativa
- ✅ **Più intelligente**: GPT-4o capisce meglio il contesto e produce traduzioni più naturali
- ✅ **Meno codice**: Eliminati `deepgramSTT.js`, `deepgramTTS.js`, `translator.js`
- ✅ **Più affidabile**: Meno punti di fallimento nella pipeline

### Costi

OpenAI Realtime API:
- ~$0.06 per minuto di audio input
- ~$0.24 per minuto di audio output

Stima: ~$0.30 per minuto di conversazione tradotta

## Tecnologie

- Node.js 22+
- Express 4
- WebSocket (ws)
- OpenAI Realtime API
- Web Audio API
- Service Worker API
- PWA Manifest

## Licenza

MIT

## Credits

Powered by OpenAI Realtime API
