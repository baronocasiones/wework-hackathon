import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGeneratedAsset, recommendCopy } from "../src/lib/generation";
import { db } from "../src/lib/db";
import { POST as uploadContent } from "../app/api/content/route";
import { POST as generateContent } from "../app/api/generate/route";

const envKeys = ["AI_PROVIDER", "GEMINI_API_KEY", "OPENAI_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "DATABASE_PATH", "UPLOAD_DIR", "APP_URL",
  "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const;

async function fixture(run: (png: Buffer, directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-fallback-"));
  const saved = new Map(envKeys.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const fixturePath = path.join(directory, "fixture.png");
  const image = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1",
    "-frames:v", "1", fixturePath]);
  assert.equal(image.status, 0, image.stderr.toString());
  process.env.DATABASE_PATH = path.join(directory, "studio.sqlite");
  process.env.UPLOAD_DIR = directory;
  process.env.APP_URL = "http://localhost:8000";
  for (const name of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const) delete process.env[name];
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  try {
    await run(readFileSync(fixturePath), directory);
  } finally {
    globalThis.fetch = originalFetch;
    if (globalThis.postHouseDatabase) db().close();
    globalThis.postHouseDatabase = undefined;
    for (const name of envKeys) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test("Cloudflare artwork is selected in the generated asset and records unavailable usage", async () => fixture(async (_png, directory) => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const jpegPath = path.join(directory, "fixture.jpg");
  const image = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-frames:v", "1", jpegPath]);
  assert.equal(image.status, 0, image.stderr.toString());
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /api\.cloudflare\.com\/client\/v4\/accounts\/test-account\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell/);
    assert.equal(JSON.parse(String(init?.body)).steps, 4);
    return Response.json({ success: true, result: { image: readFileSync(jpegPath).toString("base64") } });
  };
  const asset = await createGeneratedAsset({ kind: "artwork", prompt: "A blue weekend collection" });
  assert.equal(asset.source, "cloudflare_artwork");
  assert.match(asset.mediaUrl, /\.png$/);
  assert.ok(existsSync(path.join(directory, path.basename(new URL(asset.mediaUrl).pathname))));
  const calls = db().prepare("SELECT model,operation,input_tokens,output_tokens,total_tokens,outcome FROM ai_calls WHERE run_id=?").all(asset.runId);
  assert.deepEqual(calls.map((call) => ({ ...call })), [{ model: "@cf/black-forest-labs/flux-1-schnell", operation: "artwork",
    input_tokens: null, output_tokens: null, total_tokens: null, outcome: "success" }]);
}));

test("a Cloudflare rejection falls back to Gemini artwork", async () => fixture(async (png) => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (input) => {
    const url = String(input);
    return url.includes("api.cloudflare.com") ? Response.json({ success: false }, { status: 403 }) : geminiResponse(url, png);
  };
  const asset = await createGeneratedAsset({ kind: "artwork", prompt: "Weekend collection" });
  assert.equal(asset.source, "gemini_artwork");
  const calls = db().prepare("SELECT model,outcome FROM ai_calls WHERE run_id=? ORDER BY created_at").all(asset.runId);
  assert.deepEqual(calls.map((call) => ({ ...call })), [
    { model: "gemini-3.5-flash-lite", outcome: "success" },
    { model: "@cf/black-forest-labs/flux-1-schnell", outcome: "failed" },
    { model: "gemini-3.1-flash-image", outcome: "success" },
  ]);
}));

function geminiResponse(url: string, png: Buffer): Response {
  if (url.includes("flash-lite:generateContent")) {
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "Weekend collection",
      caption: "Discover our weekend collection. See what's new.", subtitle: "Fresh picks for the weekend" }) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 7, totalTokenCount: 17 } });
  }
  if (url.includes("flash-image:generateContent")) {
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20, totalTokenCount: 32 } });
  }
  throw new Error(`Unexpected request to ${url}`);
}

test("an OpenAI rate limit falls back to Gemini for the finished artwork", async () => fixture(async (png, directory) => {
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = async (input) => {
    const url = String(input);
    return url.startsWith("https://api.openai.com/") ? Response.json({}, { status: 429 }) : geminiResponse(url, png);
  };
  const asset = await createGeneratedAsset({ kind: "artwork", prompt: "Weekend collection" });
  assert.equal(asset.source, "gemini_artwork");
  assert.deepEqual([asset.title, asset.caption, asset.subtitle], ["Weekend collection",
    "Discover our weekend collection. See what's new.", "Fresh picks for the weekend"]);
  assert.match(asset.mediaUrl, /^http:\/\/localhost:8000\/api\/media\/[^/]+\.png$/);
  assert.ok(existsSync(path.join(directory, path.basename(new URL(asset.mediaUrl).pathname))));
  const calls = db().prepare("SELECT model,operation,outcome FROM ai_calls WHERE run_id=?").all(asset.runId);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((call) => call.outcome === "failed").length, 2);
  assert.equal(calls.filter((call) => call.outcome === "success").length, 2);
}));

test("a zero Gemini image quota explains the paid-tier blocker without exposing provider details", async () => fixture(async (png) => {
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("flash-image:generateContent")) {
      return Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for metric: generate_content_free_tier_input_token_count, limit: 0, secret test-gemini-key" } }, { status: 429 });
    }
    return geminiResponse(url, png);
  };
  const response = await generateContent(new Request("http://localhost:8000/api/generate", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "artwork", prompt: "Weekend collection" }) }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /paid Gemini API tier/);
  assert.match(body.error, /OPENAI_API_KEY/);
  assert.doesNotMatch(body.error, /test-gemini-key/);
  const calls = db().prepare("SELECT operation,outcome FROM ai_calls ORDER BY created_at").all();
  assert.deepEqual(calls.map((call) => ({ ...call })), [
    { operation: "copy", outcome: "success" }, { operation: "artwork", outcome: "failed" },
  ]);
}));

test("a denied Gemini video model falls back to a 15-second Gemini-artwork MP4", async () => fixture(async (png, directory) => {
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (input) => {
    const url = String(input);
    return url.endsWith("/interactions") ? Response.json({}, { status: 403 }) : geminiResponse(url, png);
  };
  const asset = await createGeneratedAsset({ kind: "video", prompt: "Weekend collection" });
  assert.equal(asset.source, "gemini_rendered_video");
  assert.equal(asset.subtitle, "Fresh picks for the weekend");
  const videoPath = path.join(directory, path.basename(new URL(asset.mediaUrl).pathname));
  assert.ok(existsSync(videoPath));
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath]);
  assert.equal(probe.status, 0, probe.stderr.toString());
  assert.ok(Math.abs(Number(probe.stdout.toString().trim()) - 15) < 0.1);
  const calls = db().prepare("SELECT operation,outcome FROM ai_calls WHERE run_id=?").all(asset.runId);
  assert.equal(calls.find((call) => call.operation === "video")?.outcome, "failed");
  assert.equal(calls.find((call) => call.operation === "artwork")?.outcome, "success");
}));

test("upload fills blank title and subtitle while keeping the user's caption", async () => fixture(async (png) => {
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (input, init) => {
    const request = JSON.parse(String(init?.body));
    assert.match(request.contents[0].parts[0].text, /Weekend collection/);
    assert.equal(request.contents[0].parts[0].inlineData, undefined);
    return geminiResponse(String(input), png);
  };
  const form = new FormData();
  form.set("file", new File([Uint8Array.from(png)], "weekend.png", { type: "image/png" }));
  form.set("context", "Weekend collection");
  form.set("title", "");
  form.set("caption", "Our own caption");
  form.set("subtitle", "");
  const response = await uploadContent(new Request("http://localhost:8000/api/content", { method: "POST", body: form }));
  assert.equal(response.status, 201);
  const body = await response.json();
  const stored = db().prepare("SELECT title,caption,subtitle FROM content WHERE id=?").get(body.id);
  assert.deepEqual({ ...stored }, { title: "Weekend collection", caption: "Our own caption", subtitle: "Fresh picks for the weekend" });
  const calls = db().prepare("SELECT operation,input_tokens,total_tokens FROM ai_calls").all();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "copy");
  assert.equal(calls[0].total_tokens, 17);
}));

test("template creation fills blank copy without an AI key", async () => fixture(async (_png, directory) => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const request = new Request("http://localhost:8000/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "template", prompt: "Neighborhood craft fair", title: "", caption: "", subtitle: "" }) });
  const response = await generateContent(request);
  assert.equal(response.status, 201);
  const asset = await response.json();
  const stored = db().prepare("SELECT title,caption,subtitle,template_headline,template_body,media_url FROM content WHERE id=?").get(asset.id);
  assert.equal(stored?.title, "Neighborhood craft fair");
  assert.equal(stored?.subtitle, "Discover what's new.");
  assert.ok(String(stored?.caption).includes("Neighborhood craft fair"));
  assert.equal(stored?.template_headline, stored?.title);
  assert.equal(stored?.template_body, stored?.subtitle);
  assert.ok(existsSync(path.join(directory, path.basename(new URL(String(stored?.media_url)).pathname))));
  assert.equal(db().prepare("SELECT id FROM ai_calls").all().length, 0);
}));

test("complete user copy stays unchanged and does not call an AI provider", async () => fixture(async () => {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = async () => { throw new Error("AI should not run for complete copy."); };
  const { copy } = await recommendCopy({ kind: "image", context: "A weekend collection", title: "Our launch",
    caption: "Words written by the team", subtitle: "See it this weekend" });
  assert.deepEqual(copy, { title: "Our launch", caption: "Words written by the team", subtitle: "See it this weekend" });
  assert.equal(db().prepare("SELECT id FROM ai_calls").all().length, 0);
}));
