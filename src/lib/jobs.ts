import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "@/lib/db";

export function recoverInterruptedJobs(database: DatabaseSync, timestamp = nowIso()): number {
  database.prepare("UPDATE publish_jobs SET status='queued',error=NULL,updated_at=? WHERE status='processing' AND publish_mode='simulated'").run(timestamp);
  const result = database.prepare("UPDATE publish_jobs SET status='uncertain',error='Worker stopped while a provider request may have been in progress. Review the platform before taking action.',updated_at=? WHERE status='processing'").run(timestamp);
  return Number(result.changes);
}

export function claimDueJob(database: DatabaseSync, timestamp = nowIso()): string | null {
  const parsed = z.object({ id: z.string() }).safeParse(database.prepare("SELECT id FROM publish_jobs WHERE status='queued' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 1").get(timestamp));
  if (!parsed.success) return null;
  const changed = database.prepare("UPDATE publish_jobs SET status='processing',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'").run(timestamp, parsed.data.id);
  return changed.changes === 1 ? parsed.data.id : null;
}
