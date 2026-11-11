# Post House content studio

A single-operator demo for making social content, preparing platform-specific posts, scheduling them, and comparing results. Local uploads work without image API keys. AI generation, public media hosting, and live publishing require the credentials below.

## Run locally

1. Install Node.js 22 or newer and FFmpeg. This app uses Node 22's built-in `node:sqlite` module, which is marked experimental by Node in this release line.
2. Copy `.env.example` to `.env.local`. Keep every secret server-side. Do not commit `.env.local`.
3. Run `npm install`.
4. Run `npm run dev` in one terminal.
5. Run `npm run worker` in a second terminal. The worker checks the SQLite schedule every five seconds.
6. Open `http://localhost:8000`.

The app scripts bind to `localhost` on port 8000 so the local demo is not reachable directly from the LAN. Point any HTTPS tunnel at `http://localhost:8000`.

The app stores SQLite data under `./data/studio.sqlite` and local preview files under `./public/uploads`. Local preview URLs cannot be fetched by social networks. Live posts require signed Cloudinary uploads and a public HTTPS `APP_URL`; use a temporary HTTPS tunnel for the demo product page and set `APP_URL` to that tunnel address. `GOOGLE_REDIRECT_URI` can remain `http://localhost:8000/api/oauth/google/callback` for local OAuth. Before opening a public tunnel, set a strong `STUDIO_PASSWORD` in `.env.local`. The browser asks for the operator username and password before opening the studio or its privileged APIs. The product page, demo checkout, and uploaded media stay public. The app refuses public access to privileged routes if the password is blank.

See `/setup` in the app for a short credential checklist. The operator should also use the separate `SETUP.md` for full account configuration steps.

For both Publication Materials options, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `.env.local` or `.env`. [Cloudflare FLUX.1 Schnell](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) is the only image generator. The template uses a Cloudflare background with locally editable text; editing the text reuses that background. Gemini can suggest titles, captions, and subtitles; without its key, blank text receives local defaults. Cloudflare does not report token usage in its image response, so its token fields show unavailable. Restart the app after changing environment values.

For moving video, check [fal's Grok sandbox](https://fal.ai/grok-imagine-free) for any free image-to-video runs currently available to your account, then download an MP4 and upload it to the studio. fal does not promise a fixed free daily allowance, and a billing-locked account cannot upload there. Sandbox offers do not cover the text-to-video API. To generate from text inside the studio, add a fal API key as `FAL_KEY` in `.env` or `.env.local` and restart. The separate **Grok motion video** option calls fal's billed `xai/grok-imagine-video/v1.5/lite/text-to-video` endpoint. Its defaults are 5 seconds, 720p, and 9:16; set `FAL_VIDEO_DURATION=15` for a full-length Reel. The studio polls the fal queue, downloads the MP4, and saves a local or Cloudinary copy. See [fal's Lite API documentation](https://fal.ai/models/xai/grok-imagine-video/v1.5/lite/text-to-video/api).

## What the app records

- One SQLite publish job per selected platform, with schedule, status, provider ID, public link, and any error.
- A job becomes published only after the provider returns a resource ID and a visible permalink or confirmed public YouTube processing state. Interrupted or ambiguous jobs become `uncertain` or `needs_review`; they are never retried automatically.
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

Live publishing was not verified without the team's Meta, Google, and Cloudinary credentials. Gemini text and fal video generation require their respective keys and model access. Instagram Reels may take up to 54 seconds to reach a ready container state. Facebook Reel requirements and platform account eligibility still apply. For the Instagram demo sale, open the platform-specific preview link in the studio or copy the tracked link into a channel that supports it. The worker and app must remain running for local scheduled posts.
