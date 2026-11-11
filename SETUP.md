# Connect accounts for live publishing

The studio works locally for content previews and demo sales without platform credentials. Live publishing needs the accounts below. Keep every secret in `/home/adrian/codes/wework-hackathon/.env.local`. Do not paste keys or tokens into chat, screenshots, or the repository.

## Create the local configuration

From `/home/adrian/codes/wework-hackathon`, copy `.env.example` to `.env.local`. Fill in the values as you set up each service. Keep `.env.local` out of Git. Restart both the app and the scheduling worker after changing it.

## Connect OpenAI

1. Create an API key in the [OpenAI API dashboard](https://platform.openai.com/api-keys).
2. Set `OPENAI_API_KEY` in `.env.local`. Leave `OPENAI_TEXT_MODEL=gpt-6-luna` and `OPENAI_IMAGE_MODEL=gpt-image-2.6-flare` unless your account lacks access to either model.
3. Generate one caption and one artwork in the studio. Check that the monitoring page records each call and the token values returned by OpenAI.

AI generation requires an API account with billing and model access. The editable template pubmat and uploads can still be used without an OpenAI key.

## Host media for Meta

Instagram fetches media from a public HTTPS URL. A local `localhost` URL is useful for preview but cannot be fetched by Meta.

1. Find the cloud name, API key, and API secret in your [Cloudinary console](https://console.cloudinary.com/).
2. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `.env.local`.
3. Upload a small image in the studio. Open its returned HTTPS URL in a private browser window to confirm that it is publicly readable.

Keep the API secret on the server. The app uploads media to Cloudinary before a live publish request.

If people outside your computer need to open the demo product link, set a strong `STUDIO_PASSWORD` in `.env.local`, expose `http://127.0.0.1:3000` through a temporary public HTTPS tunnel, and set `APP_URL` to that tunnel URL. The browser will ask for `STUDIO_USERNAME` and `STUDIO_PASSWORD` before opening the studio; the product page remains public. Keep `GOOGLE_REDIRECT_URI` at the exact URL registered in Google Cloud. A tunnel is optional for a local presentation.

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
