import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, nowIso } from "@/lib/db";
import { createGeneratedAsset } from "@/lib/generation";
import { allowedPlatforms } from "@/lib/domain";
import { jsonError } from "@/lib/http";
import { apiAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({ kind: z.enum(["template", "artwork", "grok_video"]), prompt: z.string().trim().min(1).max(1000),
  title: z.string().trim().max(120).optional(), caption: z.string().trim().max(2200).optional(), subtitle: z.string().trim().max(100).optional() });

export async function POST(request: Request): Promise<Response> {
  const denied = apiAccess(request); if (denied) return denied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Add a short campaign idea and choose a format.");
  try {
    const asset = await createGeneratedAsset(parsed.data);
    const { templateBackgroundFile, ...publicAsset } = asset;
    const id = randomUUID();
    db().prepare("INSERT INTO content(id,title,kind,source,media_url,thumbnail_url,caption,created_at,subtitle,style,template_headline,template_body,template_cta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, asset.title, asset.kind, asset.source, asset.mediaUrl, templateBackgroundFile ?? null, asset.caption, nowIso(), asset.subtitle, asset.style ?? null, asset.templateHeadline ?? null, asset.templateBody ?? null, asset.templateCta ?? null);
    const calls = db().prepare("SELECT COALESCE(SUM(input_tokens),0) input_tokens,COALESCE(SUM(output_tokens),0) output_tokens,COALESCE(SUM(total_tokens),0) total_tokens FROM ai_calls WHERE run_id=?").get(asset.runId);
    return Response.json({ id, ...publicAsset, allowedPlatforms: allowedPlatforms(asset.kind), usage: calls }, { status: 201 });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not create this asset.", 502); }
}
