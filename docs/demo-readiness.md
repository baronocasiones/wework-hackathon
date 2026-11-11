# Module: Demo readiness (main feature end-to-end)

Scope: everything required to run the actual demo — install → generate → schedule → publish → track purchase. Auth/rate-limiting/other security hardening is explicitly **out of scope** by operator decision (2026-11-12); the existing Basic-auth gate is sufficient for the demo.

## Verified working (live audit, 2026-11-12, commit `ca1dcce`)

| Check | Result |
|---|---|
| Fresh clone: `npm install` → typecheck | Passes. Without `node_modules`, typecheck and tests both fail (`tsx` / `@types/node` not found) — always install first |
| `npm test` | 7/7 (domain, restart-behavior, monitoring) |
| `npm run build` | 13/13 pages, middleware compiled |
| Dev server + studio UI | 200. With `.env` auth: **401 without creds / 200 with**, both locally and through the public tunnel |
| Template pubmat (no API keys) | Works offline via FFmpeg → PNG served from `/api/media` |
| Upload → Cloudinary | Live: returns `https://res.cloudinary.com/…`, passes `assertLiveMediaUrl` |
| Public tunnel (trycloudflare) | Alive. `/product` returns 200 publicly (correctly ungated); studio gated |
| Jobs → worker | `queued → processing → failed` with explicit provider messages; optimistic transitions intact |
| Purchase → dashboard | `/api/purchase` records; dashboard aggregates demo sales (e.g. IG 1 sale · ₱49) |
| Tracked caption links | Built from public `APP_URL` tunnel host, not localhost |
| Dashboard metrics | Seeded demo samples (FB 2480 / IG 1920 / YT 5210 views), labeled "demo sample" |

## Blocking gaps (open as of 2026-11-12)

1. **Worker does not load `.env`.** `npm run worker` runs `node --import tsx src/worker/index.ts`; bare Node has no dotenv, and only the Next.js process loads `.env`. Proven live: `YOUTUBE_CHANNEL_ID` is set in `.env` yet the worker fails with "YouTube publishing is not configured. Set YOUTUBE_CHANNEL_ID." Every scheduled or "Post now" publish fails as unconfigured regardless of credentials. Fix: add `--env-file=.env` to the worker script (Node 22+).
2. **Google OAuth redirect port mismatch.** `.env` sets `GOOGLE_REDIRECT_URI=http://localhost:8000/api/oauth/google/callback`, but all npm scripts run the app on **3000**. Google matches redirect URIs exactly, so the Connect YouTube callback will be rejected → `GOOGLE_REFRESH_TOKEN` never issued → `configured.google` stays false. Fix: align the port in `.env` (and Google Cloud Console) with the run port.
3. **Gemini variables are inert.** `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_VIDEO_MODEL` are referenced nowhere in the code. `src/lib/generation.ts` reads `OPENAI_API_KEY` only (empty) → AI artwork/video buttons stay disabled and the API returns "OpenAI is not configured." Fix: add a Gemini provider branch to `generation.ts`, or accept a template-only demo.
4. **`GOOGLE_REFRESH_TOKEN` empty** — expected; it is issued by the in-app Connect flow, which is blocked by gap 2. Until then: no YouTube publishing, no live view counts (`configured.google=false`).
5. **No `published` path without YouTube live or Meta creds.** Meta is deliberately unconfigured (see `docs/meta-publishing.md`), so the "Published posts" stat stays `00` unless gaps 1–4 are closed for YouTube.

## Non-blocking notes

- First run has no seeded content or jobs; the operator generates live (template path verified). Dashboard demo metrics are seeded automatically by `src/lib/db.ts`.
- Failed jobs show no "Post now" button (queued only); a retry requires creating a new job row — allowed via `UNIQUE(content_id, platform, scheduled_at)` with a new time.
- The live config file is **`.env`** (not `.env.local` as README/AGENTS say); gitignored via `.env*`.
- OpenAI model names (`gpt-6-luna`, `gpt-image-2.6-flare`) remain unverified; only relevant if an OpenAI key is later added.
- Worker status classification: "not configured" and other blocked messages map to **`failed`**, not `uncertain` (fixed in `144bd21`; older docs said otherwise).

## Conventions

- Demo scope = main feature only; security work (auth hardening, rate limiting) deferred by operator decision.
- Secrets stay server-side in `.env`; never printed or logged (audits report key names and lengths only).
- Both `npm run dev` and `npm run worker` must run for scheduled posts; only the Next.js process sees `.env` until gap 1 is fixed.

## Superseded claims (appended 2026-11-12, architecture session)

- **Gaps 1 and 3 above are stale.** `package.json:9` now passes `--env-file-if-exists=.env --env-file-if-exists=.env.local` to the worker, and `src/lib/generation.ts:14` implements a Gemini-first `providerOrder()` (commit `c4d3166`). The worker is not unconfigured by default, and the Gemini variables are live.
- **Gap 2 is stale too.** `package.json:6,8` pins the app to port **8000**, matching `GOOGLE_REDIRECT_URI`; there is no port mismatch.
- The test count in the table above (7/7) is also outdated: 18 test cases across 5 files.
- Full correction table with file evidence: `docs/architecture.md` §8. This file is authoritative for module behavior; `docs/architecture.md` is authoritative for architecture and for these corrections.
