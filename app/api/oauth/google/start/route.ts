import { randomBytes } from "node:crypto";
import { db, nowIso } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) return Response.json({ error: "Add GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI to .env.local first." }, { status: 400 });
  const state = randomBytes(24).toString("hex");
  db().prepare("INSERT INTO app_secrets(key,value,updated_at) VALUES('oauth_state',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(state, nowIso());
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent",
    scope: "openid email https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", state }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": `studio_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/api/oauth/google; Max-Age=600` } });
}
