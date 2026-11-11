import { db, nowIso } from "@/lib/db";
import { PartialPublishError, publishJob } from "@/lib/publish";
import { claimDueJob, recoverInterruptedJobs } from "@/lib/jobs";

const database = db();
const abandoned = recoverInterruptedJobs(database);
if (abandoned > 0) process.stderr.write(`Moved ${abandoned} interrupted job(s) to review.\n`);

let busy = false;
async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const dueId = claimDueJob(database);
    if (!dueId) return;
    const due = database.prepare(`SELECT j.id,j.platform,j.caption,c.media_url,c.kind,c.title FROM publish_jobs j JOIN content c ON c.id=j.content_id WHERE j.id=?`).get(dueId) as { id: string; platform: "facebook" | "instagram" | "youtube"; caption: string; media_url: string; kind: "image" | "video"; title: string } | undefined;
    if (!due) return;
    try {
      const outcome = await publishJob(due);
      database.prepare("UPDATE publish_jobs SET status=?,provider_id=?,permalink=?,error=NULL,updated_at=? WHERE id=? AND status='processing'")
        .run(outcome.status, outcome.result.providerId, outcome.result.permalink, nowIso(), due.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The provider returned an unknown result.";
      const partial = error instanceof PartialPublishError;
      const knownBlocked = /not configured|not enabled|incomplete|does not match|connect cloudinary|preview-only|public app url|set app_url/i.test(message);
      const knownRejected = /returned 4\d\d|failed with status 4\d\d/i.test(message);
      const status = knownBlocked || knownRejected ? "failed" : "uncertain";
      database.prepare("UPDATE publish_jobs SET status=?,provider_id=COALESCE(?,provider_id),permalink=COALESCE(?,permalink),error=?,updated_at=? WHERE id=? AND status='processing'").run(status, partial ? error.providerId : null, partial ? error.permalink : null, message.slice(0, 500), nowIso(), due.id);
    }
  } catch (error) {
    process.stderr.write(`Worker cycle failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  } finally { busy = false; }
}

process.stdout.write("Content studio worker is watching scheduled posts.\n");
void tick();
setInterval(() => { void tick(); }, 5000);
