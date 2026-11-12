# Post House content studio

A single-operator demo for making social content, preparing platform-specific posts, scheduling them, and comparing results. Facebook and Instagram posting runs locally in simulation mode by default. Local uploads and simulated posts need no platform credentials or public media hosting.

## Run locally

1. Install Node.js 22 or newer and FFmpeg. This app uses Node 22's built-in `node:sqlite` module, which is marked experimental by Node in this release line.
2. Copy `.env.example` to `.env.local`. Keep every secret server-side. Do not commit `.env.local`.
3. Run `npm install`.
4. Run `npm run dev` in one terminal.
5. Run `npm run worker` in a second terminal. The worker checks the SQLite schedule every five seconds.
6. Open `http://localhost:8000/register` to create the first owner account, then use `/login` on later visits. If `STUDIO_PASSWORD` is set, enter that value as the one-time setup key during registration.

The app scripts bind to `localhost` on port 8000 so the local demo is not reachable directly from the LAN. Point any HTTPS tunnel at `http://localhost:8000`.

The app stores SQLite data under `./data/studio.sqlite` and local preview files under `./public/uploads`. Owner credentials and revocable sessions are also stored in SQLite; passwords are salted with scrypt and session tokens are stored as hashes. Registration creates only the first owner account. If `STUDIO_PASSWORD` is set, it is a one-time setup key for that registration; it is no longer a browser Basic Auth password. Without a setup key, registration is restricted to localhost. Set a strong setup key before exposing an unregistered studio through a public tunnel. Sign in at `/login` with the account password, and use **Sign out** to revoke the current session. The product page, demo checkout, and uploaded media stay public.

Set `META_PUBLISH_MODE=simulated` and leave `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, and `META_IG_USER_ID` blank for the hackathon demo. The worker records Facebook and Instagram simulations without contacting Meta. Local previews and simulated posting need no Cloudinary URL or public tunnel. Live publishing needs signed Cloudinary uploads and a public HTTPS `APP_URL`; use a tunnel only if other people need to open the demo product page. `GOOGLE_REDIRECT_URI` can remain `http://localhost:8000/api/oauth/google/callback` for local OAuth.

See `/setup` in the app for a short credential checklist. The operator should also use the separate `SETUP.md` for full account configuration steps.

For both Publication Materials options, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `.env.local` or `.env`. [Cloudflare FLUX.1 Schnell](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) is the only image generator. The template uses a Cloudflare background with locally editable text; editing the text reuses that background. Gemini can suggest titles, captions, and subtitles; without its key, blank text receives local defaults. Cloudflare does not report token usage in its image response, so its token fields show unavailable. Restart the app after changing environment values.

For moving video, check [fal's Grok sandbox](https://fal.ai/grok-imagine-free) for any free image-to-video runs currently available to your account, then download an MP4 and upload it to the studio. fal does not promise a fixed free daily allowance, and a billing-locked account cannot upload there. Sandbox offers do not cover the text-to-video API. To generate from text inside the studio, add a fal API key as `FAL_KEY` in `.env` or `.env.local` and restart. The separate **Grok motion video** option calls fal's billed `xai/grok-imagine-video/v1.5/lite/text-to-video` endpoint. Its defaults are 5 seconds, 720p, and 9:16; set `FAL_VIDEO_DURATION=15` for a full-length Reel. The studio polls the fal queue, downloads the MP4, and saves a local or Cloudinary copy. See [fal's Lite API documentation](https://fal.ai/models/xai/grok-imagine-video/v1.5/lite/text-to-video/api).

## What the app records

- One SQLite publish job per selected platform, with schedule, status, provider ID, public link, and any error.
- A job becomes published only after the provider returns a resource ID and a visible permalink or confirmed public YouTube processing state. Simulated Facebook and Instagram jobs have a separate `simulated` status, no provider ID or post link, and a separate dashboard count. The job's mode is saved when scheduled; changing the environment later cannot turn a simulated job into a live request. Ambiguous live uploads are never retried automatically. The worker checks one pending YouTube upload per minute and counts it after YouTube confirms public processing.
- Provider-reported AI input, output, and total tokens per call, elapsed time, outcome, and run aggregation. Missing token usage is stored and displayed as unavailable.
- Credential observation, issuance, and refresh events with time, expiry when known, and outcome. Token values are never written to event details or app logs.
- YouTube view, like, and comment counts from the YouTube API when available. Other engagement examples and all product purchases are labeled demo data.

## Commands

- `npm run dev` starts the web app.
- `npm run worker` starts the local scheduler and publisher.
- `npm run typecheck` checks TypeScript types.
- `npm test` runs focused domain and restart-behavior tests.
- `npm run build` creates the production build.

## Limitations

Meta live publishing is outside the hackathon demo and has not been verified. Only an explicit `META_PUBLISH_MODE=live` setting can enable it; that mode still requires Meta credentials, public Cloudinary media, and a public `APP_URL`. YouTube remains a live integration. Gemini text and fal video generation require their respective keys and model access. For Instagram demo sales, open the platform-specific preview link in the studio; no Instagram post exists in simulation mode. The app and worker must remain running when a scheduled job becomes due, although queued jobs survive restarts.
