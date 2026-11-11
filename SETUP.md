# Connect accounts for live publishing

The studio works locally for content previews and demo sales without platform credentials. Live publishing needs the accounts below. Keep every secret in `/home/adrian/codes/wework-hackathon/.env.local`. Do not paste keys or tokens into chat, screenshots, or the repository.

## Create the local configuration

From `/home/adrian/codes/wework-hackathon`, copy `.env.example` to `.env.local`. Fill in the values as you set up each service. Keep `.env.local` out of Git. Restart both the app and the scheduling worker after changing it.

## Generate artwork with Cloudflare

To test Cloudflare images, create an API token with Workers AI access in the [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens). Add your account ID as `CLOUDFLARE_ACCOUNT_ID` and the token as `CLOUDFLARE_API_TOKEN` in `.env.local` or `.env`, then restart the app. Cloudflare FLUX.1 Schnell is tried first for artwork and locally rendered video backgrounds. It does not generate captions or native video. The AI usage panel shows Cloudflare image token counts as unavailable because the image response does not provide them.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey). Add it as `GEMINI_API_KEY` in `.env.local`. Keep `AI_PROVIDER=gemini` to try Gemini before OpenAI.
2. Leave the model defaults in `.env.example` unless your account exposes different models. Gemini text generates captions and supports a free API tier. Gemini image generation and native video generation require a paid API tier. The video button tries [Gemini Omni Flash](https://ai.google.dev/gemini-api/docs/omni) for a native vertical clip, which can be shorter than 15 seconds. If that call fails, the studio uses Gemini artwork and FFmpeg to render a 15-second vertical video; this fallback still requires paid access to Gemini image generation. Check [Google's model pricing](https://ai.google.dev/gemini-api/docs/pricing) before testing.
3. Restart the app, create one artwork pubmat and one video, and inspect **AI usage & account activity**. The studio records provider-reported token counts per call; a provider that supplies no token usage appears as **unavailable**. The creation source identifies whether video came from Gemini or local rendering.

To add OpenAI as a fallback, create a key in the [OpenAI API dashboard](https://platform.openai.com/api-keys) and set `OPENAI_API_KEY`. When Gemini caption or artwork fails, the studio can try OpenAI. If you later want OpenAI first, set `AI_PROVIDER=openai`; Gemini then becomes the fallback. Never paste either key into the browser or chat. The editable template pubmat and uploads work without an AI key.

## Host media for Meta

Instagram fetches media from a public HTTPS URL. A local `localhost` URL is useful for preview but cannot be fetched by Meta.

1. Find the cloud name, API key, and API secret in your [Cloudinary console](https://console.cloudinary.com/).
2. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `.env.local`.
3. Upload a small image in the studio. Open its returned HTTPS URL in a private browser window to confirm that it is publicly readable.

Keep the API secret on the server. The app uploads media to Cloudinary before a live publish request.

If people outside your computer need to open the demo product link, set a strong `STUDIO_PASSWORD` in `.env.local`, expose `http://localhost:8000` through a temporary public HTTPS tunnel, and set `APP_URL` to that tunnel URL. The browser will ask for `STUDIO_USERNAME` and `STUDIO_PASSWORD` before opening the studio; the product page remains public. Keep `GOOGLE_REDIRECT_URI` at the exact URL registered in Google Cloud. A tunnel is optional for a local presentation.

## Connect a Facebook Page and Instagram account

1. Use a Facebook Page that your team controls. Link an Instagram professional account to that Page in Meta Business settings.
2. Create a [Meta developer app](https://developers.facebook.com/apps/). Add the team member who authorizes the Page as an app role while the app is in development mode.
3. Add the Facebook Login and Instagram Graph API products as required by your Meta app setup. Request the Page and Instagram permissions used by the studio: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. Meta may present different product names or permission variants for the Instagram Login route. This prototype uses the Facebook Page linked account route.
4. In the [Graph API Explorer](https://developers.facebook.com/tools/explorer/), choose your app and generate a User access token with those permissions. Query `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`. Find your Page in the response. Copy its `id` to `META_PAGE_ID`, its Page access token to `META_PAGE_ACCESS_TOKEN`, and the linked Instagram account `id` to `META_IG_USER_ID`.
5. Set `META_GRAPH_VERSION` to an API version supported by your app. Use the version in `.env.example` initially.
6. Restart the app and check that the Facebook and Instagram account badges show **Configured**. Publish a small test image to the Page and Instagram. Confirm each post in the account and match its provider ID to the job record.

For a team-controlled account with an app role, [Meta Standard Access](https://developers.facebook.com/docs/graph-api/overview/access-levels/) may be enough for a demo. Publishing for people outside the app roles can require App Review and Advanced Access. An expired or revoked token needs replacement. Never record the token itself in a log.

## Connect YouTube

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/). Enable **YouTube Data API v3**.
2. Configure the OAuth consent screen. If the app is in testing mode, add the Google account that owns the demo channel as a test user.
3. Create an OAuth client of type **Web application**. Add the exact redirect URI shown by `GOOGLE_REDIRECT_URI` in `.env.example` to the client's authorized redirect URIs.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`. Open the studio's **Connect YouTube** link with the channel owner. Grant the requested YouTube scopes. The app stores the refresh token in its local SQLite database; do not copy it into chat. If you already have a refresh token from another approved setup, you can set `GOOGLE_REFRESH_TOKEN` in `.env.local` instead.
5. Set `YOUTUBE_CHANNEL_ID` if the studio asks for it. Publish one short test video and confirm the video ID in the job record matches the YouTube URL.

Google requires [OAuth 2.0](https://developers.google.com/youtube/data/guides/authentication) for [video uploads](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert). A project whose consent screen stays in **Testing** may receive refresh tokens that expire after seven days. Reconnect before the demo if needed.

## Verify before the presentation

Start the web app and worker together. Check the configured-account badges, then publish one image to Facebook and Instagram and one video to Facebook, Instagram, and YouTube. Inspect the account pages and the per-platform job status. Schedule a separate post a few minutes ahead, restart the worker, and check that it publishes after the restart. Open a platform-specific product link, record a demo purchase, and check the sales attribution. The dashboard labels live engagement and demo sales separately.
