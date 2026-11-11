import { z } from "zod";
import { recordAiCall } from "@/lib/monitoring";

const API = "https://generativelanguage.googleapis.com";
const VIDEO_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 60_000;
const POLL_MS = 2_000;

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
  inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
}).passthrough();
const contentResponseSchema = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(partSchema) }) })).optional(),
  usageMetadata: usageSchema,
}).passthrough();
const videoContentSchema = z.object({
  type: z.string().optional(),
  mime_type: z.string().optional(),
  data: z.string().optional(),
  uri: z.string().optional(),
}).passthrough();
const interactionSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  steps: z.array(z.object({ type: z.string().optional(), content: z.array(videoContentSchema).optional() })).optional(),
  usage: usageSchema,
}).passthrough();
const fileSchema = z.object({ state: z.string().optional() }).passthrough();

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

function model(name: "TEXT" | "IMAGE" | "VIDEO"): string {
  const defaults = { TEXT: "gemini-3.5-flash-lite", IMAGE: "gemini-3.1-flash-image", VIDEO: "gemini-omni-1.1-flash" };
  return process.env[`GEMINI_${name}_MODEL`]?.trim() || defaults[name];
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
  if (!response.ok) throw new Error(`Gemini ${operation} failed with status ${response.status}.`);
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

function parseInteraction(raw: unknown): z.infer<typeof interactionSchema> {
  const parsed = interactionSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Gemini video returned an invalid response.");
  return parsed.data;
}

function decodeBase64(data: string, operation: string): Buffer {
  const clean = data.replace(/\s/g, "");
  if (!clean || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)) {
    throw new Error(`Gemini ${operation} returned invalid media data.`);
  }
  return Buffer.from(clean, "base64");
}

export async function geminiText(prompt: string, runId: string, operation = "caption"): Promise<string> {
  const chosenModel = model("TEXT");
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

export async function geminiImage(prompt: string, runId: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const chosenModel = model("IMAGE");
  return recorded({ runId, operation: "artwork", model: chosenModel, execute: async (setUsage) => {
    const apiKey = key();
    const raw = await requestJson(`${API}/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`, apiKey, {
      method: "POST",
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "4:5" } } }),
    }, "artwork");
    const response = parseContent(raw, "artwork");
    setUsage(normalizeUsage(response.usageMetadata));
    const image = response.candidates?.flatMap((candidate) => candidate.content.parts)
      .find((part) => part.inlineData?.mimeType.startsWith("image/"))?.inlineData;
    if (!image) throw new Error("Gemini returned no image data.");
    return { bytes: decodeBase64(image.data, "artwork"), mimeType: image.mimeType };
  } });
}

function videoOutput(interaction: z.infer<typeof interactionSchema>): z.infer<typeof videoContentSchema> | undefined {
  return interaction.steps?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .find((content) => content.type === "video" && (!content.mime_type || content.mime_type === "video/mp4"));
}

function fileId(uri: string): string {
  let url: URL;
  try { url = new URL(uri); } catch { throw new Error("Gemini video returned an invalid file URI."); }
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com") {
    throw new Error("Gemini video returned an invalid file URI.");
  }
  const match = /^\/v1beta\/files\/([A-Za-z0-9_-]+)(?::download)?$/.exec(url.pathname);
  if (!match) throw new Error("Gemini video returned an invalid file URI.");
  return match[1];
}

async function downloadVideo(id: string, apiKey: string): Promise<Buffer> {
  let url = new URL(`${API}/v1beta/files/${id}:download?alt=media`);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const isApi = url.hostname === "generativelanguage.googleapis.com";
    const googleHost = isApi || url.hostname === "storage.googleapis.com" || url.hostname.endsWith(".googleusercontent.com");
    if (url.protocol !== "https:" || !googleHost) throw new Error("Gemini video returned an unsafe download URL.");
    let response: Response;
    try {
      response = await fetch(url, { headers: isApi ? { "x-goog-api-key": apiKey } : {},
        redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new Error("Gemini video download failed.");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Gemini video download failed.");
      try { url = new URL(location, url); }
      catch { throw new Error("Gemini video returned an unsafe download URL."); }
      continue;
    }
    if (!response.ok) throw new Error(`Gemini video download failed with status ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("Gemini returned an empty video.");
    return bytes;
  }
  throw new Error("Gemini video download redirected too many times.");
}

async function retrieveVideo(uri: string, apiKey: string, deadline: number): Promise<Buffer> {
  const id = fileId(uri);
  while (Date.now() < deadline) {
    const raw = await requestJson(`${API}/v1beta/files/${id}`, apiKey, { method: "GET" }, "video status", Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Gemini video status was invalid.");
    if (parsed.data.state === "ACTIVE") return downloadVideo(id, apiKey);
    if (parsed.data.state === "FAILED") throw new Error("Gemini video processing failed.");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("Gemini video processing timed out.");
}

export async function geminiVideo(prompt: string, runId: string): Promise<{ bytes: Buffer; mimeType: "video/mp4" }> {
  const chosenModel = model("VIDEO");
  return recorded({ runId, operation: "video", model: chosenModel, execute: async (setUsage) => {
    const apiKey = key();
    const deadline = Date.now() + VIDEO_TIMEOUT_MS;
    const raw = await requestJson(`${API}/v1beta/interactions`, apiKey, {
      method: "POST",
      body: JSON.stringify({ model: chosenModel, input: prompt,
        response_format: { type: "video", aspect_ratio: "9:16", delivery: "uri" } }),
    }, "video", VIDEO_TIMEOUT_MS);
    let interaction = parseInteraction(raw);
    setUsage(normalizeUsage(interaction.usage));
    while (interaction.status === "in_progress" && Date.now() < deadline) {
      if (!interaction.id || !/^[A-Za-z0-9_-]+$/.test(interaction.id)) throw new Error("Gemini video returned an invalid interaction ID.");
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const next = await requestJson(`${API}/v1beta/interactions/${interaction.id}`, apiKey, { method: "GET" }, "video status", Math.min(REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())));
      interaction = parseInteraction(next);
      if (interaction.usage) setUsage(normalizeUsage(interaction.usage));
    }
    if (interaction.status === "in_progress") throw new Error("Gemini video generation timed out.");
    if (interaction.status !== "completed") throw new Error("Gemini video generation failed.");
    const output = videoOutput(interaction);
    if (!output) throw new Error("Gemini returned no video data.");
    const bytes = output.data ? decodeBase64(output.data, "video") : output.uri ? await retrieveVideo(output.uri, apiKey, deadline) : undefined;
    if (!bytes?.length) throw new Error("Gemini returned no video data.");
    return { bytes, mimeType: "video/mp4" };
  } });
}
