import { z } from "zod";
import { recordAiCall } from "@/lib/monitoring";

const model = "@cf/black-forest-labs/flux-1-schnell";
const responseSchema = z.object({
  success: z.boolean(),
  result: z.object({ image: z.string().min(1) }).optional(),
});

export async function cloudflareImage(prompt: string, runId: string): Promise<{ bytes: Buffer; mimeType: "image/jpeg" }> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!account || !token) throw new Error("Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to enable Cloudflare artwork.");

  const started = Date.now();
  let outcome: "success" | "failed" = "failed";
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 4 }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`Cloudflare artwork failed with status ${response.status}. Check Workers AI access and token permissions.`);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.success || !parsed.data.result?.image) {
      throw new Error("Cloudflare artwork returned no image.");
    }
    const encoded = parsed.data.result.image;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error("Cloudflare artwork returned invalid image data.");
    }
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      throw new Error("Cloudflare artwork returned an invalid JPEG image.");
    }
    outcome = "success";
    return { bytes, mimeType: "image/jpeg" };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cloudflare artwork")) throw error;
    throw new Error("Cloudflare artwork could not reach the API.");
  } finally {
    recordAiCall({ runId, operation: "artwork", model, durationMs: Date.now() - started, outcome });
  }
}
