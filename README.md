# Post House content studio

Post House is a local studio for creating social posts, scheduling them, and tracking demo purchases. Facebook and Instagram use local publishing simulations by default. YouTube uses a live connection when you configure it.

## Run the studio locally

1. Install Node.js 22 or newer and FFmpeg. The app uses Node's built-in `node:sqlite` module.
2. Copy `.env.example` to `.env.local`. Set `STUDIO_PASSWORD` if the first owner will register through a public tunnel. Keep secrets out of Git.
3. Run `npm install`.
4. Run `npm run dev` in one terminal and `npm run worker` in another. The worker checks due jobs every five seconds.
5. Open `http://localhost:8000/register` and create the owner account. If set, enter `STUDIO_PASSWORD` as the one-time setup key. Use `http://localhost:8000/login` on later visits.

Both processes read `.env.local`. The worker also reads `.env` if present. Restart both processes after you change environment values. The app listens on localhost port 8000; point an HTTPS tunnel at `http://localhost:8000` if other people need to open the public product page.

The app stores accounts, sessions, content, jobs, and demo purchases in `./data/studio.sqlite`. It stores local media under `./public/uploads` unless you set `DATABASE_PATH` or `UPLOAD_DIR`. Without `STUDIO_PASSWORD`, first-owner registration works only on localhost. Registration closes after the first account is created.

## Create a post

Enter a campaign idea in the studio, then choose **AI artwork Publication Materials**, **Grok motion video**, or upload your own image or video. You can leave the title, caption, and subtitle blank. Gemini suggests text when `GEMINI_API_KEY` is set; otherwise, the app uses local defaults.

For AI artwork, set `FAL_KEY` to use Ideogram. Ideogram draws the headline, supporting line, and call to action inside the image. Its lettering is best effort, so inspect the result before scheduling. If fal is unavailable, the app uses Cloudflare artwork with text added by FFmpeg. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for that fallback. Set `ARTWORK_TEXT_MODE=overlay` to use the Cloudflare path directly.

For motion video, `FAL_KEY` enables Grok Imagine Video 1.5 Lite. Grok chooses its own on-screen wording, which may differ from the post copy. If Grok fails, the app tries an Ideogram still with motion, then a Cloudflare still with motion. `FAL_VIDEO_DURATION` defaults to five seconds. Grok and Ideogram API calls use fal credits, including calls made when you update text on their generated assets. Cloudflare fallback text can be rendered again from the saved base media.

The image and video critique loop is on by default when Gemini vision is available. Use `AGENT_ENABLED`, `AGENT_DAILY_CAP`, and `OVERLAY_QA_ENABLED` to control its calls. See `.env.example` for the available values.

## Schedule a post

Leave `META_PUBLISH_MODE=simulated` and the Meta credential fields blank for the local demo. Start the worker before scheduling. Facebook and Instagram jobs finish with a separate `simulated` status and do not receive a provider post ID or link. Changing the environment later does not turn an existing simulated job into a live post.

To connect YouTube, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `YOUTUBE_CHANNEL_ID`. Register the same redirect URI in Google Cloud, then choose **Connect YouTube** in the studio. The default local redirect is `http://localhost:8000/api/oauth/google/callback`.

Live publishing requires Cloudinary credentials for public HTTPS media and a non-local HTTPS `APP_URL`. Meta live publishing also requires `META_PUBLISH_MODE=live` and Meta credentials; that path has not been verified for the demo. The studio, worker, and SQLite database must remain available when a scheduled job is due. Queued jobs survive a restart.

## Check the app

- `npm run typecheck` checks TypeScript.
- `npm test` runs the focused test suite.
- `npm run build` creates a production build.

Open `/setup` for the in-app credential checklist. Use the [setup guide](SETUP.md) for service configuration. The [generation notes](docs/generation.md) describe provider paths and known limits. The [pipeline notes](docs/pipeline.md) describe job states and retry behavior.
