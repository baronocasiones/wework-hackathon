import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { wrapText } from "@/lib/domain";
import { uploadLocalFile } from "@/lib/media";
import { geminiText } from "@/lib/gemini";
import { cloudflareImage } from "@/lib/cloudflare";
import { assertFalVideoReady, falVideo } from "@/lib/fal-video";

type GeneratedImage = { bytes: Buffer; mimeType: string };

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
  if (process.env.GEMINI_API_KEY) {
    const prompt = `Suggest social post copy for a ${args.kind} about: ${args.context.slice(0, 1000)}.\n` +
      `Existing title: ${provided.title || "(blank)"}\nExisting caption: ${provided.caption || "(blank)"}\n` +
      `Existing subtitle: ${provided.subtitle || "(blank)"}\n` +
      "Return only a JSON object with nonempty title, caption, and subtitle strings. Make the title specific and under 70 characters. " +
      "Make the caption friendly with one call to action and under 500 characters. Make the subtitle a short on-media line under 100 characters. " +
      "Do not invent prices, discounts, or product claims that the context does not support.";
    try { suggestion = parseSuggestedCopy(await geminiText(prompt, runId, "copy")); }
    catch { /* Keep local defaults when Gemini text is unavailable. */ }
  }

  const topic = args.context.trim().replace(/\.[^.\s]{2,5}$/, "").slice(0, 70);
  const title = provided.title || suggestion?.title || topic || (args.kind === "video" ? "New video" : "New Publication Materials");
  return { runId, copy: {
    title,
    caption: provided.caption || suggestion?.caption || `Take a look at ${title}. Find out more through the link.`,
    subtitle: provided.subtitle || suggestion?.subtitle || "Discover what's new.",
  } };
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

async function storeNativeVideo(bytes: Buffer): Promise<string> {
  const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  await mkdir(directory, { recursive: true });
  const videoPath = path.join(directory, `${randomUUID()}.mp4`);
  await writeFile(videoPath, bytes);
  return uploadLocalFile(videoPath, "video");
}

export async function createGeneratedAsset(args: { kind: "template" | "artwork" | "grok_video"; prompt: string; title?: string; caption?: string; subtitle?: string; templateBackgroundFile?: string | null }): Promise<{ runId: string; title: string; kind: "image" | "video"; source: string; mediaUrl: string; caption: string; subtitle: string; templateHeadline?: string; templateBody?: string; templateBackgroundFile?: string | null }> {
  if (args.kind === "grok_video") assertFalVideoReady();
  const runId = randomUUID();
  const { copy } = await recommendCopy({ kind: args.kind === "grok_video" ? "video" : "image", context: args.prompt,
    title: args.title, caption: args.caption, subtitle: args.subtitle }, runId);
  const { title, caption, subtitle } = copy;
  const isTemplate = args.kind === "template";
  let mediaUrl: string;
  let source = "template";
  let templateBackgroundFile: string | null | undefined;
  if (isTemplate) {
    const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
    const localPath = path.join(directory, `${runId}.png`);
    await mkdir(directory, { recursive: true });
    templateBackgroundFile = args.templateBackgroundFile;
    if (templateBackgroundFile === undefined) {
      const background = await cloudflareImage(`A clean, premium social media background for ${args.prompt}. No words, letters, logos, or typography. Leave quiet space for readable text.`, runId, "template_background");
      templateBackgroundFile = `${runId}-background.jpg`;
      await writeFile(path.join(directory, templateBackgroundFile), background.bytes);
    }
    const textPath = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads", `${runId}.txt`);
    const headlinePath = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads", `${runId}-headline.txt`);
    await writeFile(headlinePath, wrapText(title.replace(/[\r\n]+/g, " ").slice(0, 70), 25, 3));
    await writeFile(textPath, wrapText(subtitle.replace(/[\r\n]+/g, " ").slice(0, 100), 45, 3));
    const input = templateBackgroundFile === null
      ? ["-f", "lavfi", "-i", "color=c=0xDCEBE2:s=1080x1350:d=1"]
      : ["-i", path.join(directory, path.basename(templateBackgroundFile))];
    await runFfmpeg(["-y", ...input, "-vf",
      "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,drawbox=x=60:y=790:w=960:h=500:color=0x1C3B33:t=fill,drawtext=textfile=" + headlinePath + ":fontcolor=white:fontsize=50:line_spacing=4:x=115:y=835,drawtext=textfile=" + textPath + ":fontcolor=0xD9E9DF:fontsize=30:line_spacing=4:x=115:y=1015,drawtext=text='SHOP THE DROP':fontcolor=0xF2B46E:fontsize=32:x=115:y=1175",
      "-frames:v", "1", localPath]);
    mediaUrl = await uploadLocalFile(localPath, "image");
  } else if (args.kind === "artwork") {
    const artwork = await cloudflareImage(args.prompt, runId);
    mediaUrl = await storeArtwork(artwork);
    source = "cloudflare_artwork";
  } else {
    const video = await falVideo(args.prompt, runId);
    mediaUrl = await storeNativeVideo(video.bytes);
    source = "fal_grok_native_video";
  }
  return { runId, title, kind: args.kind === "grok_video" ? "video" : "image", source, mediaUrl, caption, subtitle,
    ...(isTemplate ? { templateHeadline: title, templateBody: subtitle, templateBackgroundFile } : {}) };
}
