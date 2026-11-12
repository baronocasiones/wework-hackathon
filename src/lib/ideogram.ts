import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { recordAiCall } from "@/lib/monitoring";
import { uploadLocalFile } from "@/lib/media";
import type { StylePreset } from "@/lib/styles";

const MODEL = "fal-ai/ideogram/v3";
const RUN_URL = "https://fal.run/fal-ai/ideogram/v3";
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_SCENE_CHARS = 1000;
const MAX_WIRE_CHARS = 2000;
const REQUEST_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;

export type Format = "image" | "video";
export type PosterCopy = { headline: string; body: string; cta: string };
export type GeneratePosterOptions = {
  runId: string;
  scene: string;
  copy: PosterCopy;
  style: StylePreset;
  format: Format;
  durationSeconds?: number;
};
export type PosterAsset = {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "video/mp4";
  mediaUrl: string;
  baseFileName: string | null;
  posterPrompt: string;
};

const responseSchema = z.object({
  images: z.array(z.object({ url: z.string().url() })).min(1),
});

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${String(code)}.`))));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeInline(value: string): string {
  return collapseSpaces(value.replace(/"/g, "'")).slice(0, 400);
}

export function ideogramConfigured(): boolean {
  return Boolean(process.env.FAL_KEY?.trim());
}

export function artworkTextMode(): "ideogram" | "overlay" {
  const raw = (process.env.ARTWORK_TEXT_MODE ?? "ideogram").trim().toLowerCase();
  return raw === "overlay" ? "overlay" : "ideogram";
}

export function renderingSpeed(): "TURBO" | "BALANCED" | "QUALITY" {
  const raw = (process.env.FAL_IDEOGRAM_SPEED ?? "BALANCED").trim().toUpperCase();
  if (raw === "TURBO" || raw === "BALANCED" || raw === "QUALITY") return raw;
  throw new Error("Set FAL_IDEOGRAM_SPEED to TURBO, BALANCED, or QUALITY.");
}

export function kenBurnsDuration(): number {
  const raw = Number(process.env.FAL_VIDEO_DURATION ?? "5");
  const rounded = Number.isFinite(raw) ? Math.round(raw) : 5;
  return Math.min(15, Math.max(1, rounded));
}

export function buildPosterScene(prompt: string, style: StylePreset): string {
  return collapseSpaces(`${prompt.trim()}. ${style.promptSuffix}`).slice(0, 1000);
}

export function sanitizeScene(scene: string, copy: PosterCopy): string {
  let result = collapseSpaces(scene);
  for (const line of [copy.headline, copy.body, copy.cta]) {
    const normalized = collapseSpaces(line);
    if (!normalized) continue;
    const pattern = normalized.split(" ").map(escapeRegExp).join("\\s+");
    result = result.replace(new RegExp(pattern, "gi"), " ");
  }
  return collapseSpaces(result).slice(0, MAX_SCENE_CHARS);
}

export function buildGrokInstruction(scene: string, styleSuffix: string): string {
  const clean = collapseSpaces(scene).slice(0, MAX_SCENE_CHARS) || "A promotional social video";
  const suffix = collapseSpaces(styleSuffix);
  return `${clean}. ${suffix}. Design a short promotional clip for this product. Include at least one line of readable on-screen promotional text — choose the wording yourself to fit the scene; do not wait for or copy any specific wording. Lettering should feel designed and integrated into the shot, not pasted on top.`;
}

export function buildIdeogramPrompt(scene: string, copy: PosterCopy, styleSuffix: string): string {
  const directives = `The following text lines are rendered EXACTLY as written, character for character. Do not paraphrase, translate, re-space, respell, or omit them. No other words appear anywhere in the image — no signage, labels, bag prints, packaging text, or watermarks; the only text visible is the three quoted lines.`;
  const block = `${directives} Headline: "${sanitizeInline(copy.headline)}". Supporting line: "${sanitizeInline(copy.body)}". Call to action: "${sanitizeInline(copy.cta)}". Every line appears letter-for-letter as quoted.`;
  const suffix = collapseSpaces(styleSuffix);
  const tail = `${suffix} ${block}`;
  const headroom = MAX_WIRE_CHARS - tail.length - 2;
  const cleanScene = sanitizeScene(scene, copy).slice(0, Math.max(0, headroom));
  return `${cleanScene}. ${tail}`.trim();
}

function falMediaUrl(address: string): string {
  const url = new URL(address);
  const host = url.hostname.toLowerCase();
  const isFalMedia = host === "fal.media" || host.endsWith(".fal.media");
  if (url.protocol !== "https:" || !isFalMedia || url.username || url.password || url.port) {
    throw new Error("fal returned an invalid media URL.");
  }
  return url.href;
}

async function downloadImage(address: string): Promise<{ bytes: Buffer; mimeType: "image/png" | "image/jpeg" }> {
  const url = falMediaUrl(address);
  const key = process.env.FAL_KEY?.trim();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: key ? { Authorization: `Key ${key}` } : undefined,
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: "error",
    });
  } catch { throw new Error("fal image download failed."); }
  if (!response.ok) throw new Error(`fal image download returned status ${response.status}.`);
  if (!response.body) throw new Error("fal image download returned no body.");
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) throw new Error("fal image exceeds the upload limit.");
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if (!isPng && !isJpeg) throw new Error("fal returned an invalid image.");
  return { bytes, mimeType: isPng ? "image/png" : "image/jpeg" };
}

async function requestIdeogram(prompt: string, runId: string): Promise<{ bytes: Buffer; mimeType: "image/png" | "image/jpeg" }> {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("Add FAL_KEY to enable Ideogram poster generation.");
  const started = Date.now();
  let outcome: "success" | "failed" = "failed";
  try {
    const response = await fetch(RUN_URL, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt.slice(0, MAX_WIRE_CHARS),
        negative_prompt: "extra words, signage, labels, bag print, packaging text, watermark, logo, typography beyond the quoted lines",
        image_size: "portrait_4_3",
        style: "DESIGN",
        rendering_speed: renderingSpeed(),
        expand_prompt: false,
        num_images: 1,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 402) throw new Error("fal balance is exhausted. Add credits before generating poster art.");
      if (response.status === 401 || response.status === 403) throw new Error("fal rejected the key or model access. Check billing and model permissions.");
      throw new Error(`fal Ideogram returned status ${response.status}.`);
    }
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new Error("fal Ideogram returned no image.");
    const downloaded = await downloadImage(parsed.data.images[0].url);
    outcome = "success";
    return downloaded;
  } finally {
    recordAiCall({ runId, operation: "ideogram", model: MODEL, durationMs: Date.now() - started, outcome });
  }
}

function uploadsDirectory(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
}

async function cropToSocial(bytes: Buffer, mimeType: "image/png" | "image/jpeg", targetPath: string): Promise<void> {
  const directory = path.dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const sourcePath = path.join(directory, `${randomUUID()}-poster-source.${ext}`);
  await writeFile(sourcePath, bytes);
  await runFfmpeg(["-y", "-i", sourcePath, "-vf", "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350", "-frames:v", "1", targetPath]);
}

export async function kenBurnsVideo(stillPath: string, outPath: string, opts: { durationSeconds: number; audioTrack?: string | null }): Promise<void> {
  const duration = Math.min(15, Math.max(1, Math.round(opts.durationSeconds) || 5));
  const fps = 30;
  const frames = duration * fps;
  const zoomTo = 1.1;
  const easing = `min(zoom+${((zoomTo - 1) / frames).toFixed(6)},${zoomTo})`;
  const filter = `scale=1296:1620,zoompan=z='${easing}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1350:fps=${fps}`;
  const directory = path.dirname(outPath);
  await mkdir(directory, { recursive: true });
  const track = opts.audioTrack?.trim();
  const args = track
    ? ["-y", "-i", stillPath, "-stream_loop", "-1", "-i", track, "-vf", filter, "-map", "0:v", "-map", "1:a",
       "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", outPath]
    : ["-y", "-i", stillPath, "-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=44100:cl=stereo",
       "-vf", filter, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23",
       "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", outPath];
  await runFfmpeg(args);
}

export async function ambientAudioFile(): Promise<string | null> {
  const raw = process.env.FAL_VIDEO_AUDIO_TRACK?.trim();
  if (!raw) return null;
  try {
    const info = await readFile(path.resolve(raw));
    return info.byteLength > 0 ? path.resolve(raw) : null;
  } catch {
    return null;
  }
}

export async function generatePosterAsset(opts: GeneratePosterOptions): Promise<PosterAsset> {
  const { runId, scene, copy, style, format } = opts;
  const prompt = buildIdeogramPrompt(scene, copy, style.promptSuffix);
  const image = await requestIdeogram(prompt, runId);
  const directory = uploadsDirectory();
  await mkdir(directory, { recursive: true });
  if (format === "image") {
    const targetPath = path.join(directory, `${runId}-poster.png`);
    await cropToSocial(image.bytes, image.mimeType, targetPath);
    const bytes = await readFile(targetPath);
    const mediaUrl = await uploadLocalFile(targetPath, "image");
    return { bytes, mimeType: "image/png", mediaUrl, baseFileName: `${runId}-poster.png`, posterPrompt: scene };
  }
  const stillPath = path.join(directory, `${runId}-poster-still.png`);
  await cropToSocial(image.bytes, image.mimeType, stillPath);
  const outPath = path.join(directory, `${runId}-poster.mp4`);
  await kenBurnsVideo(stillPath, outPath, { durationSeconds: opts.durationSeconds ?? kenBurnsDuration(), audioTrack: await ambientAudioFile() });
  const bytes = await readFile(outPath);
  const mediaUrl = await uploadLocalFile(outPath, "video");
  return { bytes, mimeType: "video/mp4", mediaUrl, baseFileName: `${runId}-poster-still.png`, posterPrompt: scene };
}
