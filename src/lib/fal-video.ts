import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { recordAiCall } from "@/lib/monitoring";

const MODEL = "xai/grok-imagine-video/v1.5/lite/text-to-video";
const QUEUE_URL = `https://queue.fal.run/${MODEL}`;
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 240_000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const settingsSchema = z.object({
  duration: z.coerce.number().int().min(1).max(15),
  resolution: z.enum(["480p", "720p", "1080p"]),
});
const submittedSchema = z.object({
  request_id: z.string().min(1),
  status_url: z.string().url(),
  response_url: z.string().url(),
});
const statusSchema = z.object({
  status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]),
  error: z.string().nullish(),
});
const resultSchema = z.object({ video: z.object({ url: z.string().url() }) });

function settings(): z.infer<typeof settingsSchema> {
  const result = settingsSchema.safeParse({
    duration: process.env.FAL_VIDEO_DURATION || "5",
    resolution: process.env.FAL_VIDEO_RESOLUTION || "720p",
  });
  if (!result.success) throw new Error("Set FAL_VIDEO_DURATION (1–15) and FAL_VIDEO_RESOLUTION to supported values.");
  return result.data;
}

export function falVideoReady(): boolean {
  return Boolean(process.env.FAL_KEY?.trim());
}

export function assertFalVideoReady(): void {
  if (!falVideoReady()) throw new Error("Add FAL_KEY to .env or .env.local to enable billed fal text-to-video generation.");
  settings();
}

function queueUrl(address: string): string {
  const url = new URL(address);
  if (url.protocol !== "https:" || url.hostname !== "queue.fal.run" || !url.pathname.startsWith("/xai/grok-imagine-video/")
    || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("fal returned an invalid queue URL.");
  }
  return url.href;
}

async function requestJson(address: string, key: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(address, {
      ...init,
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch { throw new Error("fal video API could not be reached."); }
  if (!response.ok) {
    if (response.status === 402) throw new Error("fal API credits are required. The free sandbox allowance does not cover text-to-video API calls.");
    if (response.status === 403) {
      const body: unknown = await response.json().catch(() => null);
      const detail = body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : "";
      if (/exhausted balance|out of credits|insufficient credits/i.test(detail)) {
        throw new Error("fal account balance is exhausted. Add credits in fal billing before generating video.");
      }
      throw new Error("fal rejected the API key or model access.");
    }
    if (response.status === 401) throw new Error("fal rejected the API key or model access.");
    throw new Error(`fal video API returned status ${response.status}.`);
  }
  try { return await response.json(); }
  catch { throw new Error("fal video API returned an invalid response."); }
}

async function downloadVideo(address: string): Promise<Buffer> {
  const url = new URL(address);
  if (url.protocol !== "https:" || (url.hostname !== "fal.media" && !url.hostname.endsWith(".fal.media"))
    || url.username || url.password || url.port) {
    throw new Error("fal video returned an invalid media URL.");
  }
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(90_000), redirect: "error" }); }
  catch { throw new Error("fal video download failed."); }
  if (!response.ok || !response.body) throw new Error(`fal video download returned status ${response.status}.`);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_VIDEO_BYTES) throw new Error("fal video exceeds the 200 MB upload limit.");
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("fal video returned an invalid MP4.");
  return bytes;
}

export async function falVideo(prompt: string, runId: string): Promise<{ bytes: Buffer; mimeType: "video/mp4" }> {
  assertFalVideoReady();
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("Add FAL_KEY to .env or .env.local to enable billed fal text-to-video generation.");
  const config = settings();
  const started = Date.now();
  let outcome: "success" | "failed" = "failed";
  try {
    const rawSubmit = await requestJson(QUEUE_URL, key, { method: "POST", body: JSON.stringify({
      prompt, duration: config.duration, aspect_ratio: "9:16", resolution: config.resolution,
    }) });
    const submitted = submittedSchema.safeParse(rawSubmit);
    if (!submitted.success) throw new Error("fal video API returned no queue request details.");
    const statusUrl = queueUrl(submitted.data.status_url);
    const responseUrl = queueUrl(submitted.data.response_url);
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      const rawStatus = await requestJson(statusUrl, key);
      const status = statusSchema.safeParse(rawStatus);
      if (!status.success) throw new Error("fal video API returned an unknown queue status.");
      if (status.data.error) throw new Error("fal video generation failed. Check the request in fal dashboard.");
      if (status.data.status === "COMPLETED") {
        const rawResult = await requestJson(responseUrl, key);
        const result = resultSchema.safeParse(rawResult);
        if (!result.success) throw new Error("fal video API returned no video.");
        const bytes = await downloadVideo(result.data.video.url);
        outcome = "success";
        return { bytes, mimeType: "video/mp4" };
      }
      await setTimeout(POLL_INTERVAL_MS);
    }
    throw new Error(`fal video is still processing (request ${submitted.data.request_id}). Check fal dashboard before starting another billed generation.`);
  } finally {
    recordAiCall({ runId, operation: "video", model: MODEL, durationMs: Date.now() - started, outcome });
  }
}
