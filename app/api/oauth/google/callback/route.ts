import { db, nowIso } from "@/lib/db";
import { recordCredentialEvent } from "@/lib/monitoring";
import { apiAccess } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const denied = apiAccess(request); if (denied) return denied;
  const current = new URL(request.url);
  const code = current.searchParams.get("code");
  const expected = (db().prepare("SELECT value FROM app_secrets WHERE key='oauth_state'").get() as { value?: string } | undefined)?.value;
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("studio_oauth_state="))?.split("=")[1];
  const state = current.searchParams.get("state");
  if (!code || !expected || !cookie || state !== expected || cookie !== expected) return new Response("OAuth response did not match this setup session.", { status: 400 });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return new Response("Google OAuth client settings are incomplete.", { status: 500 });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
  const data = await response.json() as { refresh_token?: string; access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.refresh_token) {
    recordCredentialEvent({ platform: "google", event: "issued", expiresAt: null, outcome: "failed", detail: data.error ?? `OAuth returned ${response.status}; reconnect and allow offline access.` });
    return new Response("Google did not return a refresh token. Disconnect app access in your Google account, then connect again.", { status: 502 });
  }
  db().prepare("INSERT INTO app_secrets(key,value,updated_at) VALUES('google_refresh_token',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(data.refresh_token, nowIso());
  db().prepare("DELETE FROM app_secrets WHERE key='oauth_state'").run();
  recordCredentialEvent({ platform: "google", event: "issued", expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null, outcome: "success", detail: "Refresh credential stored server-side; secret value omitted." });
  return Response.redirect(new URL("/?google=connected", process.env.APP_URL ?? current.origin));
}
