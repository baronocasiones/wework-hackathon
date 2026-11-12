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
      publish_mode TEXT NOT NULL CHECK(publish_mode IN ('simulated','live')),
      caption TEXT NOT NULL, scheduled_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','processing','published','simulated','failed','uncertain','needs_review')),
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
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY, failures INTEGER NOT NULL, blocked_until TEXT
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
  const jobColumns = connection.prepare("PRAGMA table_info(publish_jobs)").all();
  if (!jobColumns.some((column) => column.name === "publish_mode")) {
    connection.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
    try {
      connection.exec(`
        CREATE TABLE publish_jobs_new (
          id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content(id), platform TEXT NOT NULL CHECK(platform IN ('facebook','instagram','youtube')),
          publish_mode TEXT NOT NULL CHECK(publish_mode IN ('simulated','live')),
          caption TEXT NOT NULL, scheduled_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','processing','published','simulated','failed','uncertain','needs_review')),
          provider_id TEXT, permalink TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(content_id, platform, scheduled_at)
        );
        INSERT INTO publish_jobs_new(id,content_id,platform,publish_mode,caption,scheduled_at,status,provider_id,permalink,error,attempts,created_at,updated_at)
          SELECT id,content_id,platform,CASE WHEN platform IN ('facebook','instagram') AND status='queued' THEN 'simulated' ELSE 'live' END,caption,scheduled_at,status,provider_id,permalink,error,attempts,created_at,updated_at FROM publish_jobs;
        DROP TABLE publish_jobs;
        ALTER TABLE publish_jobs_new RENAME TO publish_jobs;
        CREATE INDEX jobs_due ON publish_jobs(status, scheduled_at);
      `);
      connection.exec("COMMIT;");
    } catch (error) { connection.exec("ROLLBACK;"); throw error; }
    finally { connection.exec("PRAGMA foreign_keys = ON;"); }
  }
  const contentColumns = connection.prepare("PRAGMA table_info(content)").all();
  if (!contentColumns.some((column) => column.name === "template_headline")) connection.exec("ALTER TABLE content ADD COLUMN template_headline TEXT");
  if (!contentColumns.some((column) => column.name === "template_body")) connection.exec("ALTER TABLE content ADD COLUMN template_body TEXT");
  if (!contentColumns.some((column) => column.name === "subtitle")) connection.exec("ALTER TABLE content ADD COLUMN subtitle TEXT NOT NULL DEFAULT ''");
  if (!contentColumns.some((column) => column.name === "style")) connection.exec("ALTER TABLE content ADD COLUMN style TEXT");
  if (!contentColumns.some((column) => column.name === "template_cta")) connection.exec("ALTER TABLE content ADD COLUMN template_cta TEXT");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS generation_attempts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt INTEGER NOT NULL, kind TEXT NOT NULL,
      score INTEGER, issues TEXT, revised_prompt TEXT, accepted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS gen_attempts_run ON generation_attempts(run_id);
  `);
  globalThis.postHouseDatabase = connection;
  return connection;
}

export function nowIso(): string {
  return new Date().toISOString();
}
