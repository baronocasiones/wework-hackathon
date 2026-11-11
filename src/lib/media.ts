import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type CloudinaryResponse = { secure_url?: string; public_id?: string; error?: { message?: string } };

export async function uploadToCloudinary(file: File, resourceType: "image" | "video"): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return storeLocalMedia(file, resourceType);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash("sha1").update(`timestamp=${timestamp}${apiSecret}`).digest("hex");
  const data = new FormData();
  data.set("file", file);
  data.set("api_key", apiKey);
  data.set("timestamp", timestamp);
  data.set("signature", signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`, { method: "POST", body: data });
  if (!response.ok) throw new Error(`Cloudinary upload failed with status ${response.status}.`);
  const result = await response.json() as CloudinaryResponse;
  if (!result.secure_url?.startsWith("https://")) throw new Error("Cloudinary did not return a secure public media URL.");
  return result.secure_url;
}

export async function storeLocalMedia(file: File, resourceType: "image" | "video"): Promise<string> {
  const directory = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  await mkdir(directory, { recursive: true });
  const extension = resourceType === "video" ? ".mp4" : ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" } as Record<string, string>)[file.type] ?? ".png";
  const filename = `${randomUUID()}${extension}`;
  await writeFile(path.join(directory, filename), Buffer.from(await file.arrayBuffer()));
  const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
  return new URL(`/api/media/${filename}`, baseUrl).toString();
}

export async function loadPublicMedia(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("res.cloudinary.com")) {
    throw new Error("Publishing requires a public HTTPS media URL hosted on Cloudinary.");
  }
  const response = await fetch(parsed, { redirect: "error" });
  if (!response.ok) throw new Error(`Media host returned status ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

export async function uploadLocalFile(localPath: string, resourceType: "image" | "video"): Promise<string> {
  const fileBytes = await readFile(localPath);
  const filename = localPath.split(/[\\/]/).pop() ?? "media";
  const file = new File([fileBytes], filename, { type: resourceType === "image" ? "image/png" : "video/mp4" });
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return storeLocalMedia(file, resourceType);
  return uploadToCloudinary(file, resourceType);
}
