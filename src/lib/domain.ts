import { z } from "zod";

export const platformSchema = z.enum(["facebook", "instagram", "youtube"]);
export type Platform = z.infer<typeof platformSchema>;
export const mediaKindSchema = z.enum(["image", "video"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;
export const jobStatusSchema = z.enum(["queued", "processing", "published", "failed", "uncertain", "needs_review"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const platformLabels: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
};

export function allowedPlatforms(kind: MediaKind): Platform[] {
  return kind === "image" ? ["facebook", "instagram"] : ["facebook", "instagram", "youtube"];
}

export const contentInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  kind: mediaKindSchema,
  source: z.enum(["upload", "template", "ai_artwork", "generated_video"]),
  mediaUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional().nullable(),
  caption: z.string().max(2200).default(""),
});

export const createJobsSchema = z.object({
  contentId: z.string().min(1),
  targets: z.array(platformSchema).min(1),
  captions: z.partialRecord(platformSchema, z.string().max(2200)).default(() => ({})),
  scheduledAt: z.string().datetime().nullable().default(null),
});

export const credentialEventSchema = z.object({
  platform: z.enum(["meta", "google"]),
  event: z.enum(["issued", "refreshed"]),
  expiresAt: z.string().datetime().nullable().default(null),
  outcome: z.enum(["success", "failed"]),
});

export type PublishFailureReason =
  | "not_configured" | "not_enabled" | "incomplete" | "does_not_match"
  | "connect_cloudinary" | "preview_only" | "public_app_url" | "set_app_url"
  | "rejected_4xx" | "rate_limited" | "timeout" | "unknown";

export type PublishOutcome =
  | { kind: "published";    providerId: string; permalink: string }
  | { kind: "needs_review"; providerId: string; permalink: string | null; reason: "accepted_pending" | "uncertain" }
  | { kind: "failed";       reason: PublishFailureReason; detail: string };

export class PublishError extends Error {
  constructor(readonly reason: PublishFailureReason, message: string) { super(message); }
}

export function parseUsage(raw: unknown): { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } {
  const candidate = typeof raw === "object" && raw !== null && "usage" in raw ? raw.usage : raw;
  const usage = z.object({
    input_tokens: z.number().int().nonnegative().nullable().optional(),
    output_tokens: z.number().int().nonnegative().nullable().optional(),
    total_tokens: z.number().int().nonnegative().nullable().optional(),
  }).safeParse(candidate);
  if (!usage.success) return { inputTokens: null, outputTokens: null, totalTokens: null };
  return {
    inputTokens: usage.data.input_tokens ?? null,
    outputTokens: usage.data.output_tokens ?? null,
    totalTokens: usage.data.total_tokens ?? null,
  };
}


export function allowedPlatformCaption(caption: string, platform: Platform, campaign: string, appUrl: string): string {
  const tracked = new URL("/product", appUrl);
  tracked.searchParams.set("platform", platform);
  tracked.searchParams.set("campaign", campaign);
  const link = tracked.toString();
  const separator = caption.trim() ? "\n\n" : "";
  const limit = platform === "instagram" ? 2200 : platform === "youtube" ? 5000 : 63206;
  const remaining = limit - link.length - separator.length;
  if (remaining < 0) throw new Error(`The tracked product link is too long for ${platformLabels[platform]}.`);
  const safeCaption = caption.trim().slice(0, remaining).trimEnd();
  return `${safeCaption}${safeCaption ? separator : ""}${link}`;
}

export function wrapText(text: string, maxChars: number, maxLines: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || maxChars < 1 || maxLines < 1) return "";
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const parts = word.match(new RegExp(`.{1,${maxChars}}`, "gu")) ?? [word];
    for (const part of parts) {
      const candidate = line ? `${line} ${part}` : part;
      if (candidate.length <= maxChars) line = candidate;
      else {
        lines.push(line);
        line = part;
      }
      if (lines.length === maxLines) break;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").length;
  if (consumed < text.trim().replace(/\s+/g, " ").length) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
  return lines.join("\n");
}
