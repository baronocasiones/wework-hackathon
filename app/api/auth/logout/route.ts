import { clearSession, sameOrigin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: "Request origin did not match this studio." }, { status: 403 });
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", clearSession(request));
  return response;
}
