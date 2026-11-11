import { db, nowIso } from "@/lib/db";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const changed = db().prepare("UPDATE publish_jobs SET status='queued', error=NULL, scheduled_at=?, updated_at=? WHERE id=? AND status IN ('failed','uncertain','needs_review')").run(nowIso(), nowIso(), id);
    if (!changed.changes) return jsonError("This post is not eligible for retry.", 409);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not retry this post.", 500);
  }
}