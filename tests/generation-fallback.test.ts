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
import { PATCH as editTemplate } from "../app/api/content/[id]/route";

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
    assert.equal(JSON.parse(String(init?.body)).steps, 8);
    return Response.json({ success: true, result: { image: readFileSync(jpegPath).toString("base64") } });
  };
  const asset = await createGeneratedAsset({ kind: "artwork", prompt: "A blue weekend collection" });
  assert.equal(asset.source, "cloudflare_artwork");
  assert.match(asset.mediaUrl, /\.png$/);
  assert.ok(existsSync(path.join(directory, path.basename(new URL(asset.mediaUrl).pathname))));
  const calls = db().prepare("SELECT model,operation,input_tokens,output_tokens,total_tokens,outcome FROM ai_calls WHERE run_id=? ORDER BY created_at").all(asset.runId);
  assert.deepEqual(calls.map((call) => ({ ...call })), [
    { model: "@cf/black-forest-labs/flux-1-schnell", operation: "artwork", input_tokens: null, output_tokens: null, total_tokens: null, outcome: "success" },
    { model: "gemini-3.1-flash-lite", operation: "critique", input_tokens: null, output_tokens: null, total_tokens: null, outcome: "failed" },
  ]);
}));

test("a Cloudflare rejection does not generate artwork through Gemini or OpenAI", async () => fixture(async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json({ success: false }, { status: 403 });
  };
  const response = await generateContent(new Request("http://localhost:8000/api/generate", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "artwork", prompt: "Weekend collection",
      title: "Weekend collection", caption: "Browse the collection.", subtitle: "Fresh picks" }) }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Cloudflare artwork failed/);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /api\.cloudflare\.com/);
  const calls = db().prepare("SELECT model,outcome FROM ai_calls").all();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].model, "@cf/black-forest-labs/flux-1-schnell");
  assert.equal(calls[1].outcome, "failed");
}));

function geminiResponse(url: string): Response {
  if (url.includes("flash-lite:generateContent")) {
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "Weekend collection",
      caption: "Discover our weekend collection. See what's new.", subtitle: "Fresh picks for the weekend" }) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 7, totalTokenCount: 17 } });
  }
  throw new Error(`Unexpected request to ${url}`);
}

test("Gemini text alone cannot enable AI artwork", async () => fixture(async () => {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = async () => { throw new Error("Gemini image generation must not run."); };
  const response = await generateContent(new Request("http://localhost:8000/api/generate", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "artwork", prompt: "Weekend collection",
      title: "Weekend collection", caption: "Browse the collection.", subtitle: "Fresh picks" }) }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /CLOUDFLARE_ACCOUNT_ID/);
  assert.equal(db().prepare("SELECT id FROM ai_calls").all().length, 1);
}));

test("the old video request is rejected before calling any provider", async () => fixture(async () => {
  globalThis.fetch = async () => { throw new Error("No provider should run for a removed format."); };
  const response = await generateContent(new Request("http://localhost:8000/api/generate", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "video", prompt: "Weekend collection" }) }));
  assert.equal(response.status, 400);
  assert.equal(db().prepare("SELECT id FROM ai_calls").all().length, 0);
}));

test("upload fills blank title and subtitle while keeping the user's caption", async () => fixture(async (png) => {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (input, init) => {
    const request = JSON.parse(String(init?.body));
    assert.match(request.contents[0].parts[0].text, /Weekend collection/);
    assert.equal(request.contents[0].parts[0].inlineData, undefined);
    return geminiResponse(String(input));
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

test("Cloudflare template background is reused when editable text changes", async () => fixture(async (_png, directory) => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  const jpegPath = path.join(directory, "template-fixture.jpg");
  const image = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-frames:v", "1", jpegPath]);
  assert.equal(image.status, 0, image.stderr.toString());
  let cloudflareCalls = 0;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /api\.cloudflare\.com/);
    cloudflareCalls++;
    return Response.json({ success: true, result: { image: readFileSync(jpegPath).toString("base64") } });
  };
  const request = new Request("http://localhost:8000/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "template", prompt: "Neighborhood craft fair", title: "", caption: "", subtitle: "" }) });
  const response = await generateContent(request);
  assert.equal(response.status, 201);
  const asset = await response.json();
  const stored = db().prepare("SELECT title,caption,subtitle,template_headline,template_body,media_url,thumbnail_url FROM content WHERE id=?").get(asset.id);
  assert.equal(stored?.title, "Neighborhood craft fair");
  assert.equal(stored?.subtitle, "Discover what's new.");
  assert.ok(String(stored?.caption).includes("Neighborhood craft fair"));
  assert.equal(stored?.template_headline, stored?.title);
  assert.equal(stored?.template_body, stored?.subtitle);
  assert.ok(existsSync(path.join(directory, path.basename(new URL(String(stored?.media_url)).pathname))));
  assert.ok(existsSync(path.join(directory, String(stored?.thumbnail_url))));
  assert.equal(cloudflareCalls, 1);
  const edit = await editTemplate(new Request(`http://localhost:8000/api/content/${asset.id}`, { method: "PATCH",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ headline: "Updated fair", body: "Join us this weekend" }) }),
  { params: Promise.resolve({ id: asset.id }) });
  assert.equal(edit.status, 200);
  const updated = db().prepare("SELECT title,media_url,thumbnail_url,template_headline,template_body FROM content WHERE id=?").get(asset.id);
  assert.equal(updated?.title, "Updated fair");
  assert.notEqual(updated?.media_url, stored?.media_url);
  assert.equal(updated?.thumbnail_url, stored?.thumbnail_url);
  assert.equal(updated?.template_headline, "Updated fair");
  assert.equal(updated?.template_body, "Join us this weekend");
  assert.equal(cloudflareCalls, 1);
  const calls = db().prepare("SELECT operation FROM ai_calls").all();
  assert.deepEqual(calls.map((call) => call.operation), ["template_background"]);
}));

test("complete user copy stays unchanged and does not call an AI provider", async () => fixture(async () => {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = async () => { throw new Error("AI should not run for complete copy."); };
  const { copy } = await recommendCopy({ kind: "image", context: "A weekend collection", title: "Our launch",
    caption: "Words written by the team", subtitle: "See it this weekend" });
  assert.deepEqual(copy, { title: "Our launch", caption: "Words written by the team", subtitle: "See it this weekend" });
  assert.equal(db().prepare("SELECT id FROM ai_calls").all().length, 0);
}));
