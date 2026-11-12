import { accountSchema, login, sameOrigin, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: "Request origin did not match this studio." }, { status: 403 });
  const parsed = accountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid email or password." }, { status: 400 });
  const result = await login(parsed.data.email, parsed.data.password, request);
  if (result.kind === "blocked") return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  if (result.kind !== "ok") return Response.json({ error: "Invalid email or password." }, { status: 401 });
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie(request, result.token));
  return response;
}
