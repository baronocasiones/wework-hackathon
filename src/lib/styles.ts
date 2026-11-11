import { z } from "zod";
import { geminiText } from "@/lib/gemini";

export type StyleName =
  | "clean_editorial"
  | "bold_drop"
  | "warm_market"
  | "minimal_mono"
  | "playful_pop"
  | "premium_dark";

export type StylePreset = {
  name: StyleName;
  description: string;
  promptSuffix: string;
  palette: { bg: string; accent: string; text: string };
  headlineSize: number;
  boxOpacity: string;
};

export const STYLES: StylePreset[] = [
  { name: "clean_editorial", description: "Clean, editorial, premium; quiet space for text.", promptSuffix: "clean editorial photography, soft natural light, muted greens and cream, premium minimal composition, lots of quiet negative space", palette: { bg: "0xDCEBE2", accent: "0xF2B46E", text: "white" }, headlineSize: 50, boxOpacity: "0x1C3B33" },
  { name: "bold_drop", description: "High contrast, bold typography-friendly, punchy.", promptSuffix: "bold high-contrast product photography, strong shadows, saturated accent color, graphic composition, modern retail", palette: { bg: "0x111111", accent: "0xFF5A36", text: "white" }, headlineSize: 58, boxOpacity: "0x000000" },
  { name: "warm_market", description: "Warm, artisanal market feel, tactile textures.", promptSuffix: "warm artisanal market scene, golden hour light, natural textures wood and fabric, cozy inviting atmosphere", palette: { bg: "0xF4E7D3", accent: "0xC96A3D", text: "0x2A1F16" }, headlineSize: 48, boxOpacity: "0x3A2A1F" },
  { name: "minimal_mono", description: "Monochrome minimal, lots of whitespace.", promptSuffix: "minimalist monochrome composition, single subject, soft gradient background, ample whitespace, refined", palette: { bg: "0xF5F5F5", accent: "0x111111", text: "0x111111" }, headlineSize: 46, boxOpacity: "0xFFFFFF" },
  { name: "playful_pop", description: "Bright, playful, pop-art energy.", promptSuffix: "bright playful pop-art style, vivid saturated colors, fun geometric shapes, energetic composition", palette: { bg: "0xFFF1D6", accent: "0x6C5CE7", text: "0x1F1F1F" }, headlineSize: 54, boxOpacity: "0x6C5CE7" },
  { name: "premium_dark", description: "Dark, luxurious, moody.", promptSuffix: "dark luxurious moody photography, deep tones, subtle rim light, premium product focus, elegant", palette: { bg: "0x1A1A22", accent: "0xD4AF37", text: "white" }, headlineSize: 50, boxOpacity: "0x0F0F14" },
];

const styleNameSchema = z.enum(STYLES.map((s) => s.name) as [StyleName, ...StyleName[]]);

export function getStyle(name: string | null | undefined): StylePreset {
  const found = STYLES.find((s) => s.name === name);
  return found ?? STYLES[0];
}

export async function recommendStyle(prompt: string, runId: string): Promise<StyleName> {
  const names = STYLES.map((s) => `${s.name}: ${s.description}`).join("\n");
  const textPrompt = `Choose the single best visual style for a social media post about: ${prompt.slice(0, 500)}.\nAvailable styles:\n${names}\nReturn only a JSON object like {"style":"clean_editorial"} with one of the listed style names. No other text.`;
  if (!process.env.GEMINI_API_KEY) return "clean_editorial";
  try {
    const text = await geminiText(textPrompt, runId, "style");
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error("bad format");
    const parsed = z.object({ style: styleNameSchema }).safeParse(JSON.parse(text.slice(first, last + 1)));
    if (!parsed.success) throw new Error("invalid style");
    return parsed.data.style;
  } catch {
    return "clean_editorial";
  }
}