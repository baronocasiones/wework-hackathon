import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { db } from "../src/lib/db";
import { GET as dashboard } from "../app/api/dashboard/route";

test("YouTube pending upload counts only after the restarted worker confirms it", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-youtube-review-"));
  const filename = path.join(directory, "studio.sqlite");
  const oldPath = process.env.DATABASE_PATH;
  const oldDatabase = globalThis.postHouseDatabase;
  process.env.DATABASE_PATH = filename;
  globalThis.postHouseDatabase = undefined;
  let worker: ChildProcess | undefined;
  const start = (state: string) => spawn(process.execPath, ["--import", "tsx", "--import", "./tests/mock-youtube-status.mjs", "src/worker/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: filename, YOUTUBE_TEST_STATE: state, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", GOOGLE_REFRESH_TOKEN: "test-refresh", YOUTUBE_CHANNEL_ID: "test-channel" },
    stdio: "pipe",
  });
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await exited;
  };
  const waitFor = async (status: string) => {
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const row = db().prepare("SELECT status,updated_at FROM publish_jobs WHERE id='pending'").get() as { status: string; updated_at: string };
      if (row.status === status && row.updated_at !== "2020-01-01T00:00:00.000Z") return;
      if (worker?.exitCode !== null) throw new Error(`Worker exited before ${status}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${status}`);
  };

  try {
    const database = db();
    database.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)").run("test-owner", "owner@example.test", "unused", new Date().toISOString());
    database.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").run(
      (await import("node:crypto")).createHash("sha256").update("b".repeat(64)).digest("hex"), "test-owner", "2099-01-01T00:00:00.000Z", new Date().toISOString());
    database.prepare("INSERT INTO content(id,title,kind,source,media_url,caption,created_at) VALUES(?,?,?,?,?,?,?)")
      .run("content", "Video", "video", "upload", "https://res.cloudinary.com/test/video.mp4", "Caption", new Date().toISOString());
    database.prepare("INSERT INTO publish_jobs(id,content_id,platform,publish_mode,caption,scheduled_at,status,provider_id,permalink,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run("pending", "content", "youtube", "live", "Caption", "2020-01-01T00:00:00.000Z", "needs_review", "test-video", "https://www.youtube.com/watch?v=test-video", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");

    worker = start("processing");
    await waitFor("needs_review");
    assert.equal((database.prepare("SELECT status FROM publish_jobs WHERE id='pending'").get() as { status: string }).status, "needs_review");
    await stop(worker);

    worker = start("private");
    const beforePrivateCheck = (database.prepare("SELECT updated_at FROM publish_jobs WHERE id='pending'").get() as { updated_at: string }).updated_at;
    const privateCheckDeadline = Date.now() + 10_000;
    while ((database.prepare("SELECT updated_at FROM publish_jobs WHERE id='pending'").get() as { updated_at: string }).updated_at === beforePrivateCheck) {
      if (Date.now() > privateCheckDeadline) throw new Error("Timed out waiting for private-video review");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal((database.prepare("SELECT status FROM publish_jobs WHERE id='pending'").get() as { status: string }).status, "needs_review");
    await stop(worker);

    worker = start("processed");
    await waitFor("published");
    const row = database.prepare("SELECT status,provider_id,permalink,attempts FROM publish_jobs WHERE id='pending'").get() as { status: string; provider_id: string; permalink: string; attempts: number };
    assert.deepEqual({ ...row }, { status: "published", provider_id: "test-video", permalink: "https://www.youtube.com/watch?v=test-video", attempts: 0 });
    await stop(worker);
    worker = undefined;

    for (let i = 0; i < 30; i += 1) {
      database.prepare("INSERT INTO publish_jobs(id,content_id,platform,publish_mode,caption,scheduled_at,status,provider_id,permalink,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(`older-${i}`, "content", "youtube", "live", "Caption", new Date(i * 1000).toISOString(), "published", `older-video-${i}`, `https://www.youtube.com/watch?v=older-video-${i}`, new Date(i * 1000).toISOString(), new Date(i * 1000).toISOString());
    }
    const response = await dashboard(new Request("http://localhost:8000/api/dashboard", { headers: { cookie: `post_house_session=${"b".repeat(64)}` } }));
    assert.equal(response.status, 200);
    const data = await response.json() as { jobs: unknown[]; metrics: Array<{ platform: string; postCount: number }> };
    assert.equal(data.jobs.length, 30);
    assert.equal(data.metrics.find((metric) => metric.platform === "youtube")?.postCount, 31);
  } finally {
    if (worker) await stop(worker);
    if (globalThis.postHouseDatabase) db().close();
    globalThis.postHouseDatabase = oldDatabase;
    if (oldPath === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
