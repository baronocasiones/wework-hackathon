import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

declare global {
  var postHouseDatabase: DatabaseSync | undefined;
}

export function db(): DatabaseSync {
  if (globalThis.postHouseDatabase) return globalThis.postHouseDatabase;
  const filename = path.resolve(process.env.DATABASE_PATH ?? "./data/studio.sqlite");
  mkdirSync(path.dirname(filename), { recursive: true });
  const connection = new DatabaseSync(filename);
  connection.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS content (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('image','video')),
      source TEXT NOT NULL, media_url TEXT NOT NULL, thumbnail_url TEXT, caption TEXT NOT NULL,
      created_at TEXT NOT NULL, template_headline TEXT, template_body TEXT, subtitle TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS publish_jobs (
      id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content(id), platform TEXT NOT NULL CHECK(platform IN ('facebook','instagram','youtube')),
      caption TEXT NOT NULL, scheduled_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','processing','published','failed','uncertain','needs_review')),
      provider_id TEXT, permalink TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(content_id, platform, scheduled_at)
    );
    CREATE INDEX IF NOT EXISTS jobs_due ON publish_jobs(status, scheduled_at);
    CREATE TABLE IF NOT EXISTS ai_calls (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, operation TEXT NOT NULL, model TEXT NOT NULL,
      input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, duration_ms INTEGER NOT NULL,
      outcome TEXT NOT NULL, estimated_cost_usd REAL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credential_events (
      id TEXT PRIMARY KEY, platform TEXT NOT NULL, event TEXT NOT NULL, expires_at TEXT,
      outcome TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credential_fingerprints (
      platform TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, observed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_secrets (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS demo_purchases (
      id TEXT PRIMARY KEY, platform TEXT NOT NULL, campaign TEXT, amount REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id TEXT PRIMARY KEY, platform TEXT NOT NULL, job_id TEXT REFERENCES publish_jobs(id),
      views INTEGER NOT NULL, likes INTEGER NOT NULL, comments INTEGER NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('live','demo')), observed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS demo_metrics (
      platform TEXT PRIMARY KEY, views INTEGER NOT NULL, likes INTEGER NOT NULL, comments INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'demo sample'
    );
    INSERT OR IGNORE INTO demo_metrics(platform,views,likes,comments) VALUES
      ('facebook',2480,186,22),('instagram',1920,241,18),('youtube',5210,332,41);
  `);
  const contentColumns = connection.prepare("PRAGMA table_info(content)").all();
  if (!contentColumns.some((column) => column.name === "template_headline")) connection.exec("ALTER TABLE content ADD COLUMN template_headline TEXT");
  if (!contentColumns.some((column) => column.name === "template_body")) connection.exec("ALTER TABLE content ADD COLUMN template_body TEXT");
  if (!contentColumns.some((column) => column.name === "subtitle")) connection.exec("ALTER TABLE content ADD COLUMN subtitle TEXT NOT NULL DEFAULT ''");
  globalThis.postHouseDatabase = connection;
  return connection;
}

export function nowIso(): string {
  return new Date().toISOString();
}
