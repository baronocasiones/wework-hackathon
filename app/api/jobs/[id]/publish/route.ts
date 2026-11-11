import { db, nowIso } from "@/lib/db";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const changed = db().prepare("UPDATE publish_jobs SET scheduled_at=?,updated_at=? WHERE id=? AND status='queued'").run(nowIso(), nowIso(), id);
  if (!changed.changes) return jsonError("This post is no longer waiting to publish.", 409);
  return Response.json({ ok: true });
}
