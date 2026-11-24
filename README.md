# COAI Think Tank

A single-file, no-build web app where 2–5 AI “seats” discuss one idea in a shared thread. Each seat sees recent conversation and, as threads grow, a running summary. You post an idea, the seats debate it, and a Moderator can deliver a verdict when called.

## Files

- `index.html` — the app (vanilla HTML/CSS/JS; no runtime framework or build step)
- `README.md` — setup and usage notes
- `tests/app-regressions.test.cjs` — dependency-free Node regression tests
- `.github/workflows/test.yml` — runs the tests in GitHub Actions

## Run it

Open `index.html` directly in a browser, or serve it from a static host:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/index.html
```

The app itself has no install or build step. Developers can run the built-in regression suite with Node.js 22 or later; no npm install is needed:

```bash
node --test
```

For browser access to Ollama, serve the app from an HTTP origin and configure Ollama for that exact origin (see below). A `file://` page has an opaque origin and is not recommended for local-provider calls.

## Setup

### 1) OpenRouter (primary, recommended)

OpenRouter gives one API key access to many models, including free models.

1. Create an account at [https://openrouter.ai](https://openrouter.ai).
2. Create an API key at [https://openrouter.ai/keys](https://openrouter.ai/keys).
3. In the app, open **Settings** and paste the key into **OpenRouter API key**.
4. Click **Refresh model list** (the app also tries loading models on startup).
5. Turn on **Free only** to show models with zero prompt/completion pricing (plus `openrouter/free`).
6. Pick a model for each seat in the **Seats** panel.

Keys stay in memory by default. **Remember on this device** saves them in plaintext in this browser’s `localStorage`; only enable it on a trusted device/profile.

### 2) Ollama / OpenAI-compatible endpoint

1. Install and run [Ollama](https://ollama.com) (or another OpenAI-compatible server).
2. Allow browser calls from the exact origin serving the app. For the Python server above, use:

   ```bash
   OLLAMA_ORIGINS="http://localhost:8080" ollama serve
   ```

   Use the origin exactly as it appears in the browser, including host and port. Avoid `OLLAMA_ORIGINS="*"`: it may let any website opened in your browser call/read your locally running Ollama endpoint.
3. In **Settings**, set the **Base URL** (default `http://localhost:11434/v1`).
4. Click **Refresh model list**, then select a model in a seat.

### 3) Direct provider keys (optional)

You can optionally add Anthropic, OpenAI, or Google AI keys in Settings. The app uses each provider’s API format. Direct browser calls may be blocked by CORS; if that happens, use OpenRouter or a server-side proxy.

## Using the app

- **Seats panel:** configure 2–5 seats with name, color, provider/model, role prompt, enabled state, and temperature. The four defaults are Cipher, Closer, Devil’s Advocate, and Moderator. The Moderator is excluded from automatic rounds unless explicitly mentioned in Mention mode or called with **Call Moderator**.
- **Turn modes:** Serial (fixed order), Rotating (order shifts each round), Mention (`@SeatName` picks who answers).
- **Rounds:** 1–5 full passes per message.
- **Controls:** Send, Run another round, Call Moderator, Stop, Skip seat, and Regenerate last.
- **Presets:** save/load seat lineups as named presets; export/import presets as JSON. Imported lineups must contain 2–5 seats.
- **Export/Import:** export a thread as Markdown or JSON; import JSON to resume. Imported message records are validated and receive fresh internal IDs. Import only files you trust.
- **Sessions:** saved in `localStorage`. If a write fails, the app warns you; export the thread JSON before closing and free browser storage. The app still works in memory when storage is unavailable, but unsaved data will not survive a refresh.

## Cost & limits

- Token counts and costs are estimates. OpenRouter pricing/usage is used when available; free models show `$0`.
- Providers or models without pricing/usage data show a **known subtotal / actual unknown**, not a free `$0` estimate. With the spending cap enabled, the app asks before each request whose cost is unknown or whose estimated request cost would cross the cap.
- The request estimate uses a conservative character-based prompt estimate and the configured maximum output budget. Tokenization and provider billing can differ, so the cap is a safeguard, not a guaranteed hard spending limit. A cap value of `0` disables the cap.
- Interrupted requests may still be billed by the provider; their final cost is marked unknown. Check the provider dashboard for authoritative billing.
- 429 rate limits back off, retry once, then mark the seat rate-limited and continue with others.

## Known limits

- **Browser CORS:** direct Anthropic/OpenAI/Google calls may be blocked. Use OpenRouter for the most reliable browser experience.
- **Ollama browser access:** requires `OLLAMA_ORIGINS` to allow the app’s exact origin; local firewall/browser rules may still block requests.
- **Context:** OpenRouter model context lengths are used when available; other models use a conservative fallback. The app summarizes older turns on long threads and trims older context against an approximate token budget when needed. It tries to retain the latest user message and displays a context-trimmed indicator. The full thread remains visible and exportable, but a provider’s tokenizer may differ from the estimate.
- **Pricing accuracy:** estimates are not invoices; actual billing on the provider dashboard is authoritative.
- **Local storage:** session/settings persistence depends on browser storage and its quota. Failed writes are surfaced, but export important threads before clearing browser data or closing after a storage warning.
- **Static file only:** there is no backend proxy. Provider calls and API keys go directly from the browser to the configured endpoint.
- **Vercel Web Analytics:** the app injects `/_vercel/insights/script.js` only on `*.vercel.app` hosts. Other static hosts make no analytics request. Custom domains do not auto-enable it; add Vercel’s analytics integration yourself if you want analytics there.

## Security notes

- API keys stay in memory by default and are not placed in URLs. “Remember on this device” stores them unencrypted in `localStorage`.
- Thread and preset JSON imports are treated as untrusted data and validated before use. Do not import files from unknown sources.
- With no backend proxy, provider credentials are sent directly to the selected provider/endpoint from the browser.
