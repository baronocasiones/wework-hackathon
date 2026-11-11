import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { db, nowIso } from "@/lib/db";
import { recordAiCall } from "@/lib/monitoring";
import { geminiText } from "@/lib/gemini";

export type CritiqueResult = { score: number; issues: string[]; revisedPrompt: string };

const critiqueSchema = z.object({
  score: z.coerce.number().int().min(0).max(100),
  issues: z.array(z.string()).default([]),
  revisedPrompt: z.string().min(1),
});

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

export async function critiqueImage(imageBytes: Buffer, originalPrompt: string, style: string, runId: string): Promise<CritiqueResult> {
  const model = visionModel();
  const started = Date.now();
  let outcome: "success" | "failed" = "failed";
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error("Gemini not configured.");
    const mime = imageBytes[0] === 0x89 && imageBytes[1] === 0x50 ? "image/png" : "image/jpeg";
    const base64 = imageBytes.toString("base64");
    const prompt = `You are a visual quality critic for social media images. Score the image 0-100 for visual appeal, brand fit, and text-readability readiness. Style target: ${style}. Original idea: ${originalPrompt.slice(0, 500)}.\n` +
      `Return ONLY a JSON object: {"score": number, "issues": string[], "revisedPrompt": string}. revisedPrompt should be an improved image-generation prompt addressing the issues, under 300 chars.`;
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
  } catch {
    recordAiCall({ runId, operation: "critique", model, durationMs: Date.now() - started, outcome });
    return { score: 100, issues: [], revisedPrompt: originalPrompt };
  }
}

export function extractFirstFrame(videoBytes: Buffer): Buffer | null {
  const result = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-i", "pipe:0", "-frames:v", "1", "-f", "image2", "pipe:1"], { input: videoBytes, maxBuffer: 50 * 1024 * 1024, encoding: "buffer" });
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) return null;
  return Buffer.from(result.stdout);
}

export async function critiqueVideoFrame(frameBytes: Buffer, originalPrompt: string, style: string, runId: string): Promise<CritiqueResult> {
  return critiqueImage(frameBytes, originalPrompt, style, runId);
}

export type AgentAttempt = { attempt: number; score: number; issues: string[]; revisedPrompt: string; accepted: boolean };

export async function runImageAgentLoop(args: {
  runId: string;
  prompt: string;
  style: string;
  generate: (prompt: string) => Promise<{ bytes: Buffer; mediaUrl: string }>;
  maxAttempts?: number;
}): Promise<{ bytes: Buffer; mediaUrl: string; attempts: AgentAttempt[]; finalScore: number }> {
  const maxAttempts = args.maxAttempts ?? 3;
  const attempts: AgentAttempt[] = [];
  let currentPrompt = args.prompt;
  let current = await args.generate(currentPrompt);
  for (let i = 0; i < maxAttempts; i++) {
    const critique = await critiqueImage(current.bytes, currentPrompt, args.style, args.runId);
    const accepted = critique.score >= threshold();
    attempts.push({ attempt: i + 1, score: critique.score, issues: critique.issues, revisedPrompt: critique.revisedPrompt, accepted });
    recordAttempt(args.runId, i + 1, "image", critique.score, critique.issues, critique.revisedPrompt, accepted);
    if (accepted || i === maxAttempts - 1) break;
    currentPrompt = critique.revisedPrompt.slice(0, 1000);
    current = await args.generate(currentPrompt);
  }
  return { bytes: current.bytes, mediaUrl: current.mediaUrl, attempts, finalScore: attempts[attempts.length - 1]?.score ?? 0 };
}

export async function runVideoAgentLoop(args: {
  runId: string;
  prompt: string;
  style: string;
  generate: (prompt: string) => Promise<{ bytes: Buffer; mediaUrl: string }>;
  maxAttempts?: number;
}): Promise<{ bytes: Buffer; mediaUrl: string; attempts: AgentAttempt[]; finalScore: number }> {
  const maxAttempts = args.maxAttempts ?? 2;
  const attempts: AgentAttempt[] = [];
  let currentPrompt = args.prompt;
  let current = await args.generate(currentPrompt);
  for (let i = 0; i < maxAttempts; i++) {
    const frame = extractFirstFrame(current.bytes);
    const critique = frame ? await critiqueVideoFrame(frame, currentPrompt, args.style, args.runId) : { score: 100, issues: [], revisedPrompt: currentPrompt };
    const accepted = critique.score >= threshold();
    attempts.push({ attempt: i + 1, score: critique.score, issues: critique.issues, revisedPrompt: critique.revisedPrompt, accepted });
    recordAttempt(args.runId, i + 1, "video", critique.score, critique.issues, critique.revisedPrompt, accepted);
    if (accepted || i === maxAttempts - 1) break;
    currentPrompt = critique.revisedPrompt.slice(0, 1000);
    current = await args.generate(currentPrompt);
  }
  return { bytes: current.bytes, mediaUrl: current.mediaUrl, attempts, finalScore: attempts[attempts.length - 1]?.score ?? 0 };
}

function recordAttempt(runId: string, attempt: number, kind: string, score: number, issues: string[], revisedPrompt: string, accepted: boolean): void {
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
    const row = db().prepare("SELECT COUNT(*) n FROM ai_calls WHERE operation IN ('artwork','template_background','video','critique','style') AND created_at >= ?").get(new Date().toISOString().slice(0, 10)) as { n: number };
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}