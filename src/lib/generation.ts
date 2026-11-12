import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { wrapText } from "@/lib/domain";
import { uploadLocalFile } from "@/lib/media";
import { geminiText } from "@/lib/gemini";
import { cloudflareImage } from "@/lib/cloudflare";
import { getStyle, recommendStyle, type StyleName } from "@/lib/styles";
import { falVideo, falVideoReady } from "@/lib/fal-video";
import { artworkTextMode, buildPosterScene, kenBurnsDuration, kenBurnsVideo, generatePosterAsset, ideogramConfigured, ambientAudioFile, buildGrokInstruction, type PosterAsset } from "@/lib/ideogram";
import { renderImageOverlay, renderVideoOverlay } from "@/lib/render-overlay";
import { agentEnabled, dailyAgentCap, runImageAgentLoop, runVideoAgentLoop, todayAgentCallCount, critiqueImage, extractFirstFrame, extractFrameAt, recordAttempt } from "@/lib/agent-critique";
import { buildArtworkPrompt } from "@/lib/artwork-prompt";
const copySchema = z.object({ title: z.string().trim().min(1), caption: z.string().trim().min(1), subtitle: z.string().trim().min(1), cta: z.string().trim().min(1).max(40).optional() });
export type ContentCopy = { title: string; caption: string; subtitle: string };
export type CopyResult = { runId: string; copy: ContentCopy; cta: string };
type CopyRequest = { kind: "image" | "video"; context: string; title?: string; caption?: string; subtitle?: string };
function parseSuggestedCopy(text: string): { copy: ContentCopy; cta: string } {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI returned copy in an unexpected format.");
  const parsed = copySchema.parse(JSON.parse(text.slice(first, last + 1)));
  return {
    copy: { title: parsed.title.slice(0, 120), caption: parsed.caption.slice(0, 2200), subtitle: parsed.subtitle.slice(0, 100) },
    cta: (parsed.cta ?? "SHOP NOW").slice(0, 40),
  };
}
export async function recommendCopy(args: CopyRequest & { cta?: string }, runId = randomUUID()): Promise<CopyResult> {
  const provided = {
    title: args.title?.trim().slice(0, 120) ?? "",
    caption: args.caption?.trim().slice(0, 2200) ?? "",
    subtitle: args.subtitle?.trim().slice(0, 100) ?? "",
  };
  if (provided.title && provided.caption && provided.subtitle) return { runId, copy: provided, cta: args.cta?.trim() || "SHOP NOW" };
  let suggestion: { copy: ContentCopy; cta: string } | undefined;
  if (process.env.GEMINI_API_KEY) {
    const prompt = `Suggest social post copy for a ${args.kind} about: ${args.context.slice(0, 1000)}.\n` +
      `Existing title: ${provided.title || "(blank)"}\nExisting caption: ${provided.caption || "(blank)"}\n` +
      `Existing subtitle: ${provided.subtitle || "(blank)"}\nExisting CTA: ${args.cta || "(blank)"}\n` +
      "Return only a JSON object with nonempty title, caption, subtitle, and cta strings. Make the title specific and under 70 characters. " +
      "Make the caption friendly with one call to action and under 500 characters. Make the subtitle a short on-media line under 100 characters. " +
      "Make the cta a short uppercase call to action under 20 characters (e.g. SHOP NOW, LEARN MORE, DISCOVER). " +
      "Do not invent prices, discounts, or product claims that the context does not support.\n" +
      "Example: {\"title\":\"Weekend market favorites\",\"caption\":\"Stroll the weekend market and find fresh picks from local makers. See you there!\",\"subtitle\":\"Local finds, every weekend\",\"cta\":\"SHOP NOW\"}";
    try { suggestion = parseSuggestedCopy(await geminiText(prompt, runId, "copy")); }
    catch { /* Keep local defaults when Gemini text is unavailable. */ }
  }
  const topic = args.context.trim().replace(/\.[^.\s]{2,5}$/, "").slice(0, 70);
  const title = provided.title || suggestion?.copy.title || topic || (args.kind === "video" ? "New video" : "New Publication Materials");
  const cta = (args.cta?.trim() || suggestion?.cta || "SHOP NOW").slice(0, 40);
  return { runId, copy: {
    title,
    caption: provided.caption || suggestion?.copy.caption || `Take a look at ${title}. Find out more through the link.`,
    subtitle: provided.subtitle || suggestion?.copy.subtitle || "Discover what's new.",
  }, cta };
}
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${String(code)}.`)));
  });
}
export function overlayQaEnabled(isVideo: boolean): boolean {
  const raw = (process.env.OVERLAY_QA_ENABLED ?? "videos").trim().toLowerCase();
  if (raw === "all") return true;
  if (raw === "off" || raw === "false" || raw === "0") return false;
  if (raw === "images") return !isVideo;
  return isVideo;
}
async function overlayReadabilityQa(args: { renderedPath: string; isVideo: boolean; title: string; subtitle: string; cta: string; styleName: string; runId: string; reRender: (fontScale: number) => Promise<void> }): Promise<void> {
  if (!overlayQaEnabled(args.isVideo)) return;
  const qaPrompt = `social pubmat: headline "${args.title}", body "${args.subtitle}", CTA "${args.cta}"`;
  let bytes: Buffer | null = null;
  try {
    bytes = await readFile(args.renderedPath);
    if (args.isVideo) bytes = extractFrameAt(bytes, 1.0) ?? extractFirstFrame(bytes);
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length === 0) {
    recordAttempt(args.runId, 1, "overlay_qa", -1, ["overlay QA could not read the rendered file"], qaPrompt, true);
    return;
  }
  const critique = await critiqueImage(bytes, qaPrompt, args.styleName, args.runId, "overlay");
  const accepted = critique.score >= 70 || critique.score === -1;
  recordAttempt(args.runId, 1, "overlay_qa", critique.score, critique.issues, critique.revisedPrompt, accepted);
  if (critique.score >= 0 && critique.score < 70) {
    try {
      await args.reRender(1.35);
    } catch {
      // QA never blocks shipping; keep the 1.0 font-scale render.
    }
  }
}
async function storeNativeVideo(bytes: Buffer): Promise<string> {
  const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  await mkdir(directory, { recursive: true });
  const videoPath = path.join(directory, `${randomUUID()}.mp4`);
  await writeFile(videoPath, bytes);
  return uploadLocalFile(videoPath, "video");
}
export async function createGeneratedAsset(args: { kind: "template" | "artwork" | "video"; prompt: string; title?: string; caption?: string; subtitle?: string; cta?: string; templateBackgroundFile?: string | null; style?: string }): Promise<{ runId: string; title: string; kind: "image" | "video"; source: string; mediaUrl: string; caption: string; subtitle: string; style: string; templateHeadline?: string; templateBody?: string; templateCta?: string; templateBackgroundFile?: string | null; posterPrompt: string | null }> {
  const runId = randomUUID();
  const { copy, cta: generatedCta } = await recommendCopy({ kind: args.kind === "video" ? "video" : "image", context: args.prompt,
    title: args.title, caption: args.caption, subtitle: args.subtitle, cta: args.cta }, runId);
  const { title, caption, subtitle } = copy;
  const cta = args.cta?.trim() || generatedCta || "SHOP NOW";
  const styleName = args.style && getStyle(args.style).name === args.style ? args.style : await recommendStyle(args.prompt, runId);
  const style = getStyle(styleName);
  const isTemplate = args.kind === "template";
  const isArtwork = args.kind === "artwork";
  const isVideo = args.kind === "video";
  const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  await mkdir(directory, { recursive: true });
  let mediaUrl: string | null = null;
  let source = "template";
  let templateBackgroundFile: string | null | undefined;
  let baseFileName: string | null = null;
  let posterPrompt: string | null = null;
  if (isTemplate) {
    source = "template";
    templateBackgroundFile = args.templateBackgroundFile;
    if (templateBackgroundFile === undefined) {
      const background = await cloudflareImage(`A clean, premium social media background for ${args.prompt}. ${style.promptSuffix}. No words, letters, logos, or typography. Leave quiet space for readable text.`, runId, "template_background");
      templateBackgroundFile = `${runId}-background.jpg`;
      await writeFile(path.join(directory, templateBackgroundFile), background.bytes);
    }
    const localPath = path.join(directory, `${runId}.png`);
    const basePath = templateBackgroundFile === null ? null : path.join(directory, path.basename(templateBackgroundFile));
    if (basePath) {
      await renderImageOverlay(basePath, localPath, { headline: title, body: subtitle, cta, style });
      await overlayReadabilityQa({ renderedPath: localPath, isVideo: false, title, subtitle, cta, styleName: style.name, runId,
        reRender: (fontScale) => renderImageOverlay(basePath, localPath, { headline: title, body: subtitle, cta, style, fontScale }) });
    } else {
      // fallback solid background
      await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=0xDCEBE2:s=1080x1350:d=1", "-frames:v", "1", localPath]);
    }
    mediaUrl = await uploadLocalFile(localPath, "image");
    baseFileName = templateBackgroundFile ?? null;
  } else {
    const posterFormat: "image" | "video" = isArtwork ? "image" : "video";
    const scene = buildPosterScene(args.prompt, style);
    posterPrompt = scene;
    const posterCopy = { headline: title, body: subtitle, cta };
    const renderPoster = (sceneNow: string): Promise<PosterAsset> =>
      generatePosterAsset({ runId, scene: sceneNow, copy: posterCopy, style, format: posterFormat, durationSeconds: kenBurnsDuration() });
    const useIdeogram = artworkTextMode() === "ideogram" && ideogramConfigured();
    if (posterFormat === "video" && artworkTextMode() === "ideogram" && falVideoReady()) {
      // Grok text-to-video primary: cheapest fal option under the demo's constraints.
      // The model decides what text it renders from the prompt; accuracy is best-effort.
      const renderGrok = async (): Promise<{ bytes: Buffer; mediaUrl: string; baseFileName: string }> => {
        const promptForGrok = buildGrokInstruction(scene, style.promptSuffix);
        const v = await falVideo(promptForGrok, runId);
        const track = process.env.FAL_VIDEO_AUDIO_TRACK?.trim();
        let muxed = v.bytes;
        if (track) {
          const { muxAmbientAudio } = await import("@/lib/fal-video");
          muxed = await muxAmbientAudio(muxed, track);
        }
        const baseFile = `${runId}-grok-base.mp4`;
        await writeFile(path.join(directory, baseFile), muxed);
        const url = await uploadLocalFile(path.join(directory, baseFile), "video");
        return { bytes: muxed, mediaUrl: url, baseFileName: baseFile };
      };
      source = "fal_grok_native_video";
      try {
        const grokPrompt = buildGrokInstruction(scene, style.promptSuffix);
        if (agentEnabled() && todayAgentCallCount() < dailyAgentCap()) {
          const result = await runVideoAgentLoop({
            runId, prompt: grokPrompt, style: style.name, maxAttempts: 2,
            generate: async () => {
              const r = await renderGrok();
              return { bytes: r.bytes, mediaUrl: r.mediaUrl, baseMediaUrl: r.baseFileName };
            },
          });
          mediaUrl = result.mediaUrl;
          baseFileName = result.baseMediaUrl ?? null;
        } else {
          const r = await renderGrok();
          mediaUrl = r.mediaUrl;
          baseFileName = r.baseFileName;
        }
      } catch {
        mediaUrl = null;
        baseFileName = null;
      }
    }
    if (useIdeogram && !mediaUrl) {
      try {
        if (posterFormat === "image") {
          source = "ideogram_artwork";
          if (agentEnabled() && todayAgentCallCount() < dailyAgentCap()) {
            const result = await runImageAgentLoop({
              runId, prompt: scene, style: style.name,
              generate: async (p) => {
                const r = await renderPoster(p);
                return { bytes: r.bytes, mediaUrl: r.mediaUrl, baseMediaUrl: r.baseFileName };
              },
            });
            mediaUrl = result.mediaUrl;
            baseFileName = result.baseMediaUrl ?? null;
          } else {
            const r = await renderPoster(scene);
            mediaUrl = r.mediaUrl;
            baseFileName = r.baseFileName;
          }
        } else {
          source = "ideogram_video";
          if (agentEnabled() && todayAgentCallCount() < dailyAgentCap()) {
            const result = await runVideoAgentLoop({
              runId, prompt: scene, style: style.name, maxAttempts: 2,
              generate: async (p) => {
                const r = await renderPoster(p);
                return { bytes: r.bytes, mediaUrl: r.mediaUrl, baseMediaUrl: r.baseFileName };
              },
            });
            mediaUrl = result.mediaUrl;
            baseFileName = result.baseMediaUrl ?? null;
          } else {
            const r = await renderPoster(scene);
            mediaUrl = r.mediaUrl;
            baseFileName = r.baseFileName;
          }
        }
      } catch {
        mediaUrl = null;
        baseFileName = null;
      }
    }
    if (!mediaUrl) {
      const fallbackPrompt = buildArtworkPrompt(args.prompt, style.promptSuffix);
      if (posterFormat === "image") {
        source = "cloudflare_artwork";
        const renderArtwork = async (prompt: string): Promise<{ bytes: Buffer; mediaUrl: string; baseFileName: string }> => {
          const img = await cloudflareImage(prompt, runId);
          const baseFile = `${runId}-artwork-base.jpg`;
          await writeFile(path.join(directory, baseFile), img.bytes);
          const renderedFile = `${runId}-artwork.png`;
          const renderedPath = path.join(directory, renderedFile);
          const scaledBase = `${runId}-artwork-scaled.png`;
          await runFfmpeg(["-y", "-i", path.join(directory, baseFile), "-vf", "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350", "-frames:v", "1", path.join(directory, scaledBase)]);
          await renderImageOverlay(path.join(directory, scaledBase), renderedPath, { headline: title, body: subtitle, cta, style });
          await overlayReadabilityQa({ renderedPath, isVideo: false, title, subtitle, cta, styleName: style.name, runId,
            reRender: (fontScale) => renderImageOverlay(path.join(directory, scaledBase), renderedPath, { headline: title, body: subtitle, cta, style, fontScale }) });
          const url = await uploadLocalFile(renderedPath, "image");
          return { bytes: img.bytes, mediaUrl: url, baseFileName: scaledBase };
        };
        if (agentEnabled() && todayAgentCallCount() < dailyAgentCap()) {
          const result = await runImageAgentLoop({
            runId, prompt: fallbackPrompt, style: style.name,
            generate: async (p) => {
              const r = await renderArtwork(p);
              return { bytes: r.bytes, mediaUrl: r.mediaUrl, baseMediaUrl: r.baseFileName };
            },
          });
          mediaUrl = result.mediaUrl;
          baseFileName = result.baseMediaUrl ?? null;
        } else {
          const r = await renderArtwork(fallbackPrompt);
          mediaUrl = r.mediaUrl;
          baseFileName = r.baseFileName;
        }
      } else {
        source = "cloudflare_video";
        const renderFallbackVideo = async (): Promise<{ bytes: Buffer; mediaUrl: string; baseFileName: string }> => {
          const img = await cloudflareImage(fallbackPrompt, runId);
          const baseFile = `${runId}-video-cloudflare-base.jpg`;
          await writeFile(path.join(directory, baseFile), img.bytes);
          const stillFile = `${runId}-video-fallback-still.png`;
          await runFfmpeg(["-y", "-i", path.join(directory, baseFile), "-vf", "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350", "-frames:v", "1", path.join(directory, stillFile)]);
          const rawPath = path.join(directory, `${runId}-video-fallback-raw.mp4`);
          await kenBurnsVideo(path.join(directory, stillFile), rawPath, { durationSeconds: kenBurnsDuration(), audioTrack: await ambientAudioFile() });
          const renderedPath = path.join(directory, `${runId}-video-fallback.mp4`);
          await renderVideoOverlay(rawPath, renderedPath, { headline: title, body: subtitle, cta, style });
          await overlayReadabilityQa({ renderedPath, isVideo: true, title, subtitle, cta, styleName: style.name, runId,
            reRender: (fontScale) => renderVideoOverlay(rawPath, renderedPath, { headline: title, body: subtitle, cta, style, fontScale }) });
          const bytes = await readFile(renderedPath);
          const url = await uploadLocalFile(renderedPath, "video");
          return { bytes, mediaUrl: url, baseFileName: stillFile };
        };
        if (agentEnabled() && todayAgentCallCount() < dailyAgentCap()) {
          const result = await runVideoAgentLoop({
            runId, prompt: fallbackPrompt, style: style.name, maxAttempts: 2,
            generate: async () => {
              const r = await renderFallbackVideo();
              return { bytes: r.bytes, mediaUrl: r.mediaUrl, baseMediaUrl: r.baseFileName };
            },
          });
          mediaUrl = result.mediaUrl;
          baseFileName = result.baseMediaUrl ?? null;
        } else {
          const r = await renderFallbackVideo();
          mediaUrl = r.mediaUrl;
          baseFileName = r.baseFileName;
        }
      }
    }
  }
  // store base file name in thumbnail_url for editability (consistent with template)
  const thumbnailName = baseFileName;
  if (!mediaUrl) throw new Error("Generated asset failed before upload.");
  return { runId, title, kind: args.kind === "video" ? "video" : "image", source, mediaUrl, caption, subtitle, style: style.name,
    templateHeadline: title, templateBody: subtitle, templateCta: cta,
    templateBackgroundFile: isTemplate ? templateBackgroundFile : (thumbnailName ?? null),
    posterPrompt };
}
