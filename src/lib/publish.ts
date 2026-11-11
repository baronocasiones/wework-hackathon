import { db, nowIso } from "@/lib/db";
import { type Platform, type PublishResult } from "@/lib/domain";
import { loadPublicMedia } from "@/lib/media";
import { observeCredential, recordCredentialEvent } from "@/lib/monitoring";
import { providerError } from "@/lib/http";

type Job = { id: string; platform: Platform; caption: string; media_url: string; kind: "image" | "video"; title: string };
type JsonObject = Record<string, unknown>;
const asRecord = (value: unknown): JsonObject => typeof value === "object" && value !== null ? value as JsonObject : {};
const stringField = (value: JsonObject, field: string): string | null => typeof value[field] === "string" ? value[field] as string : null;

export class PartialPublishError extends Error {
  constructor(message: string, readonly providerId: string, readonly permalink: string | null = null) { super(message); }
}

async function facebook(job: Job): Promise<PublishResult> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  if (!token || !pageId) throw new Error("Facebook publishing is not configured. Set META_PAGE_ID and META_PAGE_ACCESS_TOKEN.");
  assertLiveMediaUrl(job.media_url);
  observeCredential({ platform: "meta", secret: token });
  const base = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
  if (job.kind === "image") {
    const form = new FormData();
    form.set("url", job.media_url);
    form.set("caption", job.caption);
    form.set("access_token", token);
    const response = await fetch(`${base}/${encodeURIComponent(pageId)}/photos`, { method: "POST", body: form });
    if (!response.ok) await providerError(response, "Facebook");
    const data = asRecord(await response.json());
    const postId = stringField(data, "post_id") ?? stringField(data, "id");
    if (!postId) throw new Error("Facebook accepted no post ID; outcome requires review.");
    const permalink = await facebookPermalink(base, postId, token);
    if (!permalink) return { providerId: postId, permalink: null, confirmation: "uncertain" };
    return { providerId: postId, permalink, confirmation: "confirmed" };
  }
  const begin = new URLSearchParams({ upload_phase: "start", access_token: token });
  const beginResponse = await fetch(`${base}/me/video_reels?${begin}`, { method: "POST" });
  if (!beginResponse.ok) await providerError(beginResponse, "Facebook Reels");
  const beginData = asRecord(await beginResponse.json());
  const videoId = stringField(beginData, "video_id");
  const uploadUrl = stringField(beginData, "upload_url");
  if (!videoId || !uploadUrl) throw new Error("Facebook returned an incomplete Reel upload session; outcome requires review.");
  const bytes = await loadPublicMedia(job.media_url);
  const upload = await fetch(uploadUrl, { method: "POST", headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(bytes.byteLength) }, body: new Uint8Array(bytes) });
  if (!upload.ok) throw new Error(`Facebook Reel media upload failed with status ${upload.status}.`);
  const finish = new URLSearchParams({ upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: job.caption, access_token: token });
  const finishResponse = await fetch(`${base}/me/video_reels?${finish}`, { method: "POST" });
  if (!finishResponse.ok) {
    try { await providerError(finishResponse, "Facebook Reels"); }
    catch (error) { throw new PartialPublishError(error instanceof Error ? error.message : "Facebook Reel confirmation was unavailable.", videoId); }
  }
  const finishData = asRecord(await finishResponse.json());
  if (finishData.success !== true) throw new Error("Facebook did not confirm the Reel publish; outcome requires review.");
  const permalink = await facebookPermalink(base, videoId, token);
  return { providerId: videoId, permalink, confirmation: permalink ? "confirmed" : "uncertain" };
}

async function facebookPermalink(base: string, id: string, token: string): Promise<string | null> {
  const response = await fetch(`${base}/${encodeURIComponent(id)}?fields=permalink_url&access_token=${encodeURIComponent(token)}`);
  if (!response.ok) return null;
  const data = asRecord(await response.json());
  return stringField(data, "permalink_url");
}

async function instagram(job: Job): Promise<PublishResult> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const accountId = process.env.META_IG_USER_ID;
  if (!token || !accountId) throw new Error("Instagram publishing is not configured. Set META_PAGE_ACCESS_TOKEN and META_IG_USER_ID.");
  assertLiveMediaUrl(job.media_url);
  observeCredential({ platform: "meta", secret: token });
  const base = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
  const create = new URLSearchParams({ caption: job.caption, access_token: token });
  if (job.kind === "image") create.set("image_url", job.media_url);
  else { create.set("media_type", "REELS"); create.set("video_url", job.media_url); }
  const containerResponse = await fetch(`${base}/${encodeURIComponent(accountId)}/media`, { method: "POST", body: create });
  if (!containerResponse.ok) await providerError(containerResponse, "Instagram");
  const containerId = stringField(asRecord(await containerResponse.json()), "id");
  if (!containerId) throw new Error("Instagram returned no media container ID; outcome requires review.");
  if (job.kind === "video") {
    let ready = false;
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const statusResponse = await fetch(`${base}/${encodeURIComponent(containerId)}?fields=status_code&access_token=${encodeURIComponent(token)}`);
      if (!statusResponse.ok) await providerError(statusResponse, "Instagram");
      const status = stringField(asRecord(await statusResponse.json()), "status_code");
      if (status === "FINISHED") { ready = true; break; }
      if (status === "ERROR" || status === "EXPIRED") throw new Error(`Instagram Reel processing ended in ${status}.`);
    }
    if (!ready) return { providerId: containerId, permalink: null, confirmation: "uncertain" };
  }
  const publish = new URLSearchParams({ creation_id: containerId, access_token: token });
  const publishResponse = await fetch(`${base}/${encodeURIComponent(accountId)}/media_publish`, { method: "POST", body: publish });
  if (!publishResponse.ok) await providerError(publishResponse, "Instagram");
  const mediaId = stringField(asRecord(await publishResponse.json()), "id");
  if (!mediaId) throw new Error("Instagram returned no published media ID; outcome requires review.");
  const permalinkResponse = await fetch(`${base}/${encodeURIComponent(mediaId)}?fields=permalink&access_token=${encodeURIComponent(token)}`);
  if (!permalinkResponse.ok) return { providerId: mediaId, permalink: null, confirmation: "uncertain" };
  const permalink = stringField(asRecord(await permalinkResponse.json()), "permalink");
  return { providerId: mediaId, permalink, confirmation: permalink ? "confirmed" : "uncertain" };
}

async function youtube(job: Job): Promise<PublishResult> {
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!channelId) throw new Error("YouTube publishing is not configured. Set YOUTUBE_CHANNEL_ID.");
  assertLiveMediaUrl(job.media_url);
  const token = await googleAccessToken();
  const metadata = { snippet: { title: job.title.slice(0, 100), description: job.caption, categoryId: "22" }, status: { privacyStatus: "public", selfDeclaredMadeForKids: false } };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4" }, body: JSON.stringify(metadata),
  });
  if (!init.ok) await providerError(init, "YouTube");
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube returned no resumable upload URL; outcome requires review.");
  const media = await loadPublicMedia(job.media_url);
  const upload = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(media.byteLength) }, body: new Uint8Array(media) });
  if (!upload.ok) await providerError(upload, "YouTube");
  const data = asRecord(await upload.json());
  const videoId = stringField(data, "id");
  if (!videoId) throw new Error("YouTube returned no video ID; outcome requires review.");
  const permalink = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const verifyParams = new URLSearchParams({ part: "snippet,status,processingDetails", id: videoId });
  const verification = await fetch(`https://www.googleapis.com/youtube/v3/videos?${verifyParams}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!verification.ok) return { providerId: videoId, permalink, confirmation: "accepted_pending" };
  const verifiedData = asRecord(await verification.json());
  const first = Array.isArray(verifiedData.items) ? asRecord(verifiedData.items[0]) : {};
  const snippet = asRecord(first.snippet);
  const status = asRecord(first.status);
  const processing = asRecord(first.processingDetails);
  if (stringField(snippet, "channelId") !== channelId || stringField(status, "uploadStatus") !== "processed" || stringField(status, "privacyStatus") !== "public" || stringField(processing, "processingStatus") === "failed") {
    return { providerId: videoId, permalink, confirmation: "accepted_pending" };
  }
  return { providerId: videoId, permalink, confirmation: "confirmed" };
}

export async function googleAccessToken(): Promise<string> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || (db().prepare("SELECT value FROM app_secrets WHERE key='google_refresh_token'").get() as { value?: string } | undefined)?.value;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) throw new Error("YouTube publishing is not configured. Complete Google OAuth setup in Settings.");
  observeCredential({ platform: "google", secret: refreshToken });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  if (!response.ok) {
    recordCredentialEvent({ platform: "google", event: "refreshed", expiresAt: null, outcome: "failed", detail: `Google token refresh returned ${response.status}.` });
    await providerError(response, "Google OAuth");
  }
  const data = asRecord(await response.json());
  const token = stringField(data, "access_token");
  if (!token) throw new Error("Google OAuth returned no access token.");
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  recordCredentialEvent({ platform: "google", event: "refreshed", expiresAt, outcome: "success", detail: "Access token refreshed; secret value omitted." });
  const channelsResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", { headers: { Authorization: `Bearer ${token}` } });
  if (!channelsResponse.ok) await providerError(channelsResponse, "YouTube channel check");
  const channelData = asRecord(await channelsResponse.json());
  const actualId = Array.isArray(channelData.items) ? stringField(asRecord(channelData.items[0]), "id") : null;
  if (!actualId || actualId !== process.env.YOUTUBE_CHANNEL_ID) throw new Error("Connected Google account does not match YOUTUBE_CHANNEL_ID.");
  return token;
}

function assertLiveMediaUrl(url: string): void {
  if (!url.startsWith("https://res.cloudinary.com/")) throw new Error("Connect Cloudinary and upload public HTTPS media before live publishing. This local file remains preview-only.");
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  if (!appUrl.startsWith("https://") || /localhost|127\.0\.0\.1/i.test(appUrl)) throw new Error("Set APP_URL to a public HTTPS address before live publishing. Product tracking links are local-only right now.");
}

export async function publishJob(job: Job): Promise<{ result: PublishResult; status: "published" | "needs_review" }> {
  const result = job.platform === "facebook" ? await facebook(job) : job.platform === "instagram" ? await instagram(job) : await youtube(job);
  return { result, status: result.confirmation === "confirmed" ? "published" : "needs_review" };
}

export async function markJobStarted(jobId: string): Promise<boolean> {
  const changed = db().prepare("UPDATE publish_jobs SET status='processing',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'").run(nowIso(), jobId);
  return changed.changes === 1;
}
