# Connect accounts for live publishing

The studio works locally for content previews and demo sales without platform credentials. Live publishing needs the accounts below. Keep every secret in `/home/adrian/codes/wework-hackathon/.env.local`. Do not paste keys or tokens into chat, screenshots, or the repository.

## Create the local configuration

From `/home/adrian/codes/wework-hackathon`, copy `.env.example` to `.env.local`. Fill in the values as you set up each service. Keep `.env.local` out of Git. Restart both the app and the scheduling worker after changing it.

## Create Publication Materials and text

To test either Publication Materials option, create an API token with Workers AI access in the [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens). Add your account ID as `CLOUDFLARE_ACCOUNT_ID` and the token as `CLOUDFLARE_API_TOKEN` in `.env.local` or `.env`, then restart the app. Cloudflare FLUX.1 Schnell is the only AI image provider. The template's Cloudflare background is generated once and reused when you edit its text. The AI usage panel shows Cloudflare image token counts as unavailable because its response does not provide them.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey). Add it as `GEMINI_API_KEY` in `.env.local` or `.env` to suggest titles, captions, and subtitles. Gemini is not used for artwork or video.
2. Restart the app, create one template and one AI artwork Publication Materials item, and inspect **AI usage & account activity**. Gemini text calls show provider-reported token counts. Cloudflare image token counts appear as **unavailable**. Blank text also has local defaults if Gemini cannot respond.

## Test Grok moving video

1. Open [fal's Grok Imagine sandbox](https://fal.ai/grok-imagine-free) and check the free runs or account pricing shown above **Generate**. Free eligibility varies by active offer; there is no promised daily quota. When a run is available, upload a starting image there, describe the motion, export the MP4, and upload it in the studio. This manual path needs no API key in the studio. A billing-locked fal account cannot upload to the sandbox.
2. The free sandbox allowance does not cover automated text-to-video API calls. For that path, create a key in the [fal dashboard](https://fal.ai/dashboard/keys) and put it in `FAL_KEY` in `.env` or `.env.local`. Keep `FAL_KEY` blank until you are ready for billed API use. Do not paste the key into the studio or chat.
3. Leave `FAL_VIDEO_DURATION=5` and `FAL_VIDEO_RESOLUTION=720p` for the first billed test. At [current fal pricing](https://fal.ai/models/xai/grok-imagine-video/v1.5/lite/text-to-video/api), this text-to-video test costs about $0.15. For the final 15-second Reel, set the duration to 15. Restart the app after changing the file.
4. Use **Grok motion video** in the studio. The app requests a 9:16 clip through fal's Lite text-to-video endpoint, waits for the queue, saves the MP4, and shows it in the preview. The AI usage log records the call; token fields remain unavailable because the video response does not provide token counts.

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
