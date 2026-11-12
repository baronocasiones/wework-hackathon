import { z } from "zod";
import { db, nowIso } from "@/lib/db";
import { createGeneratedAsset } from "@/lib/generation";
import { renderImageOverlay, renderVideoOverlay } from "@/lib/render-overlay";
import { getStyle } from "@/lib/styles";
import { uploadLocalFile } from "@/lib/media";
import { jsonError } from "@/lib/http";
import { apiAccess } from "@/lib/auth";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({ headline: z.string().trim().min(1).max(70), body: z.string().trim().min(1).max(100), cta: z.string().trim().min(1).max(40).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = apiAccess(request); if (denied) return denied;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Keep the headline under 70 characters and supporting text under 100.");
  const existing = db().prepare("SELECT id,title,caption,source,kind,thumbnail_url,style,template_cta FROM content WHERE id=?").get(id) as { id: string; title: string; caption: string; source: string; kind: string; thumbnail_url: string | null; style: string | null; template_cta: string | null } | undefined;
  if (!existing) return jsonError("Content not found.", 404);
  const isTemplate = existing.source === "template";
  const isGenerated = existing.source === "cloudflare_artwork" || existing.source === "fal_grok_native_video";
  if (!isTemplate && !isGenerated) return jsonError("Only generated Publication Materials can be edited here.", 404);
  if (!existing.thumbnail_url) return jsonError("This content has no editable base media.", 404);
  try {
    const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
    const baseName = path.basename(existing.thumbnail_url);
    const basePath = path.join(directory, baseName);
    const style = getStyle(existing.style);
    const cta = parsed.data.cta?.trim() || existing.template_cta || "SHOP NOW";
    const renderedFile = `${id}-edited.${existing.kind === "video" ? "mp4" : "png"}`;
    const renderedPath = path.join(directory, renderedFile);
    if (existing.kind === "video") {
      await renderVideoOverlay(basePath, renderedPath, { headline: parsed.data.headline, body: parsed.data.body, cta, style });
    } else {
      await renderImageOverlay(basePath, renderedPath, { headline: parsed.data.headline, body: parsed.data.body, cta, style });
    }
    const mediaUrl = await uploadLocalFile(renderedPath, existing.kind === "video" ? "video" : "image");
    db().prepare("UPDATE content SET title=?,media_url=?,template_headline=?,template_body=?,template_cta=?,subtitle=? WHERE id=?")
      .run(parsed.data.headline, mediaUrl, parsed.data.headline, parsed.data.body, cta, parsed.data.body, id);
    return Response.json({ id, mediaUrl });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not update these Publication Materials.", 500); }
}