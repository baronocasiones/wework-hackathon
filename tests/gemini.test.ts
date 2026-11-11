import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../src/lib/db";
import { geminiCaption } from "../src/lib/gemini";

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

test("provider failure is recorded without exposing response or key", async () => fixture(async () => {
  globalThis.fetch = async () => new Response("test-gemini-secret private provider detail", { status: 429 });
  await assert.rejects(geminiCaption("blocked", "failed-run"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Gemini caption failed with status 429.");
    return true;
  });
  const call = db().prepare("SELECT outcome,input_tokens,output_tokens,total_tokens FROM ai_calls WHERE run_id=?").get("failed-run");
  assert.deepEqual({ ...call }, { outcome: "failed", input_tokens: null, output_tokens: null, total_tokens: null });
}));
