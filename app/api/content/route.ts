import { randomUUID } from "node:crypto";
import { contentInputSchema, allowedPlatforms } from "@/lib/domain";
import { db, nowIso } from "@/lib/db";
import { storeLocalMedia, uploadToCloudinary } from "@/lib/media";
import { jsonError } from "@/lib/http";
import { recommendCopy } from "@/lib/generation";
import { apiAccess } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const denied = apiAccess(request); if (denied) return denied;
  return Response.json(db().prepare("SELECT * FROM content ORDER BY created_at DESC LIMIT 30").all());
}

export async function POST(request: Request): Promise<Response> {
  const denied = apiAccess(request); if (denied) return denied;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("Choose an image or video file.");
    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : null;
    if (!kind) return jsonError("Upload an image or video file.");
    if (kind === "image" && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return jsonError("Use a PNG, JPG, or WebP image.");
    if (kind === "video" && file.type !== "video/mp4") return jsonError("Use an MP4 video.");
    if (file.size > 200 * 1024 * 1024) return jsonError("Files must be smaller than 200 MB.");
    const mediaUrl = process.env.CLOUDINARY_CLOUD_NAME ? await uploadToCloudinary(file, kind) : await storeLocalMedia(file, kind);
    const { copy } = await recommendCopy({ kind, context: String(form.get("context") ?? "").trim() || file.name,
      title: String(form.get("title") ?? ""), caption: String(form.get("caption") ?? ""), subtitle: String(form.get("subtitle") ?? "") });
    const parsed = contentInputSchema.safeParse({ title: copy.title, kind, source: "upload", mediaUrl, caption: copy.caption });
    if (!parsed.success) return jsonError("Add a title and valid caption before saving.");
    const id = randomUUID();
    db().prepare("INSERT INTO content(id,title,kind,source,media_url,thumbnail_url,caption,created_at,subtitle) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, parsed.data.title, parsed.data.kind, parsed.data.source, parsed.data.mediaUrl, null, parsed.data.caption, nowIso(), copy.subtitle);
    return Response.json({ id, ...parsed.data, subtitle: copy.subtitle, allowedPlatforms: allowedPlatforms(parsed.data.kind) }, { status: 201 });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not save this upload.", 500); }
}
