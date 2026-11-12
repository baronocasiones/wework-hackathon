import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { db } from "../src/lib/db";
import { PublishError } from "../src/lib/domain";
import { publishJob } from "../src/lib/publish";
import { POST as scheduleJobs } from "../app/api/jobs/route";
import { POST as postNow } from "../app/api/jobs/[id]/publish/route";
import { GET as dashboard } from "../app/api/dashboard/route";
import { POST as recordPurchase } from "../app/api/purchase/route";

type JobRow = { status: string; publish_mode: string; provider_id: string | null; permalink: string | null };

test("local Meta jobs complete now and after a worker restart without network or live results", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-simulated-meta-"));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousMode = process.env.META_PUBLISH_MODE;
  const previousAppUrl = process.env.APP_URL;
  const previousMetaCredentials = {
    META_PAGE_ID: process.env.META_PAGE_ID,
    META_PAGE_ACCESS_TOKEN: process.env.META_PAGE_ACCESS_TOKEN,
    META_IG_USER_ID: process.env.META_IG_USER_ID,
  };
  const previousPostHouseDatabase = globalThis.postHouseDatabase;
  const filename = path.join(directory, "studio.sqlite");
  process.env.DATABASE_PATH = filename;
  process.env.META_PUBLISH_MODE = "simulated";
  process.env.APP_URL = "http://localhost:8000";
  process.env.META_PAGE_ID = "unused-page";
  process.env.META_PAGE_ACCESS_TOKEN = "unused-token";
  process.env.META_IG_USER_ID = "unused-instagram";
  globalThis.postHouseDatabase = undefined;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Unexpected network request"); };
  let worker: ChildProcess | undefined;

  const startWorker = () => spawn(process.execPath, ["--import", "tsx", "--import", "./tests/block-network.mjs", "src/worker/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: filename, META_PUBLISH_MODE: "simulated", APP_URL: "http://localhost:8000", META_PAGE_ID: "", META_PAGE_ACCESS_TOKEN: "", META_IG_USER_ID: "", CLOUDINARY_CLOUD_NAME: "" },
    stdio: "pipe",
  });
  const stopWorker = async (child: ChildProcess) => {
    if (child.exitCode !== null) return;
    const stopped = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await stopped;
  };
  const waitForStatus = async (id: string, expected: string) => {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const row = db().prepare("SELECT status,publish_mode,provider_id,permalink FROM publish_jobs WHERE id=?").get(id) as JobRow;
      if (row.status === expected) return row;
      if (worker?.exitCode !== null) throw new Error(`Worker exited before ${id} reached ${expected}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${id} to reach ${expected}`);
  };

  try {
    const database = db();
    database.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)").run("test-owner", "owner@example.test", "unused", new Date().toISOString());
    database.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").run(
      (await import("node:crypto")).createHash("sha256").update("a".repeat(64)).digest("hex"), "test-owner", "2099-01-01T00:00:00.000Z", new Date().toISOString());
    const cookie = `post_house_session=${"a".repeat(64)}`;
    database.prepare("INSERT INTO content(id,title,kind,source,media_url,caption,created_at,subtitle) VALUES(?,?,?,?,?,?,?,?)")
      .run("local-pubmat", "Local pubmat", "image", "upload", "http://localhost:8000/uploads/local.png", "Demo caption", new Date().toISOString(), "");

    const makeJob = async (platform: "facebook" | "instagram", scheduledAt: string) => {
      const response = await scheduleJobs(new Request("http://localhost:8000/api/jobs", {
        method: "POST", headers: { "content-type": "application/json", cookie, origin: "http://localhost:8000" },
        body: JSON.stringify({ contentId: "local-pubmat", targets: [platform], scheduledAt }),
      }));
      assert.equal(response.status, 201);
      const body = await response.json() as { jobs: Array<{ id: string }> };
      return body.jobs[0].id;
    };

    const facebookId = await makeJob("facebook", "2099-01-01T00:00:00.000Z");
    const instagramId = await makeJob("instagram", "2099-01-01T00:00:00.000Z");
    const now = await postNow(new Request(`http://localhost:8000/api/jobs/${facebookId}/publish`, { method: "POST", headers: { cookie, origin: "http://localhost:8000" } }), { params: Promise.resolve({ id: facebookId }) });
    assert.equal(now.status, 200);

    assert.deepEqual(await publishJob({ id: "probe", platform: "facebook", publish_mode: "simulated", caption: "", media_url: "http://localhost:8000/uploads/local.png", kind: "image", title: "Local pubmat" }), { kind: "simulated" });
    process.env.META_PUBLISH_MODE = "live";
    assert.deepEqual(await publishJob({ id: "probe", platform: "instagram", publish_mode: "simulated", caption: "", media_url: "http://localhost:8000/uploads/local.png", kind: "image", title: "Local pubmat" }), { kind: "simulated" });
    process.env.META_PUBLISH_MODE = "simulated";
    await assert.rejects(publishJob({ id: "probe", platform: "facebook", publish_mode: "live", caption: "", media_url: "http://localhost:8000/uploads/local.png", kind: "image", title: "Local pubmat" }), (error: unknown) => error instanceof PublishError && error.reason === "not_enabled");
    assert.equal(calls, 0);

    const purchase = await recordPurchase(new Request("http://localhost:8000/api/purchase", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "instagram", campaign: "local-pubmat", amount: 49 }),
    }));
    assert.equal(purchase.status, 201);

    worker = startWorker();
    const facebook = await waitForStatus(facebookId, "simulated");
    assert.deepEqual({ ...facebook }, { status: "simulated", publish_mode: "simulated", provider_id: null, permalink: null });
    assert.equal((db().prepare("SELECT status FROM publish_jobs WHERE id=?").get(instagramId) as JobRow).status, "queued");
    await stopWorker(worker);

    database.prepare("UPDATE publish_jobs SET scheduled_at=? WHERE id=?").run(new Date(Date.now() - 1_000).toISOString(), instagramId);
    worker = startWorker();
    const instagram = await waitForStatus(instagramId, "simulated");
    assert.deepEqual({ ...instagram }, { status: "simulated", publish_mode: "simulated", provider_id: null, permalink: null });
    assert.equal(calls, 0);

    const response = await dashboard(new Request("http://localhost:8000/api/dashboard", { headers: { cookie } }));
    assert.equal(response.status, 200);
    const data = await response.json() as { metrics: Array<{ platform: string; postCount: number; simulatedPostCount: number; source: string; sales: number; revenue: number }>; jobs: JobRow[]; configured: { metaMode: string; meta: boolean } };
    assert.equal(data.configured.metaMode, "simulated");
    assert.equal(data.configured.meta, false);
    for (const platform of ["facebook", "instagram"]) {
      const metric = data.metrics.find((row) => row.platform === platform);
      assert.equal(metric?.postCount, 0);
      assert.equal(metric?.simulatedPostCount, 1);
      assert.equal(metric?.source, "demo");
    }
    assert.equal(data.jobs.filter((job) => job.status === "published").length, 0);
    assert.equal(data.metrics.find((row) => row.platform === "instagram")?.sales, 1);
    assert.equal(data.metrics.find((row) => row.platform === "instagram")?.revenue, 49);
  } finally {
    if (worker) await stopWorker(worker);
    globalThis.fetch = originalFetch;
    if (globalThis.postHouseDatabase) db().close();
    globalThis.postHouseDatabase = previousPostHouseDatabase;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previousDatabase;
    if (previousMode === undefined) delete process.env.META_PUBLISH_MODE; else process.env.META_PUBLISH_MODE = previousMode;
    if (previousAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousAppUrl;
    for (const [key, value] of Object.entries(previousMetaCredentials)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("existing jobs migrate to explicit modes without losing their references", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-meta-migration-"));
  const filename = path.join(directory, "studio.sqlite");
  const old = new DatabaseSync(filename);
  old.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE content(id TEXT PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL,source TEXT NOT NULL,media_url TEXT NOT NULL,caption TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE publish_jobs(id TEXT PRIMARY KEY,content_id TEXT NOT NULL REFERENCES content(id),platform TEXT NOT NULL,caption TEXT NOT NULL,scheduled_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','processing','published','failed','uncertain','needs_review')),provider_id TEXT,permalink TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(content_id,platform,scheduled_at));
    CREATE TABLE metric_snapshots(id TEXT PRIMARY KEY,job_id TEXT REFERENCES publish_jobs(id));
    INSERT INTO content(id,title,kind,source,media_url,caption,created_at) VALUES('c','Legacy','image','upload','http://localhost:8000/uploads/local.png','','2026-11-11T00:00:00.000Z');
    INSERT INTO publish_jobs(id,content_id,platform,caption,scheduled_at,status,created_at,updated_at) VALUES('j','c','facebook','','2099-01-01T00:00:00.000Z','queued','2026-11-11T00:00:00.000Z','2026-11-11T00:00:00.000Z');
    INSERT INTO publish_jobs(id,content_id,platform,caption,scheduled_at,status,provider_id,permalink,created_at,updated_at) VALUES('j-live','c','facebook','','2026-11-11T00:00:00.000Z','published','real-id','https://facebook.com/real-id','2026-11-11T00:00:00.000Z','2026-11-11T00:00:00.000Z');
    INSERT INTO metric_snapshots(id,job_id) VALUES('m','j');
  `);
  old.close();
  const previousDatabase = process.env.DATABASE_PATH;
  const previousPostHouseDatabase = globalThis.postHouseDatabase;
  process.env.DATABASE_PATH = filename;
  globalThis.postHouseDatabase = undefined;
  try {
    const migrated = db();
    assert.deepEqual({ ...migrated.prepare("SELECT status,publish_mode FROM publish_jobs WHERE id='j'").get() }, { status: "queued", publish_mode: "simulated" });
    assert.deepEqual({ ...migrated.prepare("SELECT status,publish_mode,provider_id FROM publish_jobs WHERE id='j-live'").get() }, { status: "published", publish_mode: "live", provider_id: "real-id" });
    assert.equal(migrated.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.equal(migrated.prepare("SELECT job_id FROM metric_snapshots WHERE id='m'").get()?.job_id, "j");
    migrated.prepare("UPDATE publish_jobs SET status='simulated' WHERE id='j'").run();
    assert.equal(migrated.prepare("SELECT status FROM publish_jobs WHERE id='j'").get()?.status, "simulated");
  } finally {
    if (globalThis.postHouseDatabase) db().close();
    globalThis.postHouseDatabase = previousPostHouseDatabase;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
