# COAI Think Tank

A single-file, no-build web app where 2–5 AI "seats" discuss one idea in the same shared thread. Each seat sees the full conversation (including other seats' replies) and responds in character. You post an idea, the seats debate, and a Moderator can deliver a verdict.

## Files

- `index.html` — the entire app (vanilla HTML/CSS/JS, no framework, no backend, no build step)
- `README.md` — this file

## Run it

Open `index.html` directly in a browser, or serve it from any static host:

```bash
# any static server works, for example:
python3 -m http.server 8080
# then open http://localhost:8080/index.html
```

No install, no build, no dependencies.

## Setup

### 1) OpenRouter (primary, recommended)

OpenRouter gives one API key access to many models, including free models.

1. Create an account at [https://openrouter.ai](https://openrouter.ai).
2. Create an API key at [https://openrouter.ai/keys](https://openrouter.ai/keys).
3. In the app, open **Settings** and paste the key into **OpenRouter API key**.
4. Click **Refresh model list** (the app also tries loading models on startup).
5. Turn on **Free only** to show models with zero prompt/completion pricing (plus `openrouter/free`).
6. Pick a model for each seat in the **Seats** panel.

Keys stay in memory by default. Enable **Remember on this device** only if you want keys saved to `localStorage`.

### 2) Ollama / any OpenAI-compatible endpoint (local = free)

1. Install and run [Ollama](https://ollama.com) (or another OpenAI-compatible server).
2. Allow browser calls by setting `OLLAMA_ORIGINS`. Example:

   ```bash
   OLLAMA_ORIGINS="*" ollama serve
   ```

   For tighter security, set `OLLAMA_ORIGINS` to your exact app origin instead of `*`.
3. In **Settings**, set the **Base URL** (default `http://localhost:11434/v1`).
4. Click **Refresh model list**, then select an Ollama model in a seat.

### 3) Direct provider keys (optional)

You can optionally add Anthropic, OpenAI, or Google AI keys in Settings. The app uses each provider's official API format. Direct browser calls may be blocked by CORS; if that happens, the app shows a clear error telling you to use OpenRouter instead. Never fail silently.

## Using the app

- **Seats panel (left):** configure name, color, provider/model, role prompt, on/off, and temperature. The 4 default seats are Cipher (strategist), Closer (sales/market), Devil's Advocate, and Moderator (called only when requested).
- **Turn modes:** Serial (fixed order), Rotating (order shifts each round), Mention (`@SeatName` picks who answers).
- **Rounds:** 1–5 full passes per message.
- **Controls:** Send, Run another round, Call Moderator, Stop (aborts current call), Skip seat, Regenerate last.
- **Presets:** save/load seat lineups as named presets; export/import presets as JSON.
- **Export/Import:** export thread as Markdown or JSON; import JSON to resume. Export → Clear → Import restores the full thread and seats.
- **Sessions:** saved in `localStorage` with a session list. The app still works if storage is unavailable.

## Cost & limits

- Tokens and estimated cost are shown per message and per session.
- OpenRouter pricing comes from the live models endpoint; free models show `$0`. Direct/local providers without pricing data show `$0` estimate.
- Session spending cap: pauses and asks before going over.
- 429 rate limits: backs off, retries once, then marks the seat rate-limited and continues with others.

## Known limits

- **Browser CORS:** direct Anthropic/OpenAI/Google calls may be blocked by browser CORS. Use OpenRouter for the most reliable browser experience.
- **Ollama browser access:** requires `OLLAMA_ORIGINS` to be configured; local firewall/browser rules may still block requests.
- **Context summarization:** when threads get long, older turns are summarized into a running brief (using the cheapest selected model) and the last 10 messages are kept in full for model context. The full thread remains visible in the UI/export.
- **Pricing accuracy:** cost estimates are based on provider-reported pricing/usage when available; actual billing is authoritative on the provider dashboard.
- **Local storage:** session/settings/key persistence depends on `localStorage`; private browsing or storage restrictions may prevent persistence (the app should still run).
- **Static file only:** there is no backend proxy. All provider calls go directly from the browser to the configured provider endpoint.

## Security notes

- API keys stay in memory by default.
- Keys are never logged, never put in URLs, and only sent to their own provider.
- "Remember on this device" stores keys in `localStorage` (wrapped in try/catch). "Clear all keys" removes them from memory and storage.
