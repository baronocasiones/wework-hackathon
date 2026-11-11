import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, nowIso } from "@/lib/db";
import { createGeneratedAsset } from "@/lib/generation";
import { allowedPlatforms } from "@/lib/domain";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({ kind: z.enum(["template", "artwork", "video"]), prompt: z.string().trim().min(1).max(1000), headline: z.string().trim().max(100).optional(), body: z.string().trim().max(160).optional() });

export async function POST(request: Request): Promise<Response> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Add a short campaign idea and choose a format.");
  try {
    const asset = await createGeneratedAsset(parsed.data);
    const id = randomUUID();
    db().prepare("INSERT INTO content(id,title,kind,source,media_url,thumbnail_url,caption,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, asset.title, asset.kind, asset.source, asset.mediaUrl, null, asset.caption, nowIso());
    if (asset.templateHeadline) db().prepare("UPDATE content SET template_headline=?,template_body=? WHERE id=?").run(asset.templateHeadline, asset.templateBody ?? "", id);
    const calls = db().prepare("SELECT COALESCE(SUM(input_tokens),0) input_tokens,COALESCE(SUM(output_tokens),0) output_tokens,COALESCE(SUM(total_tokens),0) total_tokens FROM ai_calls WHERE run_id=?").get(asset.runId);
    return Response.json({ id, ...asset, allowedPlatforms: allowedPlatforms(asset.kind), usage: calls }, { status: 201 });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not create this asset.", 502); }
}
