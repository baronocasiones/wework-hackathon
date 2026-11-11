import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { db } from "../src/lib/db";
import { PublishError } from "../src/lib/domain";
import { publishJob } from "../src/lib/publish";

test("YouTube uploadStatus failed/rejected becomes a failed outcome, not needs_review", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-youtube-"));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousPostHouseDatabase = globalThis.postHouseDatabase;
  const saved = {
    YOUTUBE_CHANNEL_ID: process.env.YOUTUBE_CHANNEL_ID,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
    APP_URL: process.env.APP_URL,
  };
  process.env.DATABASE_PATH = path.join(directory, "studio.sqlite");
  globalThis.postHouseDatabase = undefined;
  process.env.YOUTUBE_CHANNEL_ID = "chan1";
  process.env.GOOGLE_CLIENT_ID = "client";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  process.env.GOOGLE_REFRESH_TOKEN = "refresh";
  process.env.APP_URL = "https://example.com";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const json = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "fake", expires_in: 3600 });
    if (url.includes("/youtube/v3/channels")) return json({ items: [{ id: "chan1" }] });
    if (url.includes("/upload/youtube/v3/videos")) {
      return new Response(null, { status: 200, headers: { location: "https://upload.youtube.com/ups/v1/videos?upload_id=abc" } });
    }
    if (url.includes("upload.youtube.com")) return json({ id: "vid1" });
    if (url.includes("/youtube/v3/videos")) {
      return json({ items: [{ snippet: { channelId: "chan1" }, status: { uploadStatus: "failed", privacyStatus: "public" }, processingDetails: { processingStatus: "failed" } }] });
    }
    if (url.includes("res.cloudinary.com")) return new Response(Buffer.from("fake-video"), { status: 200 });
    throw new Error("unexpected fetch: " + url);
  }) as unknown as typeof fetch;

  try {
    db(); // bootstrap schema
    await assert.rejects(
      publishJob({ id: "j1", platform: "youtube", caption: "hi", media_url: "https://res.cloudinary.com/demo/video/upload/sample.mp4", kind: "video", title: "t" } as never),
      (error: unknown) => error instanceof PublishError && error.reason === "rejected_4xx",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (globalThis.postHouseDatabase) db().close();
    globalThis.postHouseDatabase = previousPostHouseDatabase;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabase;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
