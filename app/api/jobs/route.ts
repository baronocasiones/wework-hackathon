import { randomUUID } from "node:crypto";
import { createJobsSchema, allowedPlatforms, allowedPlatformCaption, type MediaKind, type Platform } from "@/lib/domain";
import { db, nowIso } from "@/lib/db";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json(db().prepare(`SELECT j.*,c.title,c.kind,c.media_url FROM publish_jobs j JOIN content c ON c.id=j.content_id ORDER BY j.scheduled_at DESC LIMIT 60`).all());
}

export async function POST(request: Request): Promise<Response> {
  const parsed = createJobsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose at least one platform and a valid posting time.");
  const { contentId, targets, captions, scheduledAt } = parsed.data;
  const content = db().prepare("SELECT id,kind,media_url,caption FROM content WHERE id=?").get(contentId) as { id: string; kind: MediaKind; media_url: string; caption: string } | undefined;
  if (!content) return jsonError("This content could not be found.", 404);
  const allowed = allowedPlatforms(content.kind);
  if (targets.some((platform: Platform) => !allowed.includes(platform))) return jsonError("That platform does not support this content format.");
  if (new Set(targets).size !== targets.length) return jsonError("Choose each platform once.");
  const time = scheduledAt ?? nowIso();
  if (Date.parse(time) < Date.now() - 60_000) return jsonError("Choose a future time or post now.");
  const insert = db().prepare("INSERT INTO publish_jobs(id,content_id,platform,caption,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)");
  const database = db();
  try {
    database.exec("BEGIN IMMEDIATE");
    const jobs = targets.map((platform) => {
      const id = randomUUID();
      const caption = captions[platform]?.trim() || content.caption;
      insert.run(id, contentId, platform, allowedPlatformCaption(caption, platform, contentId, process.env.APP_URL ?? "http://localhost:8000"), time, nowIso(), nowIso());
      return { id, platform, scheduledAt: time, status: "queued" };
    });
    database.exec("COMMIT");
    return Response.json({ jobs }, { status: 201 });
  } catch {
    database.exec("ROLLBACK");
    return jsonError("A posting job already exists for one of these platforms at that time.", 409);
  }
}
