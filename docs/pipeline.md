# Module: Pipeline (schedule → publish → worker)

Scope: the content publishing pipeline — `POST /api/jobs` (schedule), `POST /api/jobs/[id]/publish` (post now), the worker loop in `src/worker/index.ts`, and the platform adapters in `src/lib/publish.ts`. Generation is out of scope for this doc (see `docs/architecture.md` §9). Topology, module map, data model, and invariants are owned by `docs/architecture.md`; this doc owns pipeline *behavior*, the outcome taxonomy, and the improvement findings.

Authoritative as of commit `d00088c` (2026-11-12). Findings verified by reproduction scripts in `/tmp/opencode/pipeline-audit/` (read-only; not committed).

## 1. Verdict

The pipeline is **functionally complete but operationally fragile on free tiers**. The job state machine and optimistic transitions are sound; the fragility is in (a) the outcome taxonomy (string matching), (b) the absence of timeouts, (c) YouTube confirmation logic, (d) dashboard quota exhaustion, and (e) error masking in the schedule route. None of these are demo-blocking today because Meta/Google are unconfigured, but all are correctness or cost bugs on the real path.

## 2. Findings (verified)

Each finding cites the code and the proof that confirmed it.

| ID | Severity | Finding | Evidence / proof |
|---|---|---|---|
| C1 | Critical | No fetch timeout anywhere in `src/lib/publish.ts`; a hung provider blocks the worker tick forever. | `grep AbortSignal src/lib/publish.ts` → none. **Proof:** `repro-hang.ts` — `publishJob` did not settle within 3s when `fetch` never resolves. |
| C2 | Critical | YouTube misclassifies outcomes. `uploadStatus` valid values are `deleted`, `failed`, `processed`, `rejected`, `uploaded`; the code requires exactly `"processed"` (`publish.ts:130`), so `failed`/`rejected` → `needs_review` and unverified-project private videos → `accepted_pending`. | YouTube Data API docs (verified this session). **Proof:** `repro-youtube.ts` — `uploadStatus="failed"` mapped to `needs_review`. |
| C3 | Critical | Outcome taxonomy is string matching on provider error text (`worker/index.ts:25-27`). Rewording an error silently changes `failed` vs `uncertain`. | `worker/index.ts:25-27`. |
| H1 | High | `GET /api/dashboard` is a read endpoint with write + network side effects: every 12s poll refreshes the Google token (writing a `credential_events` row) and calls `channels.list` + `videos.list` when published YT jobs exist. | `dashboard/route.ts:14-17,30`; `publish.ts:142-153`. **Proof:** `repro-dashboard.ts` — over 2 polls: 2 token calls, 2 channel checks, 2 stats calls, 3 `credential_events` rows. At 12s polling this is ~14,400 shared-pool units/day, over the 10,000/day quota. |
| H2 | High | `googleAccessToken()` refreshes the token and checks the channel on every YouTube publish (1 OAuth call + 1 `channels.list` per publish). | `publish.ts:136-159`. **Proof:** `repro-youtube.ts` counted 1 token call per publish. |
| H3 | High | `app/api/jobs/route.ts:35-37` catch-all returns 409 for any insert error, masking non-duplicate DB failures. | `jobs/route.ts:35-37`. **Proof:** `repro-409.ts` — a forced DB trigger error returned 409 "already exists". |
| M1 | Medium | `loadPublicMedia` buffers the whole video in memory (`media.ts:44`); no streaming upload for FB Reels / YouTube. | `media.ts:37-45`; `publish.ts:44,115`. |
| M2 | Medium | No tests for `publish.ts` or the worker loop; only `jobs.test.ts` covers claim/restart. | `grep publish tests/` → only `jobs.test.ts`. |
| M3 | Medium | One job per 5s tick, no concurrency, no backlog metric. | `worker/index.ts:9-14,37`; architecture §3. |
| M4 | Medium | No graceful shutdown; SIGTERM leaves `processing` rows recovered to `uncertain` on next start. | `worker/index.ts:6-7`; architecture §3. |
| M5 | Medium | Post-now `UPDATE` can violate `UNIQUE(content_id, platform, scheduled_at)` → unhandled 500. | `jobs/[id]/publish/route.ts:8`; `db.ts:25`. |
| M6 | Low | `markJobStarted` dead code; `attempts` written, never read. | `publish.ts:173-176`; architecture §7. |

## 3. Free-tier budget (hard constraint)

The design below must not exceed these. Per-publish cost:

| Platform | Cost | Notes |
|---|---|---|
| Facebook image | 1 BUC call | Page token → BUC limit `4800 × engaged users / 24h` (0 engaged users = 0 budget). |
| Facebook Reel | 1 start + ≤18 status polls (3s) + 1 finish = ≤20 BUC calls | Reels API hard cap: **30 API-published Reels / 24h**. |
| Instagram image | 2 Graph calls (create + publish) | |
| Instagram Reel | 1 create + up to 18 status polls (3s) + 1 publish = ≤20 calls | Each poll is a BUC call. |
| YouTube | 1 `videos.insert` (1 unit, own 100/day bucket) + 1 `videos.list` + 1 `channels.list` (2 shared units) | Since 2026-06-01 uploads have their own bucket (was ~1600 shared). Unverified projects post privately → `privacyStatus` may be `private` despite requesting `public`. |
| Cloudinary | 1 transformation (upload) + storage + bandwidth | Free: 25 credits/month (1 credit = 1000 transforms OR 1 GB storage OR 1 GB image bandwidth OR 1 GB video bandwidth). Max video 100 MB. |
| Dashboard (current) | 2 shared units + 1 OAuth refresh per poll when YT jobs exist | At 12s polling ≈ 14,400 shared units/day — **exceeds the 10,000/day quota**. |

Design rule: **no new API calls per publish; no polling that exhausts quota; cache tokens; stale-gate stats.**

## 4. Design (synthesized)

Arena run serially (the parallel subagent dispatch hit the OpenCode free-tier limit; model diversity was not established). Three candidates were produced and screened against `design-red-flags.md`:

- **Candidate 1** — structured discriminated-union outcome returned by every adapter; smallest worker change; module-level token cache.
- **Candidate 2** — typed error taxonomy thrown by adapters + single mapper; lease/heartbeat claim for multi-worker safety.
- **Candidate 3** — event-sourced outcome log; bounded worker pool; quota ledger table.

### Synthesis decision
**Base: Candidate 1.** It is the smallest change that fixes C1–C3, H1–H2, and M5 with a deep module (`publishJob` hides provider complexity behind a smaller surface) and no schema migration. Grafts:

- From Candidate 2: the principle that `rate_limited`/`timeout`/5xx are terminal `failed` (not `uncertain`) — a known rejection or timeout is not an ambiguous outcome; the operator retries manually. The lease/heartbeat model is **rejected** as premature: `claimDueJob` is already fail-closed (`UPDATE ... WHERE status='queued'`, `changes === 1`), and `recoverInterruptedJobs` handles single-worker crashes. Multi-worker safety is out of scope for a single-operator studio.
- From Candidate 3: quota accounting is **grafted as documentation + a simple in-process dashboard cache** (token TTL, stale-gated stats), not as a `quota_usage` table or a worker pool. The event-sourced log is **rejected** as too much machinery for a single outcome value.

### 4.1 Outcome model (`src/lib/publish.ts` + `src/lib/domain.ts`)

```ts
export type PublishFailureReason =
  | "not_configured" | "not_enabled" | "incomplete" | "does_not_match"
  | "connect_cloudinary" | "preview_only" | "public_app_url" | "set_app_url"
  | "rejected_4xx" | "rate_limited" | "timeout" | "unknown";

export type PublishOutcome =
  | { kind: "published";    providerId: string; permalink: string }
  | { kind: "needs_review"; providerId: string; permalink: string | null; reason: "accepted_pending" | "uncertain" }
  | { kind: "failed";       reason: PublishFailureReason; detail: string };

export class PublishError extends Error {
  constructor(readonly reason: PublishFailureReason, message: string) { super(message); }
}

export async function publishJob(job: Job): Promise<PublishOutcome>
```

- Adapters return `published`/`needs_review` directly; blocks throw `PublishError(reason, detail)`. No string matching.
- `providerError()` maps HTTP status → reason: 429 → `rate_limited`, other 4xx → `rejected_4xx`, 5xx → `unknown`.
- YouTube confirmation (`publish.ts:120-133`): `uploadStatus in ("failed","rejected")` → throw `PublishError("rejected_4xx", ...)`. `uploadStatus === "uploaded"` → `needs_review` (accepted_pending). `uploadStatus === "processed"` → check `channelId`/`privacyStatus`/`processingStatus`. Unverified project (`privacyStatus === "private"` despite requesting public) → `needs_review` accepted_pending.
- Worker maps `outcome.kind` → status directly: `published`→`published`, `needs_review`→`needs_review`, `failed`→`failed`. No regex.

### 4.2 Worker resilience (`src/worker/index.ts`)

```ts
const JOB_TIMEOUT_MS = 120_000;
// per tick:
let outcome: PublishOutcome;
try {
  outcome = await withTimeout(publishJob(due), JOB_TIMEOUT_MS);
} catch (e) {
  const err = e instanceof PublishError ? e : new PublishError("unknown", String(e));
  outcome = { kind: "failed", reason: err.reason, detail: err.message.slice(0, 500) };
}
const { status, providerId, permalink, error } = mapOutcome(outcome);
db.prepare("UPDATE publish_jobs SET status=?,provider_id=COALESCE(?,provider_id),permalink=COALESCE(?,permalink),error=?,updated_at=? WHERE id=? AND status='processing'")
  .run(status, providerId, permalink, error, nowIso(), due.id);
```

- `withTimeout` uses `Promise.race` with `setTimeout` → `PublishError("timeout", ...)`.
- SIGTERM handler sets `shuttingDown = true`; the current tick either finishes or the job is recovered to `uncertain` by `recoverInterruptedJobs` on next start (existing behavior, M4 mitigated by not hanging).
- Single-threaded retained (default concurrency 1); no worker pool.
- No string matching anywhere.

### 4.3 Dashboard (`app/api/dashboard/route.ts`)

- `googleAccessToken()` cached in module scope with a 50-min TTL: `{ token, expiresAt }`. Refresh only when expired.
- `youtubeStats()` stale-gated: only call when `Date.now() - lastStatsAt > 60_000`; otherwise reuse cached stats.
- Stop calling `recordCredentialEvent` on every poll; record only on actual refresh.
- Result: ≤ 2 YouTube shared units per minute when stats are stale, 0 otherwise; token refresh at most every 50 min. No write side effect on the read endpoint.

### 4.4 Schedule (`app/api/jobs/route.ts`)

Replace `catch {}` with typed discrimination:
- UNIQUE constraint violation → 409 "already exists".
- Other DB error → 500 with message.
- `allowedPlatformCaption` throw → 400 with message.

### 4.5 Media (`src/lib/media.ts`)

- Streaming upload for FB Reels / YouTube is deferred (M1). The current full-buffer download is acceptable for demo-sized videos (≤100 MB Cloudinary limit). Document the memory spike.

## 5. Blast-radius evidence

| Change | One fact it's safe because of | Proof |
|---|---|---|
| Outcome model (C3) | `publishJob` has exactly one caller (`src/worker/index.ts:19`); `confirmation` is consumed only inside `publish.ts`. | `grep` over `src/` + `app/` → only `publish.ts` and `worker/index.ts`. |
| Timeout addition (C1) | `claimDueJob` updates only `WHERE status='queued'` and requires `changes === 1`; a hung job never writes a terminal status, so the next worker start recovers it to `uncertain`. | `repro-hang.ts` + `jobs.test.ts` (claim one-shot, restart recovery). |
| Dashboard cache (H1) | The studio UI polls `/api/dashboard` every 12s and reads `configured` + `metrics`; it does not depend on `credential_events` growth or token refresh. | `app/page.tsx:58` polling; `dashboard/route.ts` response shape unchanged. |
| Schedule catch split (H3) | The route's transaction is `BEGIN IMMEDIATE` ... `COMMIT`/`ROLLBACK`; splitting the catch does not change the transactional guarantee. | `jobs/route.ts:25-37`. |
| YouTube confirmation (C2) | `publishJob` returns `needs_review` for non-confirmed outcomes; the worker writes `needs_review` which is terminal and never auto-retried. No retry loop exists. | `worker/index.ts:20,28`; architecture §7. |

## 6. Benchmark evidence

Run on this machine (Node 26, SQLite WAL, no provider calls):

| Measurement | Result | Interpretation |
|---|---|---|
| Worker claim+write throughput (mock publish, instant) | 50 jobs in 35 ms → **~1,430 jobs/s** | The DB claim path is not the bottleneck; provider latency is. With one job per 5s tick + provider latency, real throughput ≈ 1/(5s + provider latency). For a single-operator studio this is acceptable. |
| Dashboard GET latency (stubbed fetch, one published YT job) | 73 ms | In production with real Google calls, latency is dominated by the OAuth token refresh + `channels.list` + `videos.list`; the cache removes 2 of 3 on steady state. |
| `publishJob` with hung fetch | Did not settle in 3s | Confirms C1; the fix (timeout) is required. |

Limiter: provider latency and the 5s single-job loop. The benchmark did not measure real provider latency (no live credentials); that is the next thing to measure once credentials are configured.

## 7. Open questions

- Should `rate_limited` become a non-terminal `retryable` status? Requires a retry loop and a new status enum value; conflicts with "terminal states never auto-retried."
- Should the token cache live in `app_secrets` (shared across the studio and worker processes) instead of module scope? Module scope is simpler but per-process.
- Is a "retry failed job" action needed in the UI, or is re-creating the job acceptable?
- Should the worker pool size be configurable (`WORKER_CONCURRENCY`), or is single-threaded sufficient for the demo?

## 8. Implementation status (2026-11-12)

Implemented (typecheck + 23 tests + build pass):

- **C1** — `withTimeout` + `JOB_TIMEOUT_MS` in `src/worker/index.ts`; worker no longer hangs on a stuck provider.
- **C2** — YouTube confirmation logic: `failed`/`rejected` → throw `PublishError("rejected_4xx")`; `uploaded` → `needs_review`; unverified (private) → `needs_review`. Verified by `tests/youtube-outcome.test.ts`.
- **C3** — `PublishOutcome` discriminated union + `PublishError` (in `src/lib/domain.ts`); `publishJob` returns `Promise<PublishOutcome>`; worker maps `outcome.kind` → status; no string matching remains.
- **H1** — dashboard stats stale-gated (60s) + module-level cache in `app/api/dashboard/route.ts`; token cache means no `credential_events` write on steady state.
- **H2** — `googleAccessToken()` caches the token (50-min TTL) in `src/lib/publish.ts`.
- **H3** — schedule route catch split: UNIQUE → 409, validation → 400, other → 500. Verified by `tests/schedule.test.ts`.
- **M3** — `backlog` count added to dashboard response.
- **M4** — SIGTERM/SIGINT handlers in the worker.
- **M5** — post-now route wrapped in try/catch (UNIQUE → 409).
- **M6** — `markJobStarted` dead code removed.

Deferred:
- **M1** (streaming upload) — not trivial; demo videos are ≤100 MB; full-buffer download remains. Revisit if memory becomes an issue.

Tests added: `tests/schedule.test.ts` (H3), `tests/youtube-outcome.test.ts` (C2). Existing 21 tests still pass (23 total).

## 9. Tests (load-bearing invariants)

Existing: `tests/jobs.test.ts` (claim one-shot, restart recovery), `tests/domain.test.ts` (platform rules, caption limits), `tests/monitoring.test.ts` (no secret leakage), `tests/gemini.test.ts`, `tests/generation-fallback.test.ts`.

Add: outcome mapping (C2), timeout recovery (C1), schedule error discrimination (H3), dashboard steady-state (H1/H2).

## Session: 2026-11-12 — Pipeline implementation

- Implemented C1, C2, C3, H1, H2, H3, M3, M4, M5, M6. M1 (streaming) deferred.
- Conventions established: `PublishOutcome` discriminated union replaces string-matched taxonomy; `PublishError` class with `PublishFailureReason`; module-level token cache (50-min TTL, 60s stale-gate); `withTimeout` pattern; baseline-gate pattern for findings.
- Tests: 23/23 pass (added `schedule.test.ts`, `youtube-outcome.test.ts`). Typecheck + build clean.
- No new dependencies. No new API endpoints.
