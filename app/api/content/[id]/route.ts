import { z } from "zod";
import { db, nowIso } from "@/lib/db";
import { createGeneratedAsset } from "@/lib/generation";
import { jsonError } from "@/lib/http";
import { apiAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({ headline: z.string().trim().min(1).max(70), body: z.string().trim().min(1).max(100) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = apiAccess(request); if (denied) return denied;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Keep the headline under 70 characters and supporting text under 100.");
  const existing = db().prepare("SELECT id,title,caption,source,kind,thumbnail_url FROM content WHERE id=?").get(id) as { id: string; title: string; caption: string; source: string; kind: string; thumbnail_url: string | null } | undefined;
  if (!existing || existing.source !== "template" || existing.kind !== "image") return jsonError("Only template Publication Materials can be edited here.", 404);
  try {
    const asset = await createGeneratedAsset({ kind: "template", prompt: existing.title, title: parsed.data.headline,
      caption: existing.caption, subtitle: parsed.data.body, templateBackgroundFile: existing.thumbnail_url });
    db().prepare("UPDATE content SET title=?,media_url=?,template_headline=?,template_body=?,subtitle=?,created_at=? WHERE id=?")
      .run(parsed.data.headline, asset.mediaUrl, parsed.data.headline, parsed.data.body, parsed.data.body, nowIso(), id);
    return Response.json({ id, mediaUrl: asset.mediaUrl });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not update these Publication Materials.", 500); }
}
