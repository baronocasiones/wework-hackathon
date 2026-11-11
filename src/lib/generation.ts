import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { wrapText } from "@/lib/domain";
import { recordAiCall } from "@/lib/monitoring";
import { uploadLocalFile } from "@/lib/media";
import { geminiCaption, geminiImage, geminiText, geminiVideo } from "@/lib/gemini";
import { cloudflareImage } from "@/lib/cloudflare";

type AiProvider = "gemini" | "openai";
type ImageProvider = AiProvider | "cloudflare";
type GeneratedImage = { bytes: Buffer; mimeType: string; provider: ImageProvider };

function providerOrder(): AiProvider[] {
  const preferred: AiProvider = process.env.AI_PROVIDER === "openai" ? "openai" : "gemini";
  const configured: AiProvider[] = [];
  if (process.env.GEMINI_API_KEY) configured.push("gemini");
  if (process.env.OPENAI_API_KEY) configured.push("openai");
  if (!configured.length) throw new Error("Add GEMINI_API_KEY or OPENAI_API_KEY to .env.local to generate AI content.");
  return configured.sort((left, right) => Number(right === preferred) - Number(left === preferred));
}

function imageProviderOrder(): ImageProvider[] {
  const providers: ImageProvider[] = [];
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) providers.push("cloudflare");
  if (process.env.GEMINI_API_KEY) providers.push("gemini");
  if (process.env.OPENAI_API_KEY) providers.push("openai");
  if (!providers.length) throw new Error("Add Cloudflare, Gemini, or OpenAI credentials to generate artwork.");
  if (!providers.includes("cloudflare") && process.env.AI_PROVIDER === "openai") providers.reverse();
  return providers;
}

type OpenAiResponse = {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: unknown;
  data?: Array<{ b64_json?: string }>;
};

function apiKey(): string {
  const value = process.env.OPENAI_API_KEY;
  if (!value) throw new Error("OpenAI is not configured. Add OPENAI_API_KEY to .env.local.");
  return value;
}

async function openAiCall(args: { endpoint: string; payload: unknown; runId: string; operation: string; model: string }): Promise<OpenAiResponse> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`https://api.openai.com/v1/${args.endpoint}`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" }, body: JSON.stringify(args.payload),
    });
  } catch (error) {
    recordAiCall({ runId: args.runId, operation: args.operation, model: args.model, durationMs: Date.now() - started, outcome: "failed" });
    throw error;
  }
  const raw = await response.text();
  let parsed: OpenAiResponse;
  try { parsed = JSON.parse(raw) as OpenAiResponse; } catch { parsed = {}; }
  recordAiCall({ runId: args.runId, operation: args.operation, model: args.model, responseUsage: parsed.usage, durationMs: Date.now() - started, outcome: response.ok ? "success" : "failed" });
  if (!response.ok) throw new Error(`OpenAI ${args.operation} failed with status ${response.status}.`);
  return parsed;
}

async function openAiText(prompt: string, runId: string, operation = "caption"): Promise<string> {
  const model = process.env.OPENAI_TEXT_MODEL ?? "gpt-6-luna";
  const response = await openAiCall({ endpoint: "responses", runId, operation, model,
    payload: { model, input: prompt } });
  const text = response.output_text ?? response.output?.flatMap((item) => item.content ?? []).find((part) => part.type === "output_text")?.text;
  if (!text?.trim()) throw new Error(`OpenAI returned no ${operation} text.`);
  return text.trim();
}

function openAiCaption(prompt: string, runId: string): Promise<string> {
  return openAiText(`Write a friendly, concise social caption with one clear call to action. Return only the caption.\n\n${prompt}`, runId);
}

export async function generateCaption(prompt: string, runId: string): Promise<string> {
  for (const provider of providerOrder()) {
    try { return provider === "gemini" ? await geminiCaption(prompt, runId) : await openAiCaption(prompt, runId); }
    catch { /* Try the next configured provider. Each attempt is recorded separately. */ }
  }
  throw new Error("Caption generation failed with every configured AI provider. Check the AI usage log and model access.");
}

const copySchema = z.object({ title: z.string().trim().min(1), caption: z.string().trim().min(1), subtitle: z.string().trim().min(1) });
export type ContentCopy = z.infer<typeof copySchema>;
type CopyRequest = { kind: "image" | "video"; context: string; title?: string; caption?: string; subtitle?: string };

function parseSuggestedCopy(text: string): ContentCopy {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI returned copy in an unexpected format.");
  const parsed = copySchema.parse(JSON.parse(text.slice(first, last + 1)));
  return { title: parsed.title.slice(0, 120), caption: parsed.caption.slice(0, 2200), subtitle: parsed.subtitle.slice(0, 100) };
}

export async function recommendCopy(args: CopyRequest, runId = randomUUID()): Promise<{ runId: string; copy: ContentCopy }> {
  const provided = {
    title: args.title?.trim().slice(0, 120) ?? "",
    caption: args.caption?.trim().slice(0, 2200) ?? "",
    subtitle: args.subtitle?.trim().slice(0, 100) ?? "",
  };
  if (provided.title && provided.caption && provided.subtitle) return { runId, copy: provided };

  let suggestion: ContentCopy | undefined;
  if (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY) {
    const prompt = `Suggest social post copy for a ${args.kind} about: ${args.context.slice(0, 1000)}.\n` +
      `Existing title: ${provided.title || "(blank)"}\nExisting caption: ${provided.caption || "(blank)"}\n` +
      `Existing subtitle: ${provided.subtitle || "(blank)"}\n` +
      "Return only a JSON object with nonempty title, caption, and subtitle strings. Make the title specific and under 70 characters. " +
      "Make the caption friendly with one call to action and under 500 characters. Make the subtitle a short on-media line under 100 characters. " +
      "Do not invent prices, discounts, or product claims that the context does not support.";
    for (const provider of providerOrder()) {
      try {
        const text = provider === "gemini" ? await geminiText(prompt, runId, "copy") : await openAiText(prompt, runId, "copy");
        suggestion = parseSuggestedCopy(text);
        break;
      } catch { /* Try the next configured provider; each provider attempt is recorded. */ }
    }
  }

  const topic = args.context.trim().replace(/\.[^.\s]{2,5}$/, "").slice(0, 70);
  const title = provided.title || suggestion?.title || topic || (args.kind === "video" ? "New video" : "New pubmat");
  return { runId, copy: {
    title,
    caption: provided.caption || suggestion?.caption || `Take a look at ${title}. Find out more through the link.`,
    subtitle: provided.subtitle || suggestion?.subtitle || "Discover what's new.",
  } };
}

async function openAiArtwork(prompt: string, runId: string): Promise<Buffer> {
  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.6-flare";
  const response = await openAiCall({ endpoint: "images/generations", runId, operation: "artwork", model,
    payload: { model, prompt, size: "1024x1536", quality: "medium", output_format: "png" } });
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI returned no image data.");
  return Buffer.from(encoded, "base64");
}

async function imageFromProvider(provider: ImageProvider, prompt: string, runId: string): Promise<GeneratedImage> {
  if (provider === "cloudflare") return { ...await cloudflareImage(prompt, runId), provider };
  if (provider === "gemini") {
    const result = await geminiImage(prompt, runId);
    return { ...result, provider };
  }
  return { bytes: await openAiArtwork(prompt, runId), mimeType: "image/png", provider };
}

async function generateArtwork(prompt: string, runId: string): Promise<GeneratedImage> {
  const providers = imageProviderOrder();
  let failure: unknown;
  for (const provider of providers) {
    try { return await imageFromProvider(provider, prompt, runId); }
    catch (error) { failure = error; }
  }
  if (providers.length === 1 && failure instanceof Error) throw failure;
  throw new Error("Artwork generation failed with every configured AI provider. Check the AI usage log and model access.");
}

async function storeArtwork(image: GeneratedImage): Promise<string> {
  const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  await mkdir(directory, { recursive: true });
  const localPath = path.join(directory, `${randomUUID()}.${image.mimeType === "image/jpeg" ? "jpg" : "png"}`);
  await writeFile(localPath, image.bytes);
  const normalized = path.join(directory, `${randomUUID()}-portrait.png`);
  await runFfmpeg(["-y", "-i", localPath, "-vf", "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350", "-frames:v", "1", normalized]);
  return uploadLocalFile(normalized, "image");
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${String(code)}.`)));
  });
}

async function renderVideo(image: GeneratedImage, subtitle: string): Promise<string> {
  const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  await mkdir(directory, { recursive: true });
  const id = randomUUID();
  const imagePath = path.join(directory, `${id}.png`);
  const textPath = path.join(directory, `${id}.txt`);
  const videoPath = path.join(directory, `${id}.mp4`);
  await writeFile(imagePath, image.bytes);
  await writeFile(textPath, wrapText(subtitle.replace(/[\r\n]+/g, " ").slice(0, 100), 24, 6));
  await runFfmpeg(["-y", "-loop", "1", "-i", imagePath, "-t", "15", "-vf",
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,drawbox=x=0:y=1450:w=1080:h=470:color=black@0.48:t=fill,drawtext=textfile=" + textPath + ":fontcolor=white:fontsize=54:line_spacing=8:x=(w-text_w)/2:y=1480:alpha='if(lt(t,1),t,if(gt(t,13),(15-t)/2,1))':box=0:enable='between(t,0,15)',format=yuv420p,fps=30",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoPath]);
  const publicUrl = await uploadLocalFile(videoPath, "video");
  return publicUrl;
}

type VideoPlan =
  | { kind: "native"; bytes: Buffer; source: "gemini_native_video" }
  | { kind: "rendered"; image: GeneratedImage; source: "cloudflare_rendered_video" | "gemini_rendered_video" | "openai_rendered_video" };

async function generateVideoPlan(prompt: string, runId: string): Promise<VideoPlan> {
  if (process.env.GEMINI_API_KEY && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    try {
      const video = await geminiVideo(prompt, runId);
      return { kind: "native", bytes: video.bytes, source: "gemini_native_video" };
    } catch { /* Render from artwork when native video is unavailable. */ }
  }
  for (const provider of imageProviderOrder()) {
    try {
      const image = await imageFromProvider(provider, prompt, runId);
      return { kind: "rendered", image, source: `${provider}_rendered_video` };
    } catch { continue; }
  }
  throw new Error("Video generation failed with every configured AI provider. Check the AI usage log and model access.");
}

async function storeNativeVideo(bytes: Buffer): Promise<string> {
  const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  await mkdir(directory, { recursive: true });
  const videoPath = path.join(directory, `${randomUUID()}.mp4`);
  await writeFile(videoPath, bytes);
  return uploadLocalFile(videoPath, "video");
}

export async function createGeneratedAsset(args: { kind: "template" | "artwork" | "video"; prompt: string; title?: string; caption?: string; subtitle?: string }): Promise<{ runId: string; title: string; kind: "image" | "video"; source: string; mediaUrl: string; caption: string; subtitle: string; templateHeadline?: string; templateBody?: string }> {
  const runId = randomUUID();
  const { copy } = await recommendCopy({ kind: args.kind === "video" ? "video" : "image", context: args.prompt,
    title: args.title, caption: args.caption, subtitle: args.subtitle }, runId);
  const { title, caption, subtitle } = copy;
  const isTemplate = args.kind === "template";
  let mediaUrl: string;
  let source = "template";
  if (isTemplate) {
    const localPath = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads", `${runId}.png`);
    await mkdir(path.dirname(localPath), { recursive: true });
    const textPath = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads", `${runId}.txt`);
    const headlinePath = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads", `${runId}-headline.txt`);
    await writeFile(headlinePath, wrapText(title.replace(/[\r\n]+/g, " ").slice(0, 70), 25, 3));
    await writeFile(textPath, wrapText(subtitle.replace(/[\r\n]+/g, " ").slice(0, 100), 45, 3));
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=0xDCEBE2:s=1080x1350:d=1", "-vf",
      "drawbox=x=60:y=790:w=960:h=500:color=0x1C3B33:t=fill,drawtext=textfile=" + headlinePath + ":fontcolor=white:fontsize=50:line_spacing=4:x=115:y=835,drawtext=textfile=" + textPath + ":fontcolor=0xD9E9DF:fontsize=30:line_spacing=4:x=115:y=1015,drawtext=text='SHOP THE DROP':fontcolor=0xF2B46E:fontsize=32:x=115:y=1175",
      "-frames:v", "1", localPath]);
    mediaUrl = await uploadLocalFile(localPath, "image");
  } else if (args.kind === "artwork") {
    const artwork = await generateArtwork(args.prompt, runId);
    mediaUrl = await storeArtwork(artwork);
    source = `${artwork.provider}_artwork`;
  } else {
    const plan = await generateVideoPlan(args.prompt, runId);
    mediaUrl = plan.kind === "native" ? await storeNativeVideo(plan.bytes) : await renderVideo(plan.image, subtitle);
    source = plan.source;
  }
  return { runId, title, kind: args.kind === "video" ? "video" : "image", source, mediaUrl, caption, subtitle,
    ...(isTemplate ? { templateHeadline: title, templateBody: subtitle } : {}) };
}
