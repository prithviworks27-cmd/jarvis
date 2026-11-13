# Alfred

A voice assistant for your Mac (the butler: Alfred, in the spirit of Batman's). The name is a setting: `JARVIS_NAME` in `.env` changes the wake word and how it introduces itself. Press a hotkey, speak, and it answers out loud and can act on your Mac.
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

Press **Control twice quickly** or **Option+Space** to start listening; do it again to stop. Clicking the character only pokes it (it reacts but does not listen); drag it to move it. Pressing it while JARVIS is speaking interrupts him.

Try:
- "Open Spotify." / "Search YouTube for lo-fi beats."
- "Set the volume to 30." / "Mute." / "Turn the screen off."
- "What's on my calendar today?" / "Remind me to submit the report."
- "Do I have any unread mail?"
- "Switch to my YouTube tab." / "Open my WhatsApp chat with Rahul." / "Type hello." (works inside apps)
- "What's on my screen?" / "Explain this error." (takes a screenshot and asks a free Groq vision model; the image is sent to Groq, never saved)
- "What's the weather in Bengaluru?" / "Any news about the IPL?" / "Who is Sundar Pichai?" (live, free: Open-Meteo, Google News RSS, Wikipedia; no keys)

The Orpheus model needs a one-time terms acceptance at https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english

The first time Kokoro starts it downloads its ~90 MB model (about a minute, once); after that it works offline.

## macOS permissions

- **Accessibility** for the app you launch JARVIS from (Terminal, or Electron), so double-tap Control works. System Settings > Privacy & Security > Accessibility, switch it on, then restart JARVIS. The first run compiles a small Swift helper (needs Xcode command line tools).

The first time you use each feature macOS asks for permission; click Allow.
- **Microphone** for Electron.
- **Screen Recording** for Electron, so JARVIS can see your screen. Without it screenshots show only your wallpaper.
- **Automation** (Calendar, Reminders, Mail) so JARVIS can read them.
If you clicked Don't Allow, fix it in System Settings > Privacy & Security.

## Hands-free: say "Alfred"

Say **"Hey Alfred"** (or just "Alfred"), wait for the soft *Tink*, then say what you want. When you stop talking it ends by itself (about 1.3 seconds of quiet) and a *Pop* tells you it got it. If you say nothing for about 7 seconds it gives up quietly. The hotkeys still work, and pressing one again also ends a recording early.
- **Privacy:** the name is detected by a small helper app (`Alfred Wake Word`) using macOS's own on-device speech recognition: no network, no key. Nothing is recorded or sent anywhere until it hears the name; then your command is handled like any other. The microphone indicator is on all the time while this is enabled. Turn it off with `JARVIS_WAKE=0` in `.env`.
- **First run:** macOS asks to let *Alfred Wake Word* use the Microphone and Speech Recognition. Say Allow to both.
- **It does not listen to itself:** the name detector is paused while JARVIS thinks, talks or records, then resumes.
- **Tips:** pause for a moment after the name before the command. A TV or a conversation nearby can trigger it by mistake (nothing happens unless a command follows). `JARVIS_SOUNDS=0` turns the Tink/Pop off; `JARVIS_WAKE_DEBUG=1` prints what the name detector hears.

## Dictation

Press **Option+Shift+Space**, speak, press it again. Your words are typed into whatever app is in front (Notes, Docs, a chat box, any text field). The character glows blue while it listens. No AI is involved after speech recognition, so dictation can never trigger a tool. It pastes the text (so Hindi and any other script work) and puts your clipboard back; it will not paste into a password field, and silence or room noise is not typed. Change the shortcut with `JARVIS_DICTATE_HOTKEY`.

## Memory

Tell it things to remember: "Remember that Setting is my sister", "Yaad rakhna, mera exam Friday ko hai". Ask "What do you remember about me?" or say "Forget everything about Setting" ("forget all" clears it).
- **Where:** one private file, `~/Library/Application Support/JARVIS/memory.json` (owner-only). Edit or delete it any time.
- **How it is used:** up to about 16 relevant facts are added to each request, so they travel to Groq with it like everything else you say.
- **Safety:** it only saves or erases when your own words ask for it (a web page or email cannot plant a memory), it never stores passwords, PINs, codes, tokens or card numbers, and remembered facts are treated as facts, never as instructions.

## Hindi, English and Hinglish

Speak any mix. Speech recognition detects the language by itself and writes Hindi in Roman letters (Hinglish), so app and contact names still match. If you speak Hindi or Hinglish, JARVIS answers in Hindi, spoken by the Mac's built-in Hindi voice (Lekha); English questions get English answers with the normal voice. Force one language with `JARVIS_STT_LANGUAGE` (e.g. `en`) if auto-detect ever guesses wrong on a short command.

## When it mishears you

Speech recognition (Whisper) is good but spells unusual names by sound: "Claude" can come out as "Clawed" or "Cloud". JARVIS fixes this after hearing, not before:
- **Apps:** `open_app` falls back to a partial match, then to the installed app that sounds most like what it heard (consonant skeleton plus edit distance, `fuzzy.js`).
- **WhatsApp contacts:** the name is snapped to your `JARVIS_VOCAB` list and your Mac's Contacts app (read once, only on your Mac; allow the Contacts prompt). Sync your phone contacts to the Mac (e.g. a Google account in Internet Accounts) for this to cover everyone.
- **No text on screen by default:** Alfred only speaks, and the character's look (glow, mouth, eyes) shows what it is doing (`JARVIS_CAPTIONS=1` adds captions). Problems are spoken too, in plain words. With `JARVIS_WAKE_DEBUG=1` the log file shows what it heard.

## More skills

All free, no new keys. Try:
- **GitHub** (uses your own `gh` login: `gh auth login` once): "Anything new on GitHub?", "Any open PRs or CI failures on my jarvis repo?", "Open an issue in jarvis called fix the wake word" (asks you to confirm before posting).
- **Files** (your home folder only): "Find my resume", "Summarise the PDF in Downloads called invoice", "Open my notes folder". PDFs are read with macOS's own PDFKit; Word/RTF with `textutil`. It never reads keys, `.env` files, keychains or browser data, and never opens programs.
- **Music:** "Pause the music", "Next song", "What's playing?", "Play Coldplay" (your Music library first, else a Spotify or YouTube Music search).
- **Any browser:** Alfred works in the browser you are using (Safari, Chrome, Brave, Edge), not just Chrome. "Switch to my DSA unit 1 tab" looks in your current browser first, then your other open ones, and copes with misheard words; links and searches open in the browser you are in, or the one you name ("search DSA notes on Safari"). Clicking on a page needs that browser's "Allow JavaScript from Apple Events" setting; reading a page in Safari needs nothing.
- **The web:** "Search the web for the best budget mic", "Summarise this page" (the tab you are on, in any browser), "Read example.com and tell me what it says". Free DuckDuckGo search; only public addresses.
- **Your Mac:** "How's my battery?", "How much disk space is left?", "Dark mode on", "Set a 10 minute tea timer" (it tells you out loud when it ends), "What's 18% of 2,450?" (an exact calculator, never mental maths).
- **Air quality:** "What's the AQI in Delhi?" Without a key this is a free satellite/model estimate (Open-Meteo), which reads lower than street monitors in very polluted cities, and Alfred says so. For real station readings, get a free token at https://aqicn.org/data-platform/token/ and put it in `.env` as `JARVIS_WAQI_TOKEN`.
- **Briefing:** "Brief me" or "What's my day?" gets your calendar, reminders, weather (set `JARVIS_CITY`) and headlines in one go.

Everything a file, page, search result or GitHub title says is treated as data, never as an instruction.

**Staying inside the free tier:** every request resends the tool list, so tools come in groups (control, github, files, media, web, system). Only the groups a request sounds like are sent, and the model can ask for another group with `use_tools` when it needs one. A plain question sends about a third fewer tokens than before, even though there are far more tools.

## Smarter and faster

- **No more long hangs:** if the main model has not answered in 9 seconds (`JARVIS_LLM_TIMEOUT_MS`), the smaller model answers instead. Rate limits and server errors fall back the same way.
- **"One moment, sir."** When something takes longer than 2.5 seconds, Alfred says so. Each phrase is made once in his normal voice and kept in `~/Library/Application Support/JARVIS/voice-cache`, so it is instant and costs no daily voice quota. `JARVIS_FILLER=0` turns it off.
- **Interrupt him by name (barge-in):** while Alfred is talking, say "Alfred" and he stops and listens. `JARVIS_BARGE_IN=0` turns it off.
- **Follow-up listening:** when Alfred asks you something ("Shall I go ahead?"), he listens for your answer straight away, with no name or hotkey. Say nothing and it ends quietly. `JARVIS_FOLLOW_UP=0` turns it off.
- **Several lookups at once:** independent lookups (a briefing, two searches) run at the same time; anything that acts runs in order.
- **Longer memory of the conversation:** the last 8 messages go with each request as before, and older turns are kept as a few short lines, so "what did I ask you earlier?" still works.
- **Captions (optional):** `JARVIS_CAPTIONS=1` shows a small bubble above the character with what it heard, what it is doing ("Checking GitHub…") and what it said. Off by default: Alfred is voice-first.

## Controlling other apps (and the safety rules)

JARVIS can switch Chrome tabs, open a WhatsApp chat, type text, press keys and click labelled buttons. The rules live in `control.js` and are enforced in code, not just in the prompt:
- Only apps in `JARVIS_CONTROL_APPS` (default: Google Chrome, Safari, WhatsApp, Spotify, Music, Notes) can receive keys or clicks.
- Pressing Return/Enter, or clicking something called send/pay/delete/etc., is parked until **you** say "yes" in your next message. The AI cannot confirm for you.
- It will not type into password fields or multi-line text.
- Talking to it again (double-tap Control) cancels whatever it was doing.
- Every action is logged to `~/Library/Logs/jarvis-actions.log`.
- Text on screens, web pages and emails is treated as data, never as orders.

Needs the **Accessibility** permission (typing/clicking) and **Automation** for Chrome/WhatsApp. Clicking by label uses the app's accessibility tree, so it can be slow, and some apps (Electron ones like Claude/Slack) expose nothing to click.

## Options (`.env`)

| Variable | Default |
|---|---|
| `GROQ_API_KEY` | required |
| `JARVIS_USER_NAME` | `sir` |
| `JARVIS_TTS_VOICE` | `troy` (also `daniel`, `austin`, `autumn`, `diana`, `hannah`) |
| `JARVIS_KOKORO_VOICE` | `bm_george` (British male; also `bm_lewis`, `bm_daniel`, `bm_fable`, `af_heart`, `af_bella`) |
| `JARVIS_TTS` | unset = Orpheus, then Kokoro, then macOS. `kokoro` = offline only (no daily limit). `say` = macOS voice only |
| `JARVIS_VOICE` | `Daniel`, the macOS fallback voice (`say -v '?'` lists them) |
| `JARVIS_CONTROL_APPS` | `Google Chrome,Safari,WhatsApp,Spotify,Music,Notes` |
| `JARVIS_VOCAB` | none. Comma-separated names (contacts, apps) so speech recognition spells them right |
| `JARVIS_CITY` | none (used when you just say "the weather") |
| `JARVIS_HOTKEY` | `Alt+Space` |
| `JARVIS_MODEL` | `openai/gpt-oss-120b` |
| `JARVIS_FALLBACK_MODEL` | `openai/gpt-oss-20b` (used when the main one is slow, busy or rate limited) |
| `JARVIS_LLM_TIMEOUT_MS` | `9000`: how long to wait for the main model before asking the fallback |
| `JARVIS_FILLER` / `JARVIS_FILLER_MS` | on / `2500`: say "One moment" when a request takes longer than this |
| `JARVIS_BARGE_IN` | on: saying the name while Alfred talks interrupts him (`0` = off) |
| `JARVIS_FOLLOW_UP` | on: listen for the answer when Alfred asks a question (`0` = off) |
| `JARVIS_CAPTIONS` | off: `1` shows captions above the character |

## Files

- `main.js` window, hotkey, the audio -> text -> reply -> speech pipeline
- `stt.js` Groq Whisper
- `brain.js` LLM loop with tool calling and short-term memory
- `tools.js` the Mac actions (add new ones here)
- `control.js` acting inside other apps, with the safety rules
- `helpers/wake.swift` the on-device wake-word (name) detector (built into its own small app by `helpers.js`)
- `vad.js` decides when you have finished talking
- `dictate.js` dictation: paste what you said into the front app
- `memory.js` the remembered facts and their tools
- `extras.js` GitHub, files, music, system, timers, calculator and web skills, with their safety checks
- `helpers/pdftext.swift` reads PDF text with macOS PDFKit (built on first use)
- `speak.js` voices: Orpheus (Groq), offline Kokoro, macOS `say` fallback
- `kokoro-worker.mjs` runs the Kokoro model in its own process
- `index.html`, `renderer.js`, `style.css` the on-screen character

`npm test` checks the tool layer (no mic or key needed).

## Limits

- Free tier has rate/daily limits; if you hit one JARVIS shows the error.
- "Turn the screen off" only locks the Mac if it asks for a password immediately after sleep.
- Calendar/Mail AppleScript can be slow with big accounts.
- Toggle (not hold) to talk: Electron global shortcuts can't see key release.
- Timers live in the running app: quitting Alfred cancels them.
- Spotify cannot be told to play a search result, so "play X" opens Spotify's search unless the song is in your Music library.
- The free web search can refuse for a minute if used heavily; Alfred then falls back to news or Wikipedia.
- Files, pages and GitHub text you ask about are sent to Groq with your question, like everything else you say.
