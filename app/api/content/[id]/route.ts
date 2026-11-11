import { z } from "zod";
import { db, nowIso } from "@/lib/db";
import { createGeneratedAsset } from "@/lib/generation";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({ headline: z.string().trim().min(1).max(70), body: z.string().trim().min(1).max(100) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Keep the headline under 70 characters and supporting text under 100.");
  const existing = db().prepare("SELECT id,title,source,kind FROM content WHERE id=?").get(id) as { id: string; title: string; source: string; kind: string } | undefined;
  if (!existing || existing.source !== "template" || existing.kind !== "image") return jsonError("Only template pubmats can be edited here.", 404);
  try {
    const asset = await createGeneratedAsset({ kind: "template", prompt: existing.title, headline: parsed.data.headline, body: parsed.data.body });
    db().prepare("UPDATE content SET media_url=?,template_headline=?,template_body=?,caption=?,created_at=? WHERE id=?")
      .run(asset.mediaUrl, parsed.data.headline, parsed.data.body, parsed.data.body, nowIso(), id);
    return Response.json({ id, mediaUrl: asset.mediaUrl });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not update this pubmat.", 500); }
}
