# Module: Meta (Facebook Page + Instagram) publishing

## Hackathon demo mode

`META_PUBLISH_MODE=simulated` is the default and the value in `.env.example`. Leave `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, and `META_IG_USER_ID` blank. Facebook and Instagram jobs run through the existing SQLite queue and worker without any Meta request, public media URL, or tunnel. Each job stores its mode when created. Its terminal status is `simulated`, with no provider ID or permalink. Queued simulated jobs survive a restart; an interrupted simulated job returns to the queue. Older live jobs retain live mode and stay in review after an interrupted attempt. The dashboard reports simulated counts separately from confirmed live posts, and all sample engagement and sales figures are labeled demo data. Only a deliberate `META_PUBLISH_MODE=live` value allows the live Meta branches to run; live mode still requires credentials and public URLs. This section supersedes the older no-credential behavior below.

Scope: the `META_*` credentials, the Facebook/Instagram branches of `src/lib/publish.ts`, and how they behave in the demo build.

## Current state (2026-11-12)

| Item | State |
|---|---|
| Facebook publishing | Implemented — `POST /{page-id}/photos`, Facebook Reels resumable flow |
| Instagram publishing | Implemented — container → poll `status_code` → `media_publish` |
| Meta OAuth in app | **Not implemented.** No `app/api/oauth/facebook/*` route. Token is paste-in only |
| `META_PAGE_ID` | Empty — not required for the demo |
| `META_PAGE_ACCESS_TOKEN` | Empty — not required for the demo |
| `META_IG_USER_ID` | Empty — not required for the demo |
| `META_GRAPH_VERSION` | `v23.0` in `.env.example` (see note below) |
| Live publishing verified | No |

Decision taken: **live Meta posting is out of scope for the hackathon demo.** The studio's previews, scheduling, demo purchases, and monitoring run without it.

## How blank credentials behave

- `app/api/dashboard/route.ts` sets `configured.meta = Boolean(META_PAGE_ID && META_PAGE_ACCESS_TOKEN && META_IG_USER_ID)` → both account badges render "Set up".
- `src/lib/publish.ts` throws `"Facebook publishing is not configured…"` / `"Instagram publishing is not configured…"` before any network call, so nothing is attempted.
- `src/worker/index.ts` classifies that message as **`uncertain`** (only `4xx` text matches the known-rejection pattern). A deliberate no-credentials demo therefore shows `uncertain`, which reads as "may have posted". Known rough edge; not fixed.
- Jobs with no `permalink` render no **View post ↗** link, so FB/IG rows stay linkless.

## Credentials, if live posting is ever enabled

| Variable | Source | Secret |
|---|---|---|
| `META_PAGE_ID` | `GET /me/accounts?fields=id,name,tasks,access_token` | No |
| `META_PAGE_ACCESS_TOKEN` | same response `access_token`, after extending the user token | **Yes** |
| `META_IG_USER_ID` | `GET /{page-id}?fields=instagram_business_account{id,username}` | No |
| `META_GRAPH_VERSION` | URL version segment, not a credential | No |

Minting path: Graph API Explorer → user token with `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management` → Access Token Debugger → Extend Access Token (~60 days) → re-pull `/me/accounts` → Page token with `Type: Page`, `Expires: Never`.

`App ID` / `App Secret` are **not** needed by this app: there is no token-exchange route. They would only be required if a per-user OAuth flow is added.

## Permissions gotchas (verified against Meta docs, 2026)

- The Graph API Explorer permission picker only lists permissions the app has been granted. The Instagram use case must be customized first: **Use cases → Manage messaging & content on Instagram → Customize → API setup with Facebook Login → Add all required permissions**.
- That action adds `instagram_basic`, `instagram_content_publishing` (dashboard label; API/scope string is `instagram_content_publish`), `pages_show_list`, `pages_read_engagement`, `business_management`.
- `pages_manage_posts` is **not** part of the Instagram use case. It requires a Pages use case (**Add use cases → Manage everything on your Page → Permissions and features**).
- `Invalid Scopes: pages_read_user_content` in the consent dialog means a stale scope is attached to the app or its Facebook Login for Business configuration. Remove it there, not just in the Explorer. It blocks token minting only; this app never requests it.
- Meta **Test Users** cannot own a Page and cannot be Instagram professional accounts, so they are not a way to view published IG content. Testing uses real team accounts holding app roles (Standard Access, Development mode, no App Review).
- Business portfolio membership is the permission layer (Page role, IG↔Page link). An unlinked IG or missing Page task makes `/me/accounts` or `instagram_business_account` come back empty.

## Version note

`META_GRAPH_VERSION=v23.0` is still supported and the endpoints used here are stable across v23–v27. Current docs reference v26.0/v27.0; bump only if a newer parameter is needed.

## Verification commands

```bash
curl -s "https://graph.facebook.com/v23.0/$META_PAGE_ID?fields=id,name,link&access_token=$META_PAGE_ACCESS_TOKEN"
curl -s "https://graph.facebook.com/v23.0/$META_IG_USER_ID?fields=id,username&access_token=$META_PAGE_ACCESS_TOKEN"
```

Both must return JSON without an `error` key.

## Related files

- `src/lib/publish.ts` — platform branches, `assertLiveMediaUrl` (requires an `https://res.cloudinary.com/` URL and a non-local `APP_URL`)
- `src/lib/http.ts` — `providerError` redacts known secrets from error text
- `src/lib/monitoring.ts` — credential observation events (values never stored)
- `SETUP.md` §"Connect a Facebook Page and Instagram account" — operator runbook

## Audit addendum (2026-11-12)

- **The `uncertain` rough edge documented above is stale.** `src/worker/index.ts` has mapped `not configured` (and the other blocked-message patterns) to **`failed`** since `144bd21`. Live verification: no-credential FB/IG jobs end `failed` with the provider's "…is not configured" message and the badge reads "Needs attention", not "Check status".
- Meta credentials remain blank/unconfigured; the demo-scope decision (live Meta posting out of scope) is unchanged.
- A separate blocker affects *all* platforms including Meta: the worker script does not load `.env`, so it reports "not configured" even when credentials exist — see `docs/demo-readiness.md`.

## Addendum 2 (2026-11-12, architecture session)

- **The worker `.env` blocker above is stale.** `package.json:9` passes `--env-file-if-exists=.env --env-file-if-exists=.env.local`, so the worker does load credentials. The no-credential `failed` classification in the addendum above stands.
- Full correction table with file evidence: `docs/architecture.md` §8.
