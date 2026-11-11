import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, nowIso } from "@/lib/db";
import { jsonError } from "@/lib/http";

const schema = z.object({ platform: z.enum(["facebook", "instagram", "youtube"]), campaign: z.string().max(100).optional(), amount: z.number().positive().max(100000).default(49) });

export async function POST(request: Request): Promise<Response> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Could not record this demo order.");
  const id = randomUUID();
  db().prepare("INSERT INTO demo_purchases(id,platform,campaign,amount,created_at) VALUES(?,?,?,?,?)").run(id, parsed.data.platform, parsed.data.campaign ?? null, parsed.data.amount, nowIso());
  return Response.json({ id, recorded: true, source: "demo" }, { status: 201 });
}
