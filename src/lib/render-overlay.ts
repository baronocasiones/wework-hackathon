import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { wrapText } from "@/lib/domain";
import type { StylePreset } from "@/lib/styles";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${String(code)}.`)));
  });
}

function fontFileArg(): string {
  return process.env.FFMPEG_FONT_PATH ? `:fontfile=${process.env.FFMPEG_FONT_PATH}` : "";
}

async function writeTextFile(filePath: string, text: string): Promise<void> {
  await writeFile(filePath, text, "utf8");
}

export async function renderImageOverlay(basePath: string, outPath: string, spec: { headline: string; body: string; cta: string; style: StylePreset; fontScale?: number }): Promise<void> {
  const fontScale = spec.fontScale ?? 1;
  const directory = path.dirname(outPath);
  await mkdir(directory, { recursive: true });
  const ff = fontFileArg();
  const headlinePath = path.join(directory, `${path.basename(outPath)}-headline.txt`);
  const bodyPath = path.join(directory, `${path.basename(outPath)}-body.txt`);
  const ctaPath = path.join(directory, `${path.basename(outPath)}-cta.txt`);
  await writeTextFile(headlinePath, wrapText(spec.headline.replace(/[\r\n]+/g, " ").slice(0, 70), 25, 3));
  await writeTextFile(bodyPath, wrapText(spec.body.replace(/[\r\n]+/g, " ").slice(0, 100), 45, 3));
  await writeTextFile(ctaPath, spec.cta.replace(/[\r\n]+/g, " ").slice(0, 40));
  const style = spec.style;
  const headlineSize = Math.round((spec.headline.length > 40 ? 42 : style.headlineSize) * fontScale);
  const bodySize = Math.round((spec.body.length > 80 ? 26 : 30) * fontScale);
  const ctaSize = Math.round(32 * fontScale);
  const filter = [
    "scale=1080:1350:force_original_aspect_ratio=increase",
    "crop=1080:1350",
    `drawtext=textfile=${headlinePath}${ff}:fontcolor=${style.palette.text}:fontsize=${headlineSize}:line_spacing=4:x=115:y=835:borderw=2:bordercolor=black@0.4`,
    `drawtext=textfile=${bodyPath}${ff}:fontcolor=${style.palette.text}:fontsize=${bodySize}:line_spacing=4:x=115:y=1015:borderw=1:bordercolor=black@0.3`,
    `drawtext=textfile=${ctaPath}${ff}:fontcolor=${style.palette.accent}:fontsize=${ctaSize}:x=115:y=1175:borderw=2:bordercolor=black@0.4`,
  ].join(",");
  await runFfmpeg(["-y", "-i", basePath, "-vf", filter, "-frames:v", "1", outPath]);
}

export async function renderVideoOverlay(basePath: string, outPath: string, spec: { headline: string; body: string; cta: string; style: StylePreset; fontScale?: number }): Promise<void> {
  const fontScale = spec.fontScale ?? 1;
  const directory = path.dirname(outPath);
  await mkdir(directory, { recursive: true });
  const ff = fontFileArg();
  const headlinePath = path.join(directory, `${path.basename(outPath)}-headline.txt`);
  const bodyPath = path.join(directory, `${path.basename(outPath)}-body.txt`);
  const ctaPath = path.join(directory, `${path.basename(outPath)}-cta.txt`);
  await writeTextFile(headlinePath, wrapText(spec.headline.replace(/[\r\n]+/g, " ").slice(0, 70), 28, 2));
  await writeTextFile(bodyPath, wrapText(spec.body.replace(/[\r\n]+/g, " ").slice(0, 100), 36, 2));
  await writeTextFile(ctaPath, spec.cta.replace(/[\r\n]+/g, " ").slice(0, 40));
  const style = spec.style;
  // lower-third safe zone: bottom 260px, fade-in over 0.5s
  const videoHeadlineSize = Math.round(40 * fontScale);
  const videoBodySize = Math.round(26 * fontScale);
  const videoCtaSize = Math.round(28 * fontScale);
  const filter = [
    `drawtext=textfile=${headlinePath}${ff}:fontcolor=${style.palette.text}:fontsize=${videoHeadlineSize}:line_spacing=4:x=40:y=h-230:borderw=2:bordercolor=black@0.5:alpha='if(lt(t,0.5),t/0.5,1)'`,
    `drawtext=textfile=${bodyPath}${ff}:fontcolor=${style.palette.text}:fontsize=${videoBodySize}:line_spacing=4:x=40:y=h-160:borderw=1:bordercolor=black@0.4:alpha='if(lt(t,0.5),t/0.5,1)'`,
    `drawtext=textfile=${ctaPath}${ff}:fontcolor=${style.palette.accent}:fontsize=${videoCtaSize}:x=40:y=h-100:borderw=2:bordercolor=black@0.5:alpha='if(lt(t,0.5),t/0.5,1)'`,
  ].join(",");
  await runFfmpeg(["-y", "-i", basePath, "-vf", filter, "-c:a", "copy", "-preset", "fast", "-crf", "23", outPath]);
}