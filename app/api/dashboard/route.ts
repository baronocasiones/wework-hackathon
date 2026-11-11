import { db } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { googleAccessToken } from "@/lib/publish";

export const runtime = "nodejs";

type VideoStats = { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } };
type Metric = { platform: string; label: string; views: number; likes: number; comments: number; engagement: number; source: "live" | "demo"; postCount: number; sales: number; revenue: number };

async function youtubeStats(ids: string[]): Promise<Map<string, VideoStats>> {
  const map = new Map<string, VideoStats>();
  if (!ids.length || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return map;
  let accessToken: string;
  try { accessToken = await googleAccessToken(); } catch { return map; }
  const fields = new URLSearchParams({ part: "statistics", id: ids.join(",") });
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${fields}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return map;
    const data = await response.json() as { items?: VideoStats[] };
    for (const item of data.items ?? []) map.set(item.id, item);
  } catch { return map; }
  return map;
}

export async function GET(): Promise<Response> {
  try {
    const database = db();
    const jobs = database.prepare(`SELECT j.*,c.title FROM publish_jobs j JOIN content c ON c.id=j.content_id WHERE j.status='published'`).all() as Array<{ id: string; platform: string; provider_id: string | null; permalink: string | null; status: string }>;
    const youtubeIds = jobs.filter((job) => job.platform === "youtube" && job.provider_id).map((job) => job.provider_id as string);
    const stats = await youtubeStats(youtubeIds);
    const purchases = database.prepare("SELECT platform,COUNT(*) count,SUM(amount) revenue FROM demo_purchases GROUP BY platform").all() as Array<{ platform: string; count: number; revenue: number | null }>;
    const metrics: Metric[] = (["facebook", "instagram", "youtube"] as const).map((platform) => {
      const platformJobs = jobs.filter((job) => job.platform === platform);
      const purchase = purchases.find((row) => row.platform === platform);
      const live = platform === "youtube" && platformJobs.length > 0 && platformJobs.every((job) => job.provider_id && stats.has(job.provider_id));
      let views = 0; let likes = 0; let comments = 0;
      if (live) for (const job of platformJobs) {
        const item = job.provider_id ? stats.get(job.provider_id) : undefined;
        views += Number(item?.statistics?.viewCount ?? 0); likes += Number(item?.statistics?.likeCount ?? 0); comments += Number(item?.statistics?.commentCount ?? 0);
      }
      const sample = database.prepare("SELECT views,likes,comments FROM demo_metrics WHERE platform=?").get(platform) as { views: number; likes: number; comments: number };
      const shownViews = live ? views : sample.views;
      const shownLikes = live ? likes : sample.likes;
      const shownComments = live ? comments : sample.comments;
      return { platform, label: platform, views: shownViews, likes: shownLikes, comments: shownComments,
        engagement: shownViews > 0 ? (shownLikes + shownComments) / shownViews : 0, source: live ? "live" : "demo", postCount: platformJobs.length,
        sales: purchase?.count ?? 0, revenue: purchase?.revenue ?? 0 };
    });
    const recentJobs = database.prepare(`SELECT j.*,c.title,c.kind,c.media_url FROM publish_jobs j JOIN content c ON c.id=j.content_id ORDER BY j.created_at DESC LIMIT 30`).all();
    const usage = database.prepare(`SELECT run_id,MIN(created_at) started_at,COUNT(*) calls,CASE WHEN COUNT(input_tokens)=0 THEN NULL ELSE SUM(input_tokens) END input_tokens,CASE WHEN COUNT(output_tokens)=0 THEN NULL ELSE SUM(output_tokens) END output_tokens,CASE WHEN COUNT(total_tokens)=0 THEN NULL ELSE SUM(total_tokens) END total_tokens,SUM(duration_ms) duration_ms FROM ai_calls GROUP BY run_id ORDER BY started_at DESC LIMIT 10`).all();
    const aiCalls = database.prepare("SELECT id,operation,model,input_tokens,output_tokens,total_tokens,duration_ms,outcome,created_at FROM ai_calls ORDER BY created_at DESC LIMIT 20").all();
    const credentialEvents = database.prepare("SELECT id,platform,event,expires_at,outcome,detail,created_at FROM credential_events ORDER BY created_at DESC LIMIT 10").all();
    return Response.json({ metrics, jobs: recentJobs, usage, aiCalls, credentialEvents,
      configured: { gemini: Boolean(process.env.GEMINI_API_KEY), openAi: Boolean(process.env.OPENAI_API_KEY), cloudinary: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET), meta: Boolean(process.env.META_PAGE_ID && process.env.META_PAGE_ACCESS_TOKEN && process.env.META_IG_USER_ID), google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && (process.env.GOOGLE_REFRESH_TOKEN || database.prepare("SELECT value FROM app_secrets WHERE key='google_refresh_token'").get())), publicLinks: (process.env.APP_URL ?? "http://localhost:8000").startsWith("https://") && !/localhost|127\.0\.0\.1/i.test(process.env.APP_URL ?? "http://localhost:8000") } });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Dashboard is unavailable.", 500); }
}
