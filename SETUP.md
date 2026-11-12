# Set up the hackathon demo

The studio works locally for content previews, Facebook and Instagram simulated posts, and demo sales. No Meta account setup is needed. Keep any other service secrets in `/home/adrian/codes/wework-hackathon/.env.local`. Do not paste keys or tokens into chat, screenshots, or the repository.

## Create the local configuration

From `/home/adrian/codes/wework-hackathon`, copy `.env.example` to `.env.local`. Fill in the values as you set up each service. Keep `.env.local` out of Git. Restart both the app and the scheduling worker after changing it.

Keep `META_PUBLISH_MODE=simulated` and leave `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, and `META_IG_USER_ID` blank. Create or upload content, choose Facebook or Instagram, and press **Post now** or set a schedule. The worker changes each due job to **Simulated post**. These jobs make zero Meta requests and have no Meta post ID or link. The dashboard keeps their counts apart from live posts. The local product preview links can still record demo purchases; sample engagement and sales are labeled demo data.

## Generate artwork and text

1. Add `FAL_KEY` to `.env.local` to generate Ideogram artwork. Ideogram renders the headline, supporting line, and call to action inside the image. Inspect the lettering before you schedule the post. Ideogram calls use fal credits, including calls made when you edit the text.
2. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for the Cloudflare fallback. If fal is unavailable, Cloudflare creates the artwork and FFmpeg adds editable text. Set `ARTWORK_TEXT_MODE=overlay` to use that path directly.
3. To get text suggestions, add `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/app/apikey). Blank fields use local defaults if Gemini is unavailable. The optional image and video critique loop also uses Gemini vision.
4. Restart the app, generate one artwork item, and inspect the image and **AI usage & account activity**. Gemini calls show provider-reported token counts. Image provider calls can show token counts as unavailable.

## Test Grok moving video

1. Open [fal's Grok Imagine sandbox](https://fal.ai/grok-imagine-free) and check the free runs or account pricing shown above **Generate**. Free eligibility varies by active offer; there is no promised daily quota. When a run is available, upload a starting image there, describe the motion, export the MP4, and upload it in the studio. This manual path needs no API key in the studio. A billing-locked fal account cannot upload to the sandbox.
2. The free sandbox allowance does not cover automated text-to-video API calls. For that path, create a key in the [fal dashboard](https://fal.ai/dashboard/keys) and put it in `FAL_KEY` in `.env` or `.env.local`. Keep `FAL_KEY` blank until you are ready for billed API use. Do not paste the key into the studio or chat.
3. Leave `FAL_VIDEO_DURATION=5` and `FAL_VIDEO_RESOLUTION=720p` for the first billed test. Check the [fal model page](https://fal.ai/models/xai/grok-imagine-video/v1.5/lite/text-to-video/api) for the current price. For a 15-second Reel, set the duration to 15. Restart the app after changing the file.
4. Use **Grok motion video** in the studio. Grok chooses its own on-screen wording, so inspect the clip before you schedule it. If Grok fails, the app tries an Ideogram still with motion, then a Cloudflare still with motion. The AI usage log records the provider call; token fields remain unavailable when the response does not provide counts.

## Host media for live publishing only

The local Meta simulation works with `localhost` media and needs no tunnel. For a deliberate live integration later, Instagram fetches media from a public HTTPS URL.

1. Find the cloud name, API key, and API secret in your [Cloudinary console](https://console.cloudinary.com/).
2. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `.env.local`.
3. Upload a small image in the studio. Open its returned HTTPS URL in a private browser window to confirm that it is publicly readable.

Keep the API secret on the server. The app uploads media to Cloudinary before a live publish request.

Before exposing an unregistered studio through a public HTTPS tunnel, set a strong `STUDIO_PASSWORD` in `.env.local` as its first-owner setup key. Visit `/register`, enter an email, a new account password of at least 12 characters, and the setup key. Registration closes after the first account is created. Use `/login` with that email and account password afterward; **Sign out** revokes the current session. Without a setup key, first registration works only on localhost. To let other people open the demo product link, expose `http://localhost:8000` through a temporary HTTPS tunnel and set `APP_URL` to that URL. The product page remains public. Keep `GOOGLE_REDIRECT_URI` at the exact URL registered in Google Cloud. A tunnel is optional for a local presentation.

## Connect a Facebook Page and Instagram account for live mode only

Live Meta publishing is outside this hackathon demo. It can run only when `META_PUBLISH_MODE=live` is set deliberately. The credentials below are not needed for simulation.

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

Start the web app and worker together. Check the configured-account badges, then run one Facebook and one Instagram simulation. Confirm that each job has `simulated` status and no provider post link. If YouTube is configured, publish one video and confirm its public URL and job status. Schedule another post a few minutes ahead, restart the worker, and check its status after the scheduled time. Open a platform-specific product link, record a demo purchase, and check the sales attribution. The dashboard labels live engagement and demo sales separately.
