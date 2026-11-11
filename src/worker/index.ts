import { db, nowIso } from "@/lib/db";
import { PartialPublishError, PublishError, publishJob } from "@/lib/publish";
import { claimDueJob, recoverInterruptedJobs } from "@/lib/jobs";
import { type PublishOutcome } from "@/lib/domain";

const database = db();
const abandoned = recoverInterruptedJobs(database);
if (abandoned > 0) process.stderr.write(`Moved ${abandoned} interrupted job(s) to review.\n`);

const JOB_TIMEOUT_MS = 120_000;
let busy = false;
let shuttingDown = false;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PublishError("timeout", `Job exceeded ${ms}ms timeout.`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function mapOutcome(outcome: PublishOutcome): { status: string; providerId: string | null; permalink: string | null; error: string | null } {
  if (outcome.kind === "published") return { status: "published", providerId: outcome.providerId, permalink: outcome.permalink, error: null };
  if (outcome.kind === "needs_review") return { status: "needs_review", providerId: outcome.providerId, permalink: outcome.permalink, error: null };
  return { status: "failed", providerId: null, permalink: null, error: outcome.detail };
}

function isFailedReason(reason: string): boolean {
  return reason === "rejected_4xx" || reason === "not_configured" || reason === "not_enabled"
    || reason === "incomplete" || reason === "does_not_match" || reason === "connect_cloudinary"
    || reason === "preview_only" || reason === "public_app_url" || reason === "set_app_url";
}

async function tick(): Promise<void> {
  if (busy || shuttingDown) return;
  busy = true;
  try {
    const dueId = claimDueJob(database);
    if (!dueId) return;
    const due = database.prepare(`SELECT j.id,j.platform,j.caption,c.media_url,c.kind,c.title FROM publish_jobs j JOIN content c ON c.id=j.content_id WHERE j.id=?`).get(dueId) as { id: string; platform: "facebook" | "instagram" | "youtube"; caption: string; media_url: string; kind: "image" | "video"; title: string } | undefined;
    if (!due) return;
    try {
      const outcome = await withTimeout(publishJob(due), JOB_TIMEOUT_MS);
      const mapped = mapOutcome(outcome);
      database.prepare("UPDATE publish_jobs SET status=?,provider_id=COALESCE(?,provider_id),permalink=COALESCE(?,permalink),error=?,updated_at=? WHERE id=? AND status='processing'")
        .run(mapped.status, mapped.providerId, mapped.permalink, mapped.error, nowIso(), due.id);
    } catch (error) {
      const partial = error instanceof PartialPublishError;
      const publishErr = error instanceof PublishError ? (error as PublishError) : null;
      const reason = publishErr ? publishErr.reason : (partial ? "rejected_4xx" : "unknown");
      const status = (partial || isFailedReason(reason)) ? "failed" : "uncertain";
      const message = error instanceof Error ? error.message : "The provider returned an unknown result.";
      database.prepare("UPDATE publish_jobs SET status=?,provider_id=COALESCE(?,provider_id),permalink=COALESCE(?,permalink),error=?,updated_at=? WHERE id=? AND status='processing'")
        .run(status, partial ? (error as PartialPublishError).providerId : null, partial ? (error as PartialPublishError).permalink : null, message.slice(0, 500), nowIso(), due.id);
    }
  } catch (error) {
    process.stderr.write(`Worker cycle failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  } finally { busy = false; }
}

process.on("SIGTERM", () => { shuttingDown = true; process.stderr.write("Content studio worker shutting down.\n"); });
process.on("SIGINT", () => { shuttingDown = true; process.stderr.write("Content studio worker shutting down.\n"); });

process.stdout.write("Content studio worker is watching scheduled posts.\n");
void tick();
setInterval(() => { void tick(); }, 5000);
