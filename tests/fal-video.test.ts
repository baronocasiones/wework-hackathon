import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../src/lib/db";
import { createGeneratedAsset } from "../src/lib/generation";
import { buildGrokInstruction, buildPosterScene } from "../src/lib/ideogram";
import { getStyle } from "../src/lib/styles";
import { POST as generateContent } from "../app/api/generate/route";
import { authorizeTestDatabase } from "./auth-fixture";

const envKeys = ["FAL_KEY", "FAL_VIDEO_DURATION", "FAL_VIDEO_RESOLUTION", "GEMINI_API_KEY", "OPENAI_API_KEY",
  "DATABASE_PATH", "UPLOAD_DIR", "APP_URL", "AGENT_ENABLED",
  "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN",
  "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const;

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
const brief = { prompt: "A blue tote bag moving through a market", title: "Market tote", caption: "Meet our market tote.", subtitle: "Carry your day", cta: "SHOP NOW" };
const expectedPrompt = buildGrokInstruction(
  buildPosterScene(brief.prompt, getStyle("clean_editorial")),
  getStyle("clean_editorial").promptSuffix,
);

function grokNotConfiguredBody(): never {
  throw new Error("Provider should not be called without a key or creds.");
}

test("fal Grok Lite submits a short clip with verbatim copy, downloads it, and records usage", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  process.env.AGENT_ENABLED = "false";
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
      const body = JSON.parse(String(init.body));
      assert.equal(body.duration, 5);
      assert.equal(body.aspect_ratio, "9:16");
      assert.equal(body.resolution, "720p");
      assert.equal(body.prompt, expectedPrompt);
      assert.doesNotMatch(body.prompt, /ROOM FOR THE MARKET/);
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
  const asset = await createGeneratedAsset({ kind: "video", prompt: brief.prompt,
    title: brief.title, caption: brief.caption, subtitle: brief.subtitle, cta: brief.cta });
  assert.deepEqual(requests, [endpoint, statusUrl, responseUrl, "https://v3b.fal.media/files/video.mp4"]);
  assert.equal(asset.source, "fal_grok_native_video");
  assert.equal(asset.kind, "video");
  assert.ok(existsSync(path.join(directory, path.basename(new URL(asset.mediaUrl).pathname))));
  const call = db().prepare("SELECT operation,model,input_tokens,output_tokens,total_tokens,outcome FROM ai_calls WHERE run_id=?").get(asset.runId);
  assert.deepEqual({ ...call }, { operation: "video", model: "xai/grok-imagine-video/v1.5/lite/text-to-video",
    input_tokens: null, output_tokens: null, total_tokens: null, outcome: "success" });
}));

test("video generation needs a fal key or Cloudflare credentials but never fabricates a clip", async () => fixture(async () => {
  globalThis.fetch = grokNotConfiguredBody;
  const response = await generateContent(new Request("http://localhost:8000/api/generate", { method: "POST",
    headers: { "Content-Type": "application/json", ...authorizeTestDatabase() },
    body: JSON.stringify({ kind: "video", prompt: brief.prompt, title: brief.title, caption: brief.caption, subtitle: brief.subtitle, cta: brief.cta }) }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /CLOUDFLARE_ACCOUNT_ID|FAL_KEY/);
  assert.equal(db().prepare("SELECT id FROM ai_calls").all().length, 0);
}));

test("an unsafe media URL falls back to the Ideogram motion poster instead of crashing", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  process.env.AGENT_ENABLED = "false";
  const jpegPath = path.join(directory, "fixture.jpg");
  const image = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-frames:v", "1", jpegPath]);
  assert.equal(image.status, 0, image.stderr.toString());
  const jpeg = readFileSync(jpegPath);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === endpoint) return Response.json({ request_id: "request-123", status_url: statusUrl, response_url: responseUrl });
    if (url === statusUrl) return Response.json({ status: "COMPLETED" });
    if (url === responseUrl) return Response.json({ video: { url: "https://example.invalid/video.mp4" } });
    if (url === "https://fal.run/fal-ai/ideogram/v3") return Response.json({ images: [{ url: "https://v3b.fal.media/files/poster.png" }], seed: 1 });
    if (url === "https://v3b.fal.media/files/poster.png") return new Response(new Uint8Array(jpeg), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const asset = await createGeneratedAsset({ kind: "video", prompt: brief.prompt,
    title: brief.title, caption: brief.caption, subtitle: brief.subtitle, cta: brief.cta });
  assert.equal(asset.source, "ideogram_video");
  assert.match(asset.mediaUrl, /\.mp4$/);
  const calls = db().prepare("SELECT model, outcome FROM ai_calls ORDER BY created_at").all();
  assert.equal(calls[0].model, "xai/grok-imagine-video/v1.5/lite/text-to-video");
  assert.equal(calls[0].outcome, "failed");
  assert.equal(calls[1].model, "fal-ai/ideogram/v3");
  assert.equal(calls[1].outcome, "success");
}));

test("a locked fal balance falls back to the Cloudflare + drawtext video path", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  process.env.AGENT_ENABLED = "false";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  const jpegPath = path.join(directory, "fixture.jpg");
  const image = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-frames:v", "1", jpegPath]);
  assert.equal(image.status, 0, image.stderr.toString());
  const jpeg = readFileSync(jpegPath);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://queue.fal.run/")) return Response.json({ detail: "User is locked. Reason: Exhausted balance." }, { status: 403 });
    if (url === "https://fal.run/fal-ai/ideogram/v3") return Response.json({ detail: "User is locked. Reason: Exhausted balance." }, { status: 403 });
    if (url.match(/api\.cloudflare\.com\/client\/v4\/accounts\/test-account\/ai\/run/)) {
      return Response.json({ success: true, result: { image: jpeg.toString("base64") } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const asset = await createGeneratedAsset({ kind: "video", prompt: brief.prompt,
    title: brief.title, caption: brief.caption, subtitle: brief.subtitle, cta: brief.cta });
  assert.equal(asset.source, "cloudflare_video");
  const calls = db().prepare("SELECT model, outcome FROM ai_calls ORDER BY created_at").all();
  assert.deepEqual(calls.map((call) => (call as { model: string }).model), [
    "xai/grok-imagine-video/v1.5/lite/text-to-video",
    "fal-ai/ideogram/v3",
    "@cf/black-forest-labs/flux-1-schnell",
    "gemini-3.1-flash-lite",
  ]);
}));
