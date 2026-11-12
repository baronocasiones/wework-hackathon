import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPosterScene, buildIdeogramPrompt, sanitizeScene, generatePosterAsset, artworkTextMode, renderingSpeed } from "../src/lib/ideogram";
import { getStyle } from "../src/lib/styles";
import { db } from "../src/lib/db";
import { createGeneratedAsset } from "../src/lib/generation";
import { POST as generateContent } from "../app/api/generate/route";
import { PATCH as editContent } from "../app/api/content/[id]/route";
import { authorizeTestDatabase } from "./auth-fixture";

const envKeys = ["FAL_KEY", "FAL_IDEOGRAM_SPEED", "ARTWORK_TEXT_MODE", "FAL_VIDEO_DURATION", "FAL_VIDEO_AUDIO_TRACK",
  "AGENT_ENABLED", "GEMINI_API_KEY", "OPENAI_API_KEY", "DATABASE_PATH", "UPLOAD_DIR", "APP_URL",
  "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN",
  "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "FFMPEG_FONT_PATH"] as const;

const brief = { prompt: "The everyday tote at a weekend farmers market stall, warm morning light",
  headline: "ROOM FOR THE MARKET",
  subtitle: "The everyday tote for weekend makers",
  cta: "SHOP NOW" };

function fixtureImage(directory: string): Buffer {
  const jpegPath = path.join(directory, "fixture.jpg");
  const image = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=tan:s=64x64:d=1", "-frames:v", "1", jpegPath]);
  assert.equal(image.status, 0, image.stderr.toString());
  return readFileSync(jpegPath);
}

async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-ideogram-"));
  const saved = new Map(envKeys.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  process.env.DATABASE_PATH = path.join(directory, "studio.sqlite");
  process.env.UPLOAD_DIR = directory;
  process.env.APP_URL = "http://localhost:8000";
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.FAL_KEY;
  delete process.env.FAL_IDEOGRAM_SPEED;
  delete process.env.ARTWORK_TEXT_MODE;
  delete process.env.FAL_VIDEO_DURATION;
  delete process.env.FAL_VIDEO_AUDIO_TRACK;
  delete process.env.AGENT_ENABLED;
  delete process.env.FFMPEG_FONT_PATH;
  try {
    authorizeTestDatabase();
    await run(directory);
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

test("poster prompt keeps the verbatim copy exact and strips echoes from the scene", () => {
  const style = getStyle("playful_pop");
  const scene = buildPosterScene(brief.prompt, style);
  assert.match(scene, /everyday tote/i);
  assert.ok(!scene.includes(brief.headline));
  const scrubbed = sanitizeScene("market day scene Room For The Market stall light", { headline: brief.headline, body: brief.subtitle, cta: brief.cta });
  assert.doesNotMatch(scrubbed.toLowerCase(), /room for the market/i);
  const prompt = buildIdeogramPrompt(scene, { headline: brief.headline, body: brief.subtitle, cta: brief.cta }, style.promptSuffix);
  assert.ok(prompt.length <= 2000);
  for (const line of [brief.headline, brief.subtitle, brief.cta]) {
    const occurrences = prompt.split(line).length - 1;
    assert.equal(occurrences, 1, `expected exactly one occurrence of: ${line}`);
  }
  assert.equal(renderingSpeed(), "BALANCED");
  process.env.FAL_IDEOGRAM_SPEED = "bogus";
  assert.throws(() => renderingSpeed(), /TURBO|BALANCED|QUALITY/);
  delete process.env.FAL_IDEOGRAM_SPEED;
  assert.equal(artworkTextMode(), "ideogram");
  process.env.ARTWORK_TEXT_MODE = "overlay";
  assert.equal(artworkTextMode(), "overlay");
  delete process.env.ARTWORK_TEXT_MODE;
});

test("artwork generates via Ideogram with verbatim copy and records no tokens", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  process.env.AGENT_ENABLED = "false";
  const jpeg = fixtureImage(directory);
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(input) === "https://fal.run/fal-ai/ideogram/v3") {
      return Response.json({ images: [{ url: "https://v3b.fal.media/files/poster.png" }], seed: 7 });
    }
    if (String(input) === "https://v3b.fal.media/files/poster.png") {
      return new Response(new Uint8Array(jpeg), { status: 200 });
    }
    throw new Error(`Unexpected request to ${String(input)}`);
  };
  const response = await generateContent(new Request("http://localhost:8000/api/generate", { method: "POST",
    headers: { "Content-Type": "application/json", ...authorizeTestDatabase() },
    body: JSON.stringify({ kind: "artwork", prompt: brief.prompt,
      title: brief.headline, caption: "A caption for the market day.", subtitle: brief.subtitle, cta: brief.cta }) }));
  assert.equal(response.status, 201);
  const asset = await response.json();
  assert.equal(asset.source, "ideogram_artwork");
  assert.equal(asset.kind, "image");
  assert.match(asset.mediaUrl, /\.png$/);
  assert.equal(requests.length, 2);
  const falCall = requests[0];
  assert.equal(falCall.url, "https://fal.run/fal-ai/ideogram/v3");
  const falBody = falCall.body as { prompt: string; image_size: string; style: string; rendering_speed: string; expand_prompt: boolean; num_images: number };
  assert.equal(falBody.image_size, "portrait_4_3");
  assert.equal(falBody.style, "DESIGN");
  assert.equal(falBody.rendering_speed, "BALANCED");
  assert.equal(falBody.expand_prompt, false);
  assert.equal(falBody.num_images, 1);
  for (const line of [brief.headline, brief.subtitle, brief.cta]) {
    assert.equal(falBody.prompt.split(line).length - 1, 1, `verbatim line missing or duplicated: ${line}`);
  }
  const stored = db().prepare("SELECT source, poster_prompt FROM content WHERE id=?").get(asset.id) as { source: string; poster_prompt: string | null } | undefined;
  assert.equal(stored?.source, "ideogram_artwork");
  assert.ok(stored?.poster_prompt);
  assert.match(String(stored?.poster_prompt), /everyday tote/i);
  assert.ok(!String(stored?.poster_prompt).includes(brief.headline));
  const calls = db().prepare("SELECT model, operation, input_tokens, output_tokens, total_tokens, outcome FROM ai_calls").all() as Array<{ operation: string; outcome: string; input_tokens: number | null }>;
  const ideogramCalls = calls.filter((call) => call.operation === "ideogram");
  assert.equal(ideogramCalls.length, 1);
  assert.equal(ideogramCalls[0].outcome, "success");
  assert.equal(ideogramCalls[0].input_tokens, null);
  const critiques = calls.filter((call) => call.operation === "critique");
  assert.equal(critiques.length, 0);
}));

test("an agent revision that rewrites the copy still ships the verbatim lines", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  const jpeg = fixtureImage(directory);
  const falBodies: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("fal.run/fal-ai/ideogram/v3")) {
      falBodies.push(String(JSON.parse(String(init?.body)).prompt));
      return Response.json({ images: [{ url: "https://v3b.fal.media/files/poster.png" }], seed: 1 });
    }
    if (url === "https://v3b.fal.media/files/poster.png") return new Response(new Uint8Array(jpeg), { status: 200 });
    if (url.includes("flash-lite:generateContent")) {
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        score: 55, issues: ["soft busy background"],
        revisedPrompt: `lighter mood, restate the copy as: ${brief.headline}`,
      }) }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 } });
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  const asset = await createGeneratedAsset({ kind: "artwork", prompt: brief.prompt,
    title: brief.headline, caption: "Market day caption.", subtitle: brief.subtitle, cta: brief.cta });
  assert.equal(asset.source, "ideogram_artwork");
  assert.ok(falBodies.length >= 2, `expected >= 2 attempts, got ${falBodies.length}`);
  const quoted = `"${brief.headline}"`;
  for (const body of falBodies) {
    assert.equal(body.split(quoted).length - 1, 1, `headline must appear exactly once: ${body}`);
  }
}));

test("fal failure falls back to Cloudflare artwork without calling fal twice", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.AGENT_ENABLED = "false";
  const jpeg = fixtureImage(directory);
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === "https://fal.run/fal-ai/ideogram/v3") return Response.json({ images: [{ url: "https://v3b.fal.media/broken.png" }] }, { status: 500 });
    if (url.match(/api\.cloudflare\.com\/client\/v4\/accounts\/test-account\/ai\/run/)) {
      return Response.json({ success: true, result: { image: jpeg.toString("base64") } });
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  const asset = await createGeneratedAsset({ kind: "artwork", prompt: brief.prompt,
    title: brief.headline, caption: "Market day caption.", subtitle: brief.subtitle, cta: brief.cta });
  assert.equal(asset.source, "cloudflare_artwork");
  assert.equal(urls.length, 2);
  assert.match(urls[0], /fal\.run\/fal-ai\/ideogram\/v3/);
  assert.match(urls[1], /api\.cloudflare\.com/);
  const calls = db().prepare("SELECT model, outcome FROM ai_calls ORDER BY created_at").all();
  assert.deepEqual(calls.map((call) => (call as { model: string }).model), ["fal-ai/ideogram/v3", "@cf/black-forest-labs/flux-1-schnell"]);
  assert.equal(calls[0].outcome, "failed");
  assert.equal(calls[1].outcome, "success");
}));

test("ARTWORK_TEXT_MODE=overlay skips fal entirely", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.AGENT_ENABLED = "false";
  process.env.ARTWORK_TEXT_MODE = "overlay";
  const jpeg = fixtureImage(directory);
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.match(/api\.cloudflare\.com/)) return Response.json({ success: true, result: { image: jpeg.toString("base64") } });
    throw new Error(`Unexpected request to ${url}`);
  };
  const asset = await createGeneratedAsset({ kind: "artwork", prompt: brief.prompt,
    title: brief.headline, caption: "Market day caption.", subtitle: brief.subtitle, cta: brief.cta });
  assert.equal(asset.source, "cloudflare_artwork");
  assert.equal(urls.length, 1);
  assert.doesNotMatch(urls[0], /fal\.run/);
}));

test("artistic video generates from an Ideogram still with Ken Burns motion", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  process.env.AGENT_ENABLED = "false";
  process.env.FAL_VIDEO_DURATION = "1";
  const jpeg = fixtureImage(directory);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://fal.run/fal-ai/ideogram/v3") return Response.json({ images: [{ url: "https://v3b.fal.media/files/poster.png" }], seed: 1 });
    if (url === "https://v3b.fal.media/files/poster.png") return new Response(new Uint8Array(jpeg), { status: 200 });
    throw new Error(`Unexpected request to ${url}`);
  };
  const asset = await createGeneratedAsset({ kind: "video", prompt: brief.prompt,
    title: brief.headline, caption: "Market day caption.", subtitle: brief.subtitle, cta: brief.cta });
  assert.equal(asset.source, "ideogram_video");
  assert.equal(asset.kind, "video");
  assert.match(asset.mediaUrl, /\.mp4$/);
  const mediaFile = path.join(directory, path.basename(new URL(asset.mediaUrl).pathname));
  assert.ok(existsSync(mediaFile), "uploaded video file exists");
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", mediaFile]);
  const streams = JSON.parse(probe.stdout.toString()).streams as Array<{ codec_type: string }>;
  assert.ok(streams.some((stream) => stream.codec_type === "video"));
  assert.ok(streams.some((stream) => stream.codec_type === "audio"));
}));

test("PATCH regenerates an ideogram asset from the stored scene prompt", async () => fixture(async (directory) => {
  process.env.FAL_KEY = "test-fal-secret";
  process.env.AGENT_ENABLED = "false";
  const jpeg = fixtureImage(directory);
  const falBodies: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://fal.run/fal-ai/ideogram/v3") {
      falBodies.push(String(JSON.parse(String(init?.body)).prompt));
      return Response.json({ images: [{ url: "https://v3b.fal.media/files/poster.png" }], seed: 1 });
    }
    if (url === "https://v3b.fal.media/files/poster.png") return new Response(new Uint8Array(jpeg), { status: 200 });
    throw new Error(`Unexpected request to ${url}`);
  };
  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();
  db().prepare("INSERT INTO content(id,title,kind,source,media_url,thumbnail_url,caption,created_at,subtitle,style,template_cta,poster_prompt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, brief.headline, "image", "ideogram_artwork", "https://example.test/first.png", null, "caption", new Date().toISOString(), brief.subtitle, "playful_pop", brief.cta, `${brief.prompt}.`);
  const response = await editContent(new Request(`http://localhost:8000/api/content/${id}`, { method: "PATCH",
    headers: { "Content-Type": "application/json", ...authorizeTestDatabase() },
    body: JSON.stringify({ headline: "SUNDAY MARKET", body: "One weekend only" }) }),
  { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  const updated = db().prepare("SELECT title, template_headline, subtitle, poster_prompt FROM content WHERE id=?").get(id) as { title: string; template_headline: string; subtitle: string; poster_prompt: string | null };
  assert.equal(updated.title, "SUNDAY MARKET");
  assert.equal(updated.template_headline, "SUNDAY MARKET");
  assert.equal(updated.subtitle, "One weekend only");
  assert.equal(updated.poster_prompt, `${brief.prompt}.`);
  assert.equal(falBodies.length, 1);
  assert.match(falBodies[0], /SUNDAY MARKET/);
  assert.match(falBodies[0], new RegExp(brief.prompt.slice(0, 20)));
  assert.doesNotMatch(falBodies[0], /ROOM FOR THE MARKET/);
}));
