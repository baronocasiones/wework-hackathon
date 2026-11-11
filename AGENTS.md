# AGENTS.md — wework-hackathon (Post House content studio)

Local project memory for agents. Read this first, then `docs/` for module detail.

## What this is

Single-operator content studio: generate/assemble social posts, schedule them, publish to Facebook / Instagram / YouTube, and track demo purchases. Next.js 15 App Router + React 19, TypeScript, SQLite via Node 22's built-in `node:sqlite`. A separate worker process performs scheduled publishing.

## Commands

```bash
npm install
npm run dev        # next dev -H 127.0.0.1
npm run worker     # scheduler/publisher, polls every 5s
npm run typecheck
npm test           # node:test on tests/*.test.ts
npm run build
```

Node 22+ and FFmpeg required. Both processes must run for scheduled posts.

## Layout

| Path | Role |
|---|---|
| `app/page.tsx` | Studio UI: generation, planner, queue, monitoring |
| `app/setup/page.tsx` | In-app credential checklist |
| `app/product/*` | Public tracked product page + demo checkout |
| `app/api/*` | Route handlers (`content`, `jobs`, `dashboard`, `media`, `oauth/google`, `purchase`) |
| `middleware.ts` | HTTP Basic gate for the studio; public paths: `/product*`, `/api/purchase`, `/uploads/*`, `/api/media/*` |
| `src/lib/db.ts` | SQLite connection + schema bootstrap |
| `src/lib/domain.ts` | Zod schemas, platform enums, caption limits |
| `src/lib/publish.ts` | Platform publishers |
| `src/lib/monitoring.ts` | AI usage + credential events |
| `src/worker/index.ts` | Due-job loop, status transitions |
| `docs/` | Per-module state and decisions |

## Conventions

- Secrets are server-side only, from `.env.local` (never committed, never logged). `providerError()` in `src/lib/http.ts` redacts token values from error text; `monitoring.ts` stores credential metadata, never values.
- Every privileged route is gated by `middleware.ts`; the app refuses public access when `STUDIO_PASSWORD` is blank.
- One `publish_jobs` row per content × platform × scheduled time (`UNIQUE(content_id, platform, scheduled_at)`).
- A job becomes `published` only on a provider ID **and** a confirmed permalink / public processing state. Ambiguous outcomes become `uncertain` or `needs_review` and are never auto-retried. Known 4xx rejections become `failed`.
- Optimistic status transitions: `claimDueJob` / publish-now update only `WHERE status='queued'`, so races fail closed. (`markJobStarted` in `publish.ts` is dead code; see `docs/architecture.md`.)
- Media must be a public Cloudinary HTTPS URL and `APP_URL` must be a non-local HTTPS address before live publishing (`assertLiveMediaUrl`).
- Platform branches are isolated functions in `src/lib/publish.ts`; adding a platform means extending the enum in `domain.ts` and the switch in `publishJob`.
- No Meta OAuth route exists; Meta credentials are paste-in env values. Google/YouTube is the only OAuth flow.
- Tests are focused on domain logic, job state transitions, and restart behavior.

## Environment (`.env.example`)

`APP_URL`, `STUDIO_USERNAME`, `STUDIO_PASSWORD`, `DATABASE_PATH`, `UPLOAD_DIR`, `OPENAI_API_KEY` (+ model names), `CLOUDINARY_*`, `META_GRAPH_VERSION`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`, `GOOGLE_*`, `YOUTUBE_CHANNEL_ID`.

## Module status

- **Meta publishing** — see `docs/meta-publishing.md`. Implemented, unverified, deliberately left unconfigured for the demo.
- **Demo readiness** — see `docs/demo-readiness.md`. Audited 2026-11-12; the listed blockers (worker `.env`, OAuth port, Gemini vars) are **stale** — corrected in `docs/architecture.md` §8 and flagged in that file's "Superseded claims" section.
- **Architecture** — see `docs/architecture.md`. Added 2026-11-12; owns topology, module map, data model, job invariants, and integration boundaries. Answers the monolith question (modular monolith + sidecar worker) and corrects stale claims in the other docs.
- **Pipeline (schedule → publish → worker)** — see `docs/pipeline.md`. Added 2026-11-12; owns pipeline behavior, outcome taxonomy, free-tier budget, findings (C1–M6), and implementation status. C1–C3, H1–H3, M3–M6 implemented; M1 (streaming) deferred.
- **Generation (AI output quality)** — see `docs/generation.md`. Added 2026-11-12; style system, image tuning, template rendering fixes, video audio probe/mux, runtime agent loop, retry endpoint.
- Everything else has no module doc yet.

## Session History

### 2026-11-12 — Meta publishing (credentials / demo scope)

- No code changes; repository clean at `144bd21 UI and unfinished backend`. Session was advisory.
- Established: live Facebook/Instagram publishing is **out of scope for the demo**. `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID` stay blank; leaving them blank makes `configured.meta` false and the badges read "Set up".
- Diagnosed `Invalid Scopes: pages_read_user_content` as an Explorer/config-only error — the app has no Meta OAuth route, so the demo cannot hit it. It only blocks token minting.
- Documented how Meta permissions actually become available (customize the Instagram use case; `pages_manage_posts` needs a Pages use case) and why Meta Test Users cannot view published IG content.
- Known rough edge left unfixed: `src/worker/index.ts` maps "publishing is not configured" to `uncertain` rather than `failed`, so clicking **Post now** on a FB/IG job without credentials implies a possible post. Fix only if the demo flow starts clicking it.
- Created `docs/` and this file.

### 2026-11-12 — Demo-readiness audit (repo-wide E2E)

- No code changes; advisory audit with live verification: `npm install`, typecheck, tests 7/7, build 13/13 pages, dev server, worker, and curl-driven end-to-end smoke test (generate → schedule → worker → purchase → dashboard).
- Verified working: offline template pubmat via FFmpeg, job state machine (`queued → processing → failed` with explicit messages), live Cloudinary uploads, public trycloudflare tunnel with Basic-auth gate (401/200 local + tunnel), tracked caption links on the public `APP_URL` host, demo purchases aggregating into the dashboard.
- Operator created **`.env`** this session (auth, Cloudinary, public `APP_URL` tunnel, Google client creds, `YOUTUBE_CHANNEL_ID`). The live config file is `.env`, not `.env.local`. Audit reports key names/lengths only, never values.
- Correction: the worker maps "publishing is not configured" to **`failed`**, not `uncertain` — the previous session's rough edge was already fixed in `144bd21`. `docs/meta-publishing.md` addended.
- New blockers documented in `docs/demo-readiness.md`: (1) worker script doesn't load `.env` (needs `--env-file`) so all publishes fail unconfigured regardless of creds; (2) `GOOGLE_REDIRECT_URI` points at port 8000 while the app runs on 3000; (3) `GEMINI_*`/`AI_PROVIDER` vars are inert — code reads `OPENAI_API_KEY` only; (4) `GOOGLE_REFRESH_TOKEN` empty pending the Connect flow; (5) no `published` demo path for FB/IG (Meta out of scope by prior decision).
- Conventions: security/rate-limiting remain deferred; demo scope is main feature only; `npm test`/typecheck/build must be run after any fresh clone (node_modules absent).

### 2026-11-12 — Pipeline implementation (C1–C3, H1–H3, M3–M6)

- Implemented: outcome model (C3), fetch timeout (C1), YouTube confirmation (C2), dashboard quota fix (H1), token cache (H2), schedule error masking (H3), backlog metric (M3), graceful shutdown (M4), post-now collision handling (M5), dead code removal (M6). M1 (streaming) deferred.
- Conventions established: `PublishOutcome` discriminated union replaces string matching; `PublishError` class with `PublishFailureReason`; module-level token cache (50-min TTL, 60s stale-gate); `withTimeout` pattern; baseline-gate pattern for findings.
- Tests: 23/23 pass (added `schedule.test.ts`, `youtube-outcome.test.ts`). Typecheck + build clean. No new dependencies.

### 2026-11-12 — Generation agent model fix + token verification (live verified)

- Fixed: default vision model `gemini-2.0-flash` (unavailable) → `gemini-3.1-flash-lite`; added mime-type auto-detection (PNG/JPEG) in critique; normalized usageMetadata → input/output/total tokens so critique calls record real token counts.
- Verified: critique now succeeds (outcome success, 1207 input / 137 output / 1344 total tokens, ~2.5s). Agent loop scores real images. Token cost per artwork confirmed ~1,488 Gemini tokens (~$0.0001-0.0002).
- Removed debug console.error. Updated .env.example default. Updated test expectation (gemini-3.1-flash-lite).
- Tests: 22/22 pass. Typecheck + build clean.

### 2026-11-12 — Generation + agent loop + retry endpoint (live verified)

- Implemented: style system (6 presets, `recommendStyle`), Cloudflare tuning (steps 4→8, model env), template rendering fixes (dynamic font size, fontfile env), video audio probe + optional ambient mux, runtime agent critique loop (Gemini vision, max 3 images/2 videos, score≥70, daily cap 50), `POST /api/jobs/[id]/retry`, dashboard agent metrics, UI style display + Retry button.
- DB: `content.style` column + `generation_attempts` table (guarded migration).
- New files: `src/lib/styles.ts`, `src/lib/agent-critique.ts`, `app/api/jobs/[id]/retry/route.ts`, `docs/generation.md`.
- Conventions: agent loop enabled by default but fail-closed on daily cap; prompt injection mitigated via delimiters; style constrained to registry; audio mux default off (fal clips already contain audio).
- Live verification: Gemini style + vision critique, Cloudflare artwork/template, Grok video (ffprobe audio present), agent loop (2 attempts, avg score 100), dashboard panel, retry re-queue — all passed. Cloudflare/fal paths exercised end-to-end.
- Tests: 22/22 pass (updated for style/critique calls + 8 steps). Typecheck + build clean. No new dependencies.

### 2026-11-12 — Architecture documentation (modular monolith audit)

- No code changes, no API endpoints defined, no dependencies added. Created `docs/architecture.md` (9 sections, 8 mermaid diagrams) answering the operator's question: the repo is a **modular monolith with a sidecar worker process** — one deployable unit, two OS processes, one SQLite file as the only runtime coupling, no service boundaries. Code organization is modular; deployment, data, and domain are monolithic.
- Method: architect skill workflow. Three parallel explorer passes (app/HTTP layer, domain/persistence core, runtime topology/integrations) grounded the model; an arena of three candidate doc designs followed — all three independently reached the same verdict, so no re-run was needed. Candidate 1 became the base; grafts came from Candidates 2 and 3 (four-senses verdict table, outcome-taxonomy diagram, exhaustive stale-claim corrections, scaling notes). Cross-judge skipped: no cross-family model available without guessing model IDs.
- Created `docs/architecture.jpg` (1420×994) — D1 process topology rendered from the doc's own mermaid source via headless Chrome at 3× scale, trimmed, white margin. A pointer line was added under the doc's scope paragraph.
- Conventions established: `docs/architecture.md` owns topology, module map, data model, job invariants, flows, and integration boundaries; module docs own module behavior; `AGENTS.md` owns commands and conventions. Stale claims are corrected in the architecture doc rather than by rewriting the stale docs. Rendered diagrams are generated from the doc's mermaid source so image and source cannot drift.
- Corrected in `AGENTS.md`: the optimistic-transition convention cited dead `markJobStarted`; the real claim path is `claimDueJob` (`src/lib/jobs.ts:10-14`).
- Additive "superseded claims" notes appended to `docs/demo-readiness.md` and `docs/meta-publishing.md`, both pointing at `docs/architecture.md` §8. No existing content was removed from any doc.
