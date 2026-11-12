import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { db, nowIso } from "@/lib/db";
import { recordAiCall } from "@/lib/monitoring";

export type CritiqueResult = { score: number; issues: string[]; revisedPrompt: string };
export type CritiqueFocus = "image" | "overlay";

const critiqueSchema = z.object({
  score: z.coerce.number().int().min(0).max(100),
  issues: z.array(z.string()).default([]),
  revisedPrompt: z.string().min(1),
});

const RUBRIC =
  "Score rubric: 0-25 unusable; 26-49 major failure/artifact; 50-69 visibly flawed; 70-84 good; 85-100 excellent. " +
  "If score < 85, issues MUST list concrete flaws. revisedPrompt MUST preserve what works and fix the flaws, <= 300 chars.";
const JSON_CONTRACT = `Return ONLY a JSON object: {"score": number, "issues": string[], "revisedPrompt": string}.`;

function visionModel(): string {
  return process.env.GEMINI_VISION_MODEL?.trim() || "gemini-3.1-flash-lite";
}

function threshold(): number {
  const raw = Number(process.env.AGENT_SCORE_THRESHOLD ?? "70");
  return Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : 70;
}

export function agentEnabled(): boolean {
  const v = process.env.AGENT_ENABLED;
  if (v === undefined) return true;
  return v.trim().toLowerCase() === "true" || v.trim() === "1";
}

function critiquePrompt(originalPrompt: string, style: string, focus: CritiqueFocus): string {
  if (focus === "overlay") {
    return `You are a visual quality critic for social media images with burned-in text. The image has a burned-in headline, body line, and CTA. Text context: ${originalPrompt.slice(0, 500)}. Style target: ${style}.\n` +
      `Focus ONLY on: text legibility, contrast between text and background, safe-zone fit, and clipping/overflow of the burned-in headline/body/CTA.\n` +
      `${RUBRIC}\n${JSON_CONTRACT}`;
  }
  return `You are a visual quality critic for social media images. Score the image 0-100 for visual appeal, brand fit, and text-readability readiness. Style target: ${style}. Original idea: ${originalPrompt.slice(0, 500)}.\n` +
    `${RUBRIC}\n${JSON_CONTRACT}`;
}

export async function critiqueImage(imageBytes: Buffer, originalPrompt: string, style: string, runId: string, focus: CritiqueFocus = "image"): Promise<CritiqueResult> {
  const model = visionModel();
  const started = Date.now();
  let outcome: "success" | "failed" = "failed";
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error("Gemini not configured.");
    const mime = imageBytes[0] === 0x89 && imageBytes[1] === 0x50 ? "image/png" : "image/jpeg";
    const base64 = imageBytes.toString("base64");
    const prompt = critiquePrompt(originalPrompt, style, focus);
    const apiKey = process.env.GEMINI_API_KEY.trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Gemini vision failed with status ${response.status}.`);
    const raw = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } };
    const text = raw.candidates?.flatMap((c) => c.content?.parts ?? []).map((p) => p.text ?? "").join("").trim() ?? "";
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error("bad format");
    const parsed = critiqueSchema.safeParse(JSON.parse(text.slice(first, last + 1)));
    if (!parsed.success) throw new Error("invalid critique");
    outcome = "success";
    recordAiCall({ runId, operation: "critique", model, responseUsage: { input_tokens: raw.usageMetadata?.promptTokenCount ?? null, output_tokens: raw.usageMetadata?.candidatesTokenCount ?? null, total_tokens: raw.usageMetadata?.totalTokenCount ?? null }, durationMs: Date.now() - started, outcome });
    return parsed.data;
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "unknown error").slice(0, 120);
    recordAiCall({ runId, operation: "critique", model, durationMs: Date.now() - started, outcome });
    return { score: -1, issues: [`critique unavailable: ${reason}`], revisedPrompt: originalPrompt };
  }
}

export function extractFirstFrame(videoBytes: Buffer): Buffer | null {
  const result = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-i", "pipe:0", "-frames:v", "1", "-f", "image2", "pipe:1"], { input: videoBytes, maxBuffer: 50 * 1024 * 1024, encoding: "buffer" });
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) return null;
  return Buffer.from(result.stdout);
}

function probeDuration(videoBytes: Buffer): number | null {
  const result = spawnSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "pipe:0"], { input: videoBytes, maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) return null;
  const duration = Number(result.stdout.toString().trim());
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

export function extractFrameAt(videoBytes: Buffer, seconds: number): Buffer | null {
  const result = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-ss", seconds.toFixed(3), "-i", "pipe:0", "-frames:v", "1", "-f", "image2", "pipe:1"], { input: videoBytes, maxBuffer: 50 * 1024 * 1024, encoding: "buffer" });
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) return null;
  return Buffer.from(result.stdout);
}

function extractEvenFrames(videoBytes: Buffer, count: number): Buffer[] | null {
  const duration = probeDuration(videoBytes);
  if (duration === null) return null;
  const frames: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const frame = extractFrameAt(videoBytes, (duration * (i + 0.5)) / count);
    if (!frame) return null;
    frames.push(frame);
  }
  return frames;
}

export async function critiqueVideoMultiFrame(videoBytes: Buffer, originalPrompt: string, style: string, runId: string): Promise<CritiqueResult> {
  const frames = extractEvenFrames(videoBytes, 3);
  if (!frames) {
    const frame = extractFirstFrame(videoBytes);
    if (frame) return critiqueImage(frame, originalPrompt, style, runId, "image");
    return { score: -1, issues: ["critique unavailable: frame extraction failed"], revisedPrompt: originalPrompt };
  }
  const critiques = await Promise.all(frames.map((frame) => critiqueImage(frame, originalPrompt, style, runId, "image")));
  let lowest = critiques[0];
  for (const critique of critiques) if (critique.score < lowest.score) lowest = critique;
  return {
    score: Math.min(...critiques.map((critique) => critique.score)),
    issues: [...new Set(critiques.flatMap((critique) => critique.issues))],
    revisedPrompt: lowest.revisedPrompt,
  };
}

export type AgentAttempt = { attempt: number; score: number; issues: string[]; revisedPrompt: string; accepted: boolean };
export type AgentAsset = { bytes: Buffer; mediaUrl: string; baseMediaUrl?: string | null };

async function runAgentLoop(args: {
  runId: string;
  prompt: string;
  style: string;
  generate: (prompt: string) => Promise<AgentAsset>;
  maxAttempts: number;
  kind: "image" | "video";
  critique: (asset: AgentAsset, currentPrompt: string) => Promise<CritiqueResult>;
}): Promise<{ bytes: Buffer; mediaUrl: string; baseMediaUrl?: string | null; attempts: AgentAttempt[]; finalScore: number }> {
  const attempts: AgentAttempt[] = [];
  let currentPrompt = args.prompt;
  let current = await args.generate(currentPrompt);
  let best: { score: number; asset: AgentAsset } | null = null;
  for (let i = 0; i < args.maxAttempts; i++) {
    const critique = await args.critique(current, currentPrompt);
    const accepted = critique.score >= threshold();
    attempts.push({ attempt: i + 1, score: critique.score, issues: critique.issues, revisedPrompt: critique.revisedPrompt, accepted });
    recordAttempt(args.runId, i + 1, args.kind, critique.score, critique.issues, critique.revisedPrompt, accepted);
    if (critique.score >= 0 && (!best || critique.score > best.score)) best = { score: critique.score, asset: current };
    if (critique.score === -1) break;
    if (accepted || i === args.maxAttempts - 1) break;
    currentPrompt = critique.revisedPrompt.slice(0, 1000);
    current = await args.generate(currentPrompt);
  }
  const finalAsset = best?.asset ?? current;
  return { bytes: finalAsset.bytes, mediaUrl: finalAsset.mediaUrl, baseMediaUrl: finalAsset.baseMediaUrl ?? null, attempts, finalScore: best?.score ?? -1 };
}

export async function runImageAgentLoop(args: {
  runId: string;
  prompt: string;
  style: string;
  generate: (prompt: string) => Promise<AgentAsset>;
  maxAttempts?: number;
}): Promise<{ bytes: Buffer; mediaUrl: string; baseMediaUrl?: string | null; attempts: AgentAttempt[]; finalScore: number }> {
  return runAgentLoop({ ...args, maxAttempts: args.maxAttempts ?? 3, kind: "image",
    critique: (asset, currentPrompt) => critiqueImage(asset.bytes, currentPrompt, args.style, args.runId) });
}

export async function runVideoAgentLoop(args: {
  runId: string;
  prompt: string;
  style: string;
  generate: (prompt: string) => Promise<AgentAsset>;
  maxAttempts?: number;
}): Promise<{ bytes: Buffer; mediaUrl: string; baseMediaUrl?: string | null; attempts: AgentAttempt[]; finalScore: number }> {
  return runAgentLoop({ ...args, maxAttempts: args.maxAttempts ?? 2, kind: "video",
    critique: (asset, currentPrompt) => critiqueVideoMultiFrame(asset.bytes, currentPrompt, args.style, args.runId) });
}

export function recordAttempt(runId: string, attempt: number, kind: string, score: number, issues: string[], revisedPrompt: string, accepted: boolean): void {
  try {
    db().prepare("INSERT INTO generation_attempts(id,run_id,attempt,kind,score,issues,revised_prompt,accepted,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), runId, attempt, kind, score, JSON.stringify(issues), revisedPrompt.slice(0, 2000), accepted ? 1 : 0, nowIso());
  } catch {
    // best effort
  }
}

export function dailyAgentCap(): number {
  const raw = Number(process.env.AGENT_DAILY_CAP ?? "50");
  return Number.isFinite(raw) ? Math.max(1, Math.round(raw)) : 50;
}

export function todayAgentCallCount(): number {
  try {
    const row = db().prepare("SELECT COUNT(*) n FROM ai_calls WHERE operation IN ('artwork','template_background','video','critique','style','ideogram') AND created_at >= ?").get(new Date().toISOString().slice(0, 10)) as { n: number };
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}
