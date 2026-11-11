import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../src/lib/db";
import { geminiCaption, geminiImage, geminiVideo } from "../src/lib/gemini";

async function fixture(run: () => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-gemini-"));
  const previousKey = process.env.GEMINI_API_KEY;
  const previousDatabase = process.env.DATABASE_PATH;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-gemini-secret";
  process.env.DATABASE_PATH = path.join(directory, "test.sqlite");
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabase;
    if (globalThis.postHouseDatabase) db().close();
    globalThis.postHouseDatabase = undefined;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("caption sends generateContent request and records Gemini token usage", async () => fixture(async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "test-gemini-secret");
    const body = JSON.parse(String(init?.body));
    assert.match(body.contents[0].parts[0].text, /fall sale/);
    return Response.json({ candidates: [{ content: { parts: [{ text: "  Shop today!  " }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 17 } });
  };
  assert.equal(await geminiCaption("fall sale", "caption-run"), "Shop today!");
  const call = db().prepare("SELECT operation,model,input_tokens,output_tokens,total_tokens,outcome FROM ai_calls WHERE run_id=?").get("caption-run");
  assert.deepEqual({ ...call }, { operation: "caption", model: "gemini-3.5-flash-lite", input_tokens: 12,
    output_tokens: 4, total_tokens: 17, outcome: "success" });
}));

test("image requests portrait output and extracts inline image", async () => fixture(async () => {
  const bytes = Buffer.from("image sample");
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.generationConfig, { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "4:5" } });
    return Response.json({ candidates: [{ content: { parts: [{ text: "A picture" },
      { inlineData: { mimeType: "image/png", data: bytes.toString("base64") } }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 16 } });
  };
  assert.deepEqual(await geminiImage("a product photo", "image-run"), { bytes, mimeType: "image/png" });
  const call = db().prepare("SELECT input_tokens,output_tokens,total_tokens,outcome FROM ai_calls WHERE run_id=?").get("image-run");
  assert.deepEqual({ ...call }, { input_tokens: 5, output_tokens: 10, total_tokens: 16, outcome: "success" });
}));

test("video requests 9:16 URI delivery, polls Google file, and downloads MP4", async () => fixture(async () => {
  const requests: string[] = [];
  const bytes = Buffer.from("video sample");
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "test-gemini-secret");
    if (url.endsWith("/interactions")) {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.response_format, { type: "video", aspect_ratio: "9:16", delivery: "uri" });
      return Response.json({ status: "completed", usage: { total_input_tokens: 8, total_output_tokens: 20, total_tokens: 30 },
        steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4",
          uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123:download?alt=media" }] }] });
    }
    if (url.endsWith("/files/abc123")) return Response.json({ state: "ACTIVE" });
    if (url.includes("/files/abc123:download")) return new Response(bytes, { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  assert.deepEqual(await geminiVideo("a vertical commercial", "video-run"), { bytes, mimeType: "video/mp4" });
  assert.equal(requests.length, 3);
  const call = db().prepare("SELECT input_tokens,output_tokens,total_tokens,outcome FROM ai_calls WHERE run_id=?").get("video-run");
  assert.deepEqual({ ...call }, { input_tokens: 8, output_tokens: 20, total_tokens: 30, outcome: "success" });
}));

test("video extracts inline MP4 and leaves missing usage unavailable", async () => fixture(async () => {
  const bytes = Buffer.from("inline video");
  globalThis.fetch = async () => Response.json({ status: "completed", steps: [{ type: "model_output",
    content: [{ type: "video", mime_type: "video/mp4", data: bytes.toString("base64") }] }] });
  assert.deepEqual(await geminiVideo("small clip", "inline-run"), { bytes, mimeType: "video/mp4" });
  const call = db().prepare("SELECT input_tokens,output_tokens,total_tokens FROM ai_calls WHERE run_id=?").get("inline-run");
  assert.deepEqual({ ...call }, { input_tokens: null, output_tokens: null, total_tokens: null });
}));

test("provider failure is recorded without exposing response or key", async () => fixture(async () => {
  globalThis.fetch = async () => new Response("test-gemini-secret private provider detail", { status: 429 });
  await assert.rejects(geminiImage("blocked", "failed-run"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Gemini artwork failed with status 429.");
    return true;
  });
  const call = db().prepare("SELECT outcome,input_tokens,output_tokens,total_tokens FROM ai_calls WHERE run_id=?").get("failed-run");
  assert.deepEqual({ ...call }, { outcome: "failed", input_tokens: null, output_tokens: null, total_tokens: null });
}));

test("video rejects a non-Google download URI and records failure", async () => fixture(async () => {
  globalThis.fetch = async () => Response.json({ status: "completed", steps: [{ type: "model_output",
    content: [{ type: "video", mime_type: "video/mp4", uri: "https://attacker.example/steal" }] }] });
  await assert.rejects(geminiVideo("clip", "unsafe-run"), /invalid file URI/);
  const call = db().prepare("SELECT outcome FROM ai_calls WHERE run_id=?").get("unsafe-run");
  assert.deepEqual({ ...call }, { outcome: "failed" });
}));
