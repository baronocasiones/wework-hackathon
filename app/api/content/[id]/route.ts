import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { renderImageOverlay, renderVideoOverlay } from "@/lib/render-overlay";
import { getStyle } from "@/lib/styles";
import { uploadLocalFile } from "@/lib/media";
import { generatePosterAsset, kenBurnsDuration, buildGrokInstruction } from "@/lib/ideogram";
import { falVideo } from "@/lib/fal-video";
import { jsonError } from "@/lib/http";
import { apiAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({ headline: z.string().trim().min(1).max(70), body: z.string().trim().min(1).max(100), cta: z.string().trim().min(1).max(40).optional() });

const IDEOGRAM_SOURCES = new Set(["ideogram_artwork", "ideogram_video"]);
const DRAWTEXT_VIDEO_SOURCES = new Set(["cloudflare_video"]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = apiAccess(request); if (denied) return denied;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Keep the headline under 70 characters and supporting text under 100.");
  const existing = db().prepare("SELECT id,title,caption,source,kind,thumbnail_url,style,template_cta,poster_prompt FROM content WHERE id=?").get(id) as { id: string; title: string; caption: string; source: string; kind: string; thumbnail_url: string | null; style: string | null; template_cta: string | null; poster_prompt: string | null } | undefined;
  if (!existing) return jsonError("Content not found.", 404);
  const isTemplate = existing.source === "template";
  const isIdeogram = IDEOGRAM_SOURCES.has(existing.source);
  const isGrokTextVideo = existing.source === "fal_grok_native_video" && Boolean(existing.poster_prompt);
  const isDrawtextVideo = DRAWTEXT_VIDEO_SOURCES.has(existing.source);
  const isLegacyDrawtext = existing.source === "cloudflare_artwork" || existing.source === "fal_grok_native_video";
  const regenerate = isIdeogram || isGrokTextVideo;
  if (!regenerate && !isTemplate && !isLegacyDrawtext && !isDrawtextVideo) return jsonError("Only generated Publication Materials can be edited here.", 404);
  if (regenerate && !existing.poster_prompt) return jsonError("This asset was generated before edit briefs were stored. Generate a new asset instead.", 400);
  if (!regenerate && !existing.thumbnail_url) return jsonError("This content has no editable base media.", 404);
  try {
    const style = getStyle(existing.style);
    const cta = parsed.data.cta?.trim() || existing.template_cta || "SHOP NOW";
    if (isGrokTextVideo) {
      const scene = existing.poster_prompt ?? "";
      const grokDirection = buildGrokInstruction(scene, style.promptSuffix);
      const editedHint = `${grokDirection} Let the wording be loosely inspired by "${parsed.data.headline}"${parsed.data.body ? ` and "${parsed.data.body}"` : ""} — feel free to restate or invent; do not copy verbatim.`;
      const v = await falVideo(editedHint, randomUUID());
      const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
      await mkdir(directory, { recursive: true });
      const baseFile = `${id}-grok-base.mp4`;
      await writeFile(path.join(directory, baseFile), v.bytes);
      const mediaUrl = await uploadLocalFile(path.join(directory, baseFile), "video");
      db().prepare("UPDATE content SET title=?,media_url=?,thumbnail_url=?,template_headline=?,template_body=?,template_cta=?,subtitle=? WHERE id=?")
        .run(parsed.data.headline, mediaUrl, baseFile, parsed.data.headline, parsed.data.body, cta, parsed.data.body, id);
      return Response.json({ id, mediaUrl });
    }
    if (isIdeogram) {
      const asset = await generatePosterAsset({
        runId: randomUUID(),
        scene: existing.poster_prompt ?? "",
        copy: { headline: parsed.data.headline, body: parsed.data.body, cta },
        style,
        format: existing.kind === "video" ? "video" : "image",
        durationSeconds: kenBurnsDuration(),
      });
      db().prepare("UPDATE content SET title=?,media_url=?,thumbnail_url=?,template_headline=?,template_body=?,template_cta=?,subtitle=? WHERE id=?")
        .run(parsed.data.headline, asset.mediaUrl, asset.baseFileName, parsed.data.headline, parsed.data.body, cta, parsed.data.body, id);
      return Response.json({ id, mediaUrl: asset.mediaUrl });
    }
    const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
    const baseName = path.basename(existing.thumbnail_url ?? "");
    const basePath = path.join(directory, baseName);
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
