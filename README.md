# cf-ai-mindcup-voice-recall

A voice-based active recall app that transcribes your spoken revision, compares it against your study notes, and highlights what you got right, wrong, or missed.

**Live Preview:** https://mindcup-audio-demo.nithishsharavanan.com/

## Features

- **Voice & Note Input:** Paste your study notes and record a voice explanation.
- **AI Evaluation:** Transcribes audio and evaluates recall against the note using Cloudflare Workers AI, returning structured JSON (`correct`, `wrong`, `missed`) with a 1-sentence reason.
- **Validation & Regeneration:** Validates output against a JSON schema and verifies that quoted text exists in the original note, automatically regenerating if validation fails.
- **Interactive Highlights:** Displays the note with color-coded highlights; hover or click to inspect the spoken quote, status, and reasoning.
- **Session History & Progress:** Tracks notes and multiple review attempts per browser session ID to show progress over time.
- **Async Processing & Rate Limiting:** Polls review status asynchronously and enforces IP-based rate limits.

## Architecture

```text
Browser (Vue + MediaRecorder) → Worker (Hono + RateLimiterObject) → RevisionCheckWorkflow [Whisper → Gemma 4 → Zod/Quote Validator] → SessionObject (SQLite)
```

- **24 kbps Opus audio:** Keeps voice recordings compact and well under the 1 MiB Workflow payload limit.
- **Verbatim quote verification:** Validates LLM JSON with Zod and checks every quoted snippet against the original note, regenerating on mismatch.
- **IP rate limiting:** Enforced via `RateLimiterObject` Durable Object before starting workflows.

## Tech Stack

- **Backend:** TypeScript, Hono, Cloudflare Workers, Cloudflare Workflows, Durable Objects (SQLite), Workers Static Assets
- **AI:** Cloudflare Workers AI (Whisper Large v3 Turbo + Gemma 4 26B)
- **Frontend:** HTML, Vue.js, Tailwind CSS
- **Validation:** Zod

## Getting Started

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Run tests
npm test

# Generate Cloudflare types
npm run cf-typegen

# Deploy to Cloudflare
npm run deploy
```

See [PROMPT_HISTORY.md](./PROMPT_HISTORY.md) for the AI-assisted development prompt history.
