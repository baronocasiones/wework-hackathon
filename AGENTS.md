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
- Optimistic status transitions: `markJobStarted` / publish-now update only `WHERE status='queued'`, so races fail closed.
- Media must be a public Cloudinary HTTPS URL and `APP_URL` must be a non-local HTTPS address before live publishing (`assertLiveMediaUrl`).
- Platform branches are isolated functions in `src/lib/publish.ts`; adding a platform means extending the enum in `domain.ts` and the switch in `publishJob`.
- No Meta OAuth route exists; Meta credentials are paste-in env values. Google/YouTube is the only OAuth flow.
- Tests are focused on domain logic, job state transitions, and restart behavior.

## Environment (`.env.example`)

`APP_URL`, `STUDIO_USERNAME`, `STUDIO_PASSWORD`, `DATABASE_PATH`, `UPLOAD_DIR`, `OPENAI_API_KEY` (+ model names), `CLOUDINARY_*`, `META_GRAPH_VERSION`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`, `GOOGLE_*`, `YOUTUBE_CHANNEL_ID`.

## Module status

- **Meta publishing** — see `docs/meta-publishing.md`. Implemented, unverified, deliberately left unconfigured for the demo.
- Everything else has no module doc yet.

## Session History

### 2026-11-12 — Meta publishing (credentials / demo scope)

- No code changes; repository clean at `144bd21 UI and unfinished backend`. Session was advisory.
- Established: live Facebook/Instagram publishing is **out of scope for the demo**. `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID` stay blank; leaving them blank makes `configured.meta` false and the badges read "Set up".
- Diagnosed `Invalid Scopes: pages_read_user_content` as an Explorer/config-only error — the app has no Meta OAuth route, so the demo cannot hit it. It only blocks token minting.
- Documented how Meta permissions actually become available (customize the Instagram use case; `pages_manage_posts` needs a Pages use case) and why Meta Test Users cannot view published IG content.
- Known rough edge left unfixed: `src/worker/index.ts` maps "publishing is not configured" to `uncertain` rather than `failed`, so clicking **Post now** on a FB/IG job without credentials implies a possible post. Fix only if the demo flow starts clicking it.
- Created `docs/` and this file.
