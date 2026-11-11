import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { db } from "../src/lib/db";
import { POST as scheduleJobs } from "../app/api/jobs/route";
import { POST as postNow } from "../app/api/jobs/[id]/publish/route";

test("schedule returns 409 for a duplicate job and 500 for other DB errors", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-schedule-"));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousPostHouseDatabase = globalThis.postHouseDatabase;
  process.env.DATABASE_PATH = path.join(directory, "studio.sqlite");
  globalThis.postHouseDatabase = undefined;
  process.env.APP_URL = "https://example.com";

  try {
    const database = db();
    database.prepare("INSERT INTO content(id,title,kind,source,media_url,caption,created_at,subtitle) VALUES(?,?,?,?,?,?,?,?)")
      .run("content-1", "T", "image", "upload", "https://res.cloudinary.com/demo/image/upload/sample.jpg", "cap", "2026-11-11T00:00:00.000Z", "");

    // First schedule succeeds.
    const first = await scheduleJobs(new Request("http://localhost:8000/api/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentId: "content-1", targets: ["instagram"], captions: {}, scheduledAt: "2099-01-01T00:00:00.000Z" }),
    }));
    assert.equal(first.status, 201);

    // Duplicate returns 409.
    const duplicate = await scheduleJobs(new Request("http://localhost:8000/api/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentId: "content-1", targets: ["instagram"], captions: {}, scheduledAt: "2099-01-01T00:00:00.000Z" }),
    }));
    assert.equal(duplicate.status, 409);

    // A non-duplicate DB error returns 500, not 409.
    database.exec("CREATE TRIGGER fail_publish_jobs BEFORE INSERT ON publish_jobs BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    const errored = await scheduleJobs(new Request("http://localhost:8000/api/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentId: "content-1", targets: ["facebook"], captions: {}, scheduledAt: "2099-02-02T00:00:00.000Z" }),
    }));
    assert.equal(errored.status, 500);
  } finally {
    if (globalThis.postHouseDatabase) db().close();
    globalThis.postHouseDatabase = previousPostHouseDatabase;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
