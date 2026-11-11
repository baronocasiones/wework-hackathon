import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { wrapText } from "@/lib/domain";
import { recordAiCall } from "@/lib/monitoring";
import { uploadLocalFile } from "@/lib/media";

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

export async function generateCaption(prompt: string, runId: string): Promise<string> {
  const model = process.env.OPENAI_TEXT_MODEL ?? "gpt-6-luna";
  const response = await openAiCall({ endpoint: "responses", runId, operation: "caption", model,
    payload: { model, input: `Write a friendly, concise social caption with one clear call to action. Return only the caption.\n\n${prompt}` } });
  const text = response.output_text ?? response.output?.flatMap((item) => item.content ?? []).find((part) => part.type === "output_text")?.text;
  if (!text?.trim()) throw new Error("OpenAI returned no caption text.");
  return text.trim().slice(0, 2200);
}

async function generateArtwork(prompt: string, runId: string): Promise<string> {
  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.6-flare";
  const response = await openAiCall({ endpoint: "images/generations", runId, operation: "artwork", model,
    payload: { model, prompt, size: "1024x1536", quality: "medium", output_format: "png" } });
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI returned no image data.");
  const bytes = Buffer.from(encoded, "base64");
  const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  await mkdir(directory, { recursive: true });
  const localPath = path.join(directory, `${randomUUID()}.png`);
  await writeFile(localPath, bytes);
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

async function renderVideo(imageUrl: string, caption: string, runId: string): Promise<string> {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error("Could not download generated artwork for video rendering.");
  const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  await mkdir(directory, { recursive: true });
  const id = randomUUID();
  const imagePath = path.join(directory, `${id}.png`);
  const textPath = path.join(directory, `${id}.txt`);
  const videoPath = path.join(directory, `${id}.mp4`);
  await writeFile(imagePath, Buffer.from(await imageResponse.arrayBuffer()));
  await writeFile(textPath, wrapText(caption.replace(/[\r\n]+/g, " ").slice(0, 180), 24, 6));
  await runFfmpeg(["-y", "-loop", "1", "-i", imagePath, "-t", "15", "-vf",
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,drawbox=x=0:y=1450:w=1080:h=470:color=black@0.48:t=fill,drawtext=textfile=" + textPath + ":fontcolor=white:fontsize=54:line_spacing=8:x=(w-text_w)/2:y=1480:alpha='if(lt(t,1),t,if(gt(t,13),(15-t)/2,1))':box=0:enable='between(t,0,15)',format=yuv420p,fps=30",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoPath]);
  const publicUrl = await uploadLocalFile(videoPath, "video");
  return publicUrl;
}

export async function createGeneratedAsset(args: { kind: "template" | "artwork" | "video"; prompt: string; headline?: string; body?: string }): Promise<{ runId: string; title: string; kind: "image" | "video"; source: string; mediaUrl: string; caption: string; templateHeadline?: string; templateBody?: string }> {
  const runId = randomUUID();
  const caption = args.kind === "template" ? args.prompt.trim().slice(0, 2200) : await generateCaption(args.prompt, runId);
  const isTemplate = args.kind === "template";
  let mediaUrl: string;
  if (isTemplate) {
    const safeCaption = caption.replace(/[<>&"']/g, " ").slice(0, 130);
    const localPath = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads", `${runId}.png`);
    await mkdir(path.dirname(localPath), { recursive: true });
    const textPath = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads", `${runId}.txt`);
    const headlinePath = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads", `${runId}-headline.txt`);
    await writeFile(headlinePath, wrapText((args.headline?.trim() || "A little something for you").replace(/[\r\n]+/g, " ").slice(0, 70), 25, 3));
    await writeFile(textPath, wrapText((args.body?.trim() || safeCaption).replace(/[\r\n]+/g, " ").slice(0, 100), 45, 3));
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=0xDCEBE2:s=1080x1350:d=1", "-vf",
      "drawbox=x=60:y=790:w=960:h=500:color=0x1C3B33:t=fill,drawtext=textfile=" + headlinePath + ":fontcolor=white:fontsize=50:line_spacing=4:x=115:y=835,drawtext=textfile=" + textPath + ":fontcolor=0xD9E9DF:fontsize=30:line_spacing=4:x=115:y=1015,drawtext=text='SHOP THE DROP':fontcolor=0xF2B46E:fontsize=32:x=115:y=1175",
      "-frames:v", "1", localPath]);
    mediaUrl = await uploadLocalFile(localPath, "image");
  } else {
    const artwork = await generateArtwork(args.prompt, runId);
    mediaUrl = args.kind === "video" ? await renderVideo(artwork, caption, runId) : artwork;
  }
  return { runId, title: args.prompt.trim().slice(0, 80) || (isTemplate ? "New pubmat" : "New campaign"),
    kind: args.kind === "video" ? "video" : "image", source: args.kind === "template" ? "template" : args.kind === "video" ? "generated_video" : "ai_artwork", mediaUrl, caption,
    ...(isTemplate ? { templateHeadline: args.headline?.trim() || "A little something for you", templateBody: args.body?.trim() || caption } : {}) };
}
