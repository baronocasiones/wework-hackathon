import { createHash, randomUUID } from "node:crypto";
import { db, nowIso } from "@/lib/db";
import { parseUsage } from "@/lib/domain";

export function recordAiCall(args: {
  runId: string;
  operation: string;
  model: string;
  responseUsage?: unknown;
  durationMs: number;
  outcome: "success" | "failed";
  estimatedCostUsd?: number | null;
}): void {
  const usage = parseUsage(args.responseUsage);
  db().prepare(`INSERT INTO ai_calls(id,run_id,operation,model,input_tokens,output_tokens,total_tokens,duration_ms,outcome,estimated_cost_usd,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), args.runId, args.operation, args.model, usage.inputTokens,
    usage.outputTokens, usage.totalTokens, args.durationMs, args.outcome, args.estimatedCostUsd ?? null, nowIso());
}

export function aggregateUsage(rows: Array<{ input_tokens: number | null; output_tokens: number | null; total_tokens: number | null }>): { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } {
  const sum = (field: "input_tokens" | "output_tokens" | "total_tokens"): number | null => {
    const values = rows.flatMap((row) => row[field] === null ? [] : [row[field] as number]);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return { inputTokens: sum("input_tokens"), outputTokens: sum("output_tokens"), totalTokens: sum("total_tokens") };
}

export function observeCredential(args: { platform: "meta" | "google"; secret: string | undefined; expiresAt?: string | null }): void {
  if (!args.secret) return;
  const fingerprint = createHash("sha256").update(args.secret).digest("hex");
  const database = db();
  const old = database.prepare("SELECT fingerprint FROM credential_fingerprints WHERE platform=?").get(args.platform) as { fingerprint: string } | undefined;
  if (old?.fingerprint === fingerprint) return;
  const event = old ? "refreshed" : "issued";
  database.prepare("INSERT INTO credential_fingerprints(platform,fingerprint,observed_at) VALUES(?,?,?) ON CONFLICT(platform) DO UPDATE SET fingerprint=excluded.fingerprint,observed_at=excluded.observed_at")
    .run(args.platform, fingerprint, nowIso());
  database.prepare("INSERT INTO credential_events(id,platform,event,expires_at,outcome,detail,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(randomUUID(), args.platform, event, args.expiresAt ?? null, "success", "Credential observed server-side; secret value omitted.", nowIso());
}

export function recordCredentialEvent(args: {
  platform: "meta" | "google"; event: "issued" | "refreshed"; expiresAt: string | null;
  outcome: "success" | "failed"; detail: string;
}): void {
  db().prepare("INSERT INTO credential_events(id,platform,event,expires_at,outcome,detail,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(randomUUID(), args.platform, args.event, args.expiresAt, args.outcome, args.detail.slice(0, 240), nowIso());
}
