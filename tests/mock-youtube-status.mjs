globalThis.fetch = async (input) => {
  const url = String(input);
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "test-access", expires_in: 3600 });
  if (url.startsWith("https://www.googleapis.com/youtube/v3/channels?")) return json({ items: [{ id: "test-channel" }] });
  if (url.startsWith("https://www.googleapis.com/youtube/v3/videos?")) {
    const state = process.env.YOUTUBE_TEST_STATE;
    return json({ items: [{ id: "test-video", snippet: { channelId: "test-channel" }, status: { uploadStatus: state === "processing" ? "uploaded" : "processed", privacyStatus: state === "private" ? "private" : "public" }, processingDetails: { processingStatus: state === "processing" ? "processing" : "succeeded" } }] });
  }
  throw new Error(`Unexpected network request: ${url}`);
};
