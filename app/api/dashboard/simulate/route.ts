import { db, nowIso } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  try {
    const database = db();
    const platforms = ["facebook", "instagram", "youtube"] as const;
    const platform = platforms[Math.floor(Math.random() * platforms.length)];
    const views = 40 + Math.floor(Math.random() * 120);
    const likes = Math.floor(views * (0.04 + Math.random() * 0.08));
    const comments = Math.floor(views * (0.005 + Math.random() * 0.015));
    database.prepare("UPDATE demo_metrics SET views = views + ?, likes = likes + ?, comments = comments + ? WHERE platform = ?").run(views, likes, comments, platform);
    if (Math.random() < 0.35) {
      database.prepare("INSERT INTO demo_purchases (id, platform, campaign, amount, created_at) VALUES (?,?,?,?,?)").run(randomUUID(), platform, "demo-campaign", 49, nowIso());
    }
    return Response.json({ ok: true, platform, views, likes, comments });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Simulation failed.", 500);
  }
}