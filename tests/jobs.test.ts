import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { claimDueJob, recoverInterruptedJobs } from "../src/lib/jobs";

test("queued schedules persist through restart and interrupted publishes become review-only", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-jobs-"));
  const filename = path.join(directory, "jobs.sqlite");
  const first = new DatabaseSync(filename);
  first.exec("CREATE TABLE publish_jobs(id TEXT PRIMARY KEY,status TEXT,scheduled_at TEXT,attempts INTEGER DEFAULT 0,error TEXT,updated_at TEXT)");
  first.prepare("INSERT INTO publish_jobs(id,status,scheduled_at) VALUES('future','queued','2099-01-01T00:00:00.000Z'),('interrupted','processing','2026-01-01T00:00:00.000Z')").run();
  first.close();

  const restarted = new DatabaseSync(filename);
  const queued = restarted.prepare("SELECT status FROM publish_jobs WHERE id='future'").get();
  assert.equal(queued?.status, "queued");
  assert.equal(recoverInterruptedJobs(restarted, "2026-11-11T00:00:00.000Z"), 1);
  const interrupted = restarted.prepare("SELECT status,error FROM publish_jobs WHERE id='interrupted'").get();
  assert.equal(interrupted?.status, "uncertain");
  assert.match(String(interrupted?.error), /Review the platform/);
  assert.equal(claimDueJob(restarted, "2026-11-11T00:00:00.000Z"), null);
  assert.equal(claimDueJob(restarted, "2099-01-01T00:00:00.000Z"), "future");
  assert.equal(claimDueJob(restarted, "2099-01-01T00:00:00.000Z"), null);
  restarted.close();
  rmSync(directory, { recursive: true, force: true });
});
