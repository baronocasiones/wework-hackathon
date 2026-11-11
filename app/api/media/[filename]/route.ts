import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";

const mediaTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

export async function GET(request: Request, context: { params: Promise<{ filename: string }> }): Promise<Response> {
  const { filename } = await context.params;
  if (!/^[a-f0-9-]{36}\.(?:png|jpg|webp|mp4)$/.test(filename)) return new Response("Media not found.", { status: 404 });
  const contentType = mediaTypes[path.extname(filename)];
  const filePath = path.join(path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads"), filename);
  let size: number;
  try {
    const file = await stat(filePath);
    if (!file.isFile()) return new Response("Media not found.", { status: 404 });
    size = file.size;
  } catch { return new Response("Media not found.", { status: 404 }); }
  const headers = new Headers({ "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" });
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new Response(body, { headers });
}
