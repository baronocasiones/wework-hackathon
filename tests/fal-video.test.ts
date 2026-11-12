import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../src/lib/db";
import { createGeneratedAsset } from "../src/lib/generation";
import { POST as generateContent } from "../app/api/generate/route";
import { authorizeTestDatabase } from "./auth-fixture";

const envKeys = ["FAL_KEY", "FAL_VIDEO_DURATION", "FAL_VIDEO_RESOLUTION", "GEMINI_API_KEY", "OPENAI_API_KEY",
  "DATABASE_PATH", "UPLOAD_DIR", "APP_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const;

async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-fal-"));
  const saved = new Map(envKeys.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  process.env.DATABASE_PATH = path.join(directory, "studio.sqlite");
  process.env.UPLOAD_DIR = directory;
  process.env.APP_URL = "http://localhost:8000";
  for (const key of envKeys) if (!(["DATABASE_PATH", "UPLOAD_DIR", "APP_URL"] as string[]).includes(key)) delete process.env[key];
  try { authorizeTestDatabase(); await run(directory); }
  finally {
    globalThis.fetch = originalFetch;
    if (globalThis.postHouseDatabase) db().close();
    globalThis.postHouseDatabase = undefined;
    for (const key of envKeys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

const endpoint = "https://queue.fal.run/xai/grok-imagine-video/v1.5/lite/text-to-video";
const statusUrl = "https://queue.fal.run/xai/grok-imagine-video/requests/request-123/status";
const responseUrl = "https://queue.fal.run/xai/grok-imagine-video/requests/request-123";

test("fal Grok Lite submits a short vertical clip, downloads it, and records usage as unavailable", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  const sample = path.join(directory, "sample.mp4");
  const ffmpeg = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x96:d=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", sample]);
  assert.equal(ffmpeg.status, 0, ffmpeg.stderr.toString());
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url === endpoint) {
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init.headers).get("Authorization"), "Key test-fal-secret");
      assert.deepEqual(JSON.parse(String(init.body)), { prompt: "A blue tote bag moving through a market. clean editorial photography, soft natural light, muted greens and cream, premium minimal composition, lots of quiet negative space",
        duration: 5, aspect_ratio: "9:16", resolution: "720p" });
      return Response.json({ status: "IN_QUEUE", request_id: "request-123", status_url: statusUrl, response_url: responseUrl });
    }
    if (url === statusUrl) return Response.json({ status: "COMPLETED", request_id: "request-123", error: null });
    if (url === responseUrl) return Response.json({ video: { url: "https://v3b.fal.media/files/video.mp4", duration: 5 } });
    if (url === "https://v3b.fal.media/files/video.mp4") {
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      return new Response(readFileSync(sample), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const asset = await createGeneratedAsset({ kind: "grok_video", prompt: "A blue tote bag moving through a market",
    title: "Market tote", caption: "Meet our market tote.", subtitle: "Carry your day" });
  assert.deepEqual(requests, [endpoint, statusUrl, responseUrl, "https://v3b.fal.media/files/video.mp4"]);
  assert.equal(asset.source, "fal_grok_native_video");
  assert.equal(asset.kind, "video");
  assert.ok(existsSync(path.join(directory, path.basename(new URL(asset.mediaUrl).pathname))));
  const call = db().prepare("SELECT operation,model,input_tokens,output_tokens,total_tokens,outcome FROM ai_calls WHERE run_id=?").get(asset.runId);
  assert.deepEqual({ ...call }, { operation: "video", model: "xai/grok-imagine-video/v1.5/lite/text-to-video",
    input_tokens: null, output_tokens: null, total_tokens: null, outcome: "success" });
}));

test("the fal Grok route refuses an absent key before making any provider request", async () => fixture(async () => {
  globalThis.fetch = async () => { throw new Error("Provider should not be called without a key."); };
  const response = await generateContent(new Request("http://localhost:8000/api/generate", { method: "POST",
    headers: { "Content-Type": "application/json", ...authorizeTestDatabase() }, body: JSON.stringify({ kind: "grok_video", prompt: "Blue tote" }) }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /FAL_KEY/);
  assert.equal(db().prepare("SELECT id FROM ai_calls").all().length, 0);
}));

test("the fal Grok handler rejects an unsafe media URL and never exposes its key", async () => fixture(async () => {
  process.env.FAL_KEY = "test-fal-secret";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === endpoint) return Response.json({ request_id: "request-123", status_url: statusUrl, response_url: responseUrl });
    if (url === statusUrl) return Response.json({ status: "COMPLETED" });
    return Response.json({ video: { url: "https://example.invalid/video.mp4" } });
  };
  await assert.rejects(createGeneratedAsset({ kind: "grok_video", prompt: "Blue tote", title: "Blue tote",
    caption: "See our tote.", subtitle: "Made for weekends" }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /invalid media URL/);
    assert.doesNotMatch(error.message, /test-fal-secret/);
    return true;
  });
  const call = db().prepare("SELECT outcome FROM ai_calls").get();
  assert.deepEqual({ ...call }, { outcome: "failed" });
}));

test("a locked fal balance gives a clear error without exposing the key", async () => fixture(async () => {
  process.env.FAL_KEY = "test-fal-secret";
  globalThis.fetch = async () => Response.json({ detail: "User is locked. Reason: Exhausted balance." }, { status: 403 });
  await assert.rejects(createGeneratedAsset({ kind: "grok_video", prompt: "Blue tote", title: "Blue tote",
    caption: "See our tote.", subtitle: "Made for weekends" }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /balance is exhausted/);
    assert.doesNotMatch(error.message, /test-fal-secret/);
    return true;
  });
  const call = db().prepare("SELECT outcome FROM ai_calls").get();
  assert.deepEqual({ ...call }, { outcome: "failed" });
}));
