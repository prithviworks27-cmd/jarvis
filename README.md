# JARVIS

A voice assistant for your Mac. Press a hotkey, speak, and it answers out loud and can act on your Mac.
Costs nothing: speech-to-text and the LLM run on Groq's free tier, the voice is Groq's Orpheus model.

```
hotkey -> mic (webm) -> Groq Whisper -> Groq LLM + tools -> Groq Orpheus voice (offline Kokoro, then macOS `say`, as fallbacks)
```

## Setup

1. Get a free key at https://console.groq.com (no card needed).
2. Install and add the key:

```bash
cd jarvis
npm install
node node_modules/electron/install.js   # needed if your ~/.npmrc blocks install scripts
cp .env.example .env                    # then put your key in .env
npm start
```

## Use

Press **Control twice quickly**, **Option+Space**, or click the orb to start listening; do it again to stop. Pressing it while JARVIS is speaking interrupts him.

Try:
- "Open Spotify." / "Search YouTube for lo-fi beats."
- "Set the volume to 30." / "Mute." / "Turn the screen off."
- "What's on my calendar today?" / "Remind me to submit the report."
- "Do I have any unread mail?"
- "What's the weather in Bengaluru?" / "Any news about the IPL?" / "Who is Sundar Pichai?" (live, free: Open-Meteo, Google News RSS, Wikipedia; no keys)

The Orpheus model needs a one-time terms acceptance at https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english

The first time Kokoro starts it downloads its ~90 MB model (about a minute, once); after that it works offline.

## macOS permissions

- **Accessibility** for the app you launch JARVIS from (Terminal, or Electron), so double-tap Control works. System Settings > Privacy & Security > Accessibility, switch it on, then restart JARVIS. The first run compiles a small Swift helper (needs Xcode command line tools).

The first time you use each feature macOS asks for permission; click Allow.
- **Microphone** for Electron.
- **Automation** (Calendar, Reminders, Mail) so JARVIS can read them.
If you clicked Don't Allow, fix it in System Settings > Privacy & Security.

## Options (`.env`)

| Variable | Default |
|---|---|
| `GROQ_API_KEY` | required |
| `JARVIS_USER_NAME` | `sir` |
| `JARVIS_TTS_VOICE` | `troy` (also `daniel`, `austin`, `autumn`, `diana`, `hannah`) |
| `JARVIS_KOKORO_VOICE` | `bm_george` (British male; also `bm_lewis`, `bm_daniel`, `bm_fable`, `af_heart`, `af_bella`) |
| `JARVIS_TTS` | unset = Orpheus, then Kokoro, then macOS. `kokoro` = offline only (no daily limit). `say` = macOS voice only |
| `JARVIS_VOICE` | `Daniel`, the macOS fallback voice (`say -v '?'` lists them) |
| `JARVIS_CITY` | none (used when you just say "the weather") |
| `JARVIS_HOTKEY` | `Alt+Space` |
| `JARVIS_MODEL` | `openai/gpt-oss-120b` |

## Files

- `main.js` window, hotkey, the audio -> text -> reply -> speech pipeline
- `stt.js` Groq Whisper
- `brain.js` LLM loop with tool calling and short-term memory
- `tools.js` the Mac actions (add new ones here)
- `speak.js` voices: Orpheus (Groq), offline Kokoro, macOS `say` fallback
- `kokoro-worker.mjs` runs the Kokoro model in its own process
- `index.html`, `renderer.js`, `style.css` the orb UI

`npm test` checks the tool layer (no mic or key needed).

## Limits

- Free tier has rate/daily limits; if you hit one JARVIS shows the error.
- "Turn the screen off" only locks the Mac if it asks for a password immediately after sleep.
- Calendar/Mail AppleScript can be slow with big accounts.
- Toggle (not hold) to talk: Electron global shortcuts can't see key release.
