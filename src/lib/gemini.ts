import { z } from "zod";
import { recordAiCall } from "@/lib/monitoring";

const API = "https://generativelanguage.googleapis.com";
const REQUEST_TIMEOUT_MS = 60_000;

const count = z.number().int().nonnegative().optional();
const usageSchema = z.object({
  promptTokenCount: count,
  candidatesTokenCount: count,
  totalTokenCount: count,
  total_input_tokens: count,
  total_output_tokens: count,
  total_tokens: count,
}).passthrough().optional();
const partSchema = z.object({
  text: z.string().optional(),
}).passthrough();
const contentResponseSchema = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(partSchema) }) })).optional(),
  usageMetadata: usageSchema,
}).passthrough();

type NormalizedUsage = { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null };

function normalizeUsage(raw: z.infer<typeof usageSchema>): NormalizedUsage | undefined {
  if (!raw) return undefined;
  return {
    input_tokens: raw.promptTokenCount ?? raw.total_input_tokens ?? null,
    output_tokens: raw.candidatesTokenCount ?? raw.total_output_tokens ?? null,
    total_tokens: raw.totalTokenCount ?? raw.total_tokens ?? null,
  };
}

function key(): string {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) throw new Error("Gemini is not configured. Add GEMINI_API_KEY to .env.local.");
  return value;
}

function textModel(): string {
  return process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-3.5-flash-lite";
}

async function requestJson(url: string, apiKey: string, init: RequestInit, operation: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`Gemini ${operation} could not reach the API.`);
  }
  if (!response.ok) {
    throw new Error(`Gemini ${operation} failed with status ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`Gemini ${operation} returned an invalid response.`);
  }
}

async function recorded<T>(args: {
  runId: string; operation: string; model: string;
  execute: (setUsage: (usage: NormalizedUsage | undefined) => void) => Promise<T>;
}): Promise<T> {
  const started = Date.now();
  let usage: NormalizedUsage | undefined;
  let outcome: "success" | "failed" = "failed";
  try {
    const result = await args.execute((value) => { usage = value; });
    outcome = "success";
    return result;
  } finally {
    recordAiCall({ runId: args.runId, operation: args.operation, model: args.model,
      responseUsage: usage, durationMs: Date.now() - started, outcome });
  }
}

function parseContent(raw: unknown, operation: string): z.infer<typeof contentResponseSchema> {
  const parsed = contentResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Gemini ${operation} returned an invalid response.`);
  return parsed.data;
}

export async function geminiText(prompt: string, runId: string, operation = "caption"): Promise<string> {
  const chosenModel = textModel();
  return recorded({ runId, operation, model: chosenModel, execute: async (setUsage) => {
    const apiKey = key();
    const raw = await requestJson(`${API}/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`, apiKey, {
      method: "POST",
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
    }, operation);
    const response = parseContent(raw, operation);
    setUsage(normalizeUsage(response.usageMetadata));
    const text = response.candidates?.flatMap((candidate) => candidate.content.parts).map((part) => part.text ?? "").join("").trim();
    if (!text) throw new Error(`Gemini returned no ${operation} text.`);
    return text;
  } });
}

export function geminiCaption(prompt: string, runId: string): Promise<string> {
  return geminiText(`Write a friendly, concise social caption with one clear call to action. Return only the caption.\n\n${prompt}`, runId)
    .then((text) => text.slice(0, 2200));
}
