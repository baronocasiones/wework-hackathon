import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../src/lib/db";
import { observeCredential, recordAiCall } from "../src/lib/monitoring";

test("AI calls persist provider tokens per execution and omit credential values", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-monitoring-"));
  process.env.DATABASE_PATH = path.join(directory, "monitoring.sqlite");
  const runId = "verification-run";
  recordAiCall({ runId, operation: "caption", model: "gpt-6-luna", responseUsage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 }, durationMs: 80, outcome: "success" });
  recordAiCall({ runId, operation: "artwork", model: "gpt-image-2.6-flare", durationMs: 120, outcome: "failed" });
  const calls = db().prepare("SELECT operation,input_tokens,output_tokens,total_tokens,outcome FROM ai_calls WHERE run_id=? ORDER BY created_at,id").all(runId);
  assert.equal(calls.length, 2);
  const caption = calls.find((call) => call.operation === "caption");
  const artwork = calls.find((call) => call.operation === "artwork");
  assert.deepEqual([caption?.input_tokens, caption?.output_tokens, caption?.total_tokens, caption?.outcome], [12, 5, 17, "success"]);
  assert.deepEqual([artwork?.input_tokens, artwork?.output_tokens, artwork?.total_tokens, artwork?.outcome], [null, null, null, "failed"]);
  observeCredential({ platform: "meta", secret: "test-secret-never-log" });
  const event = db().prepare("SELECT detail FROM credential_events WHERE platform='meta'").get() as { detail: string };
  assert.doesNotMatch(event.detail, /test-secret-never-log/);
  db().close();
  globalThis.postHouseDatabase = undefined;
  rmSync(directory, { recursive: true, force: true });
});
