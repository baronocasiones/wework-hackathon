import { ownerExists, registerOwner, registrationAllowed, registrationSchema, sameOrigin, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: "Request origin did not match this studio." }, { status: 403 });
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email and a password of 12–128 characters." }, { status: 400 });
  if (ownerExists()) return Response.json({ error: "The owner account is already registered. Sign in instead." }, { status: 409 });
  if (!registrationAllowed(request, parsed.data.setupKey)) return Response.json({ error: "The setup key is incorrect or local setup is required." }, { status: 403 });
  const result = await registerOwner(parsed.data.email, parsed.data.password);
  if (!result) return Response.json({ error: "The owner account is already registered. Sign in instead." }, { status: 409 });
  const response = Response.json({ email: result.user.email }, { status: 201 });
  response.headers.set("Set-Cookie", sessionCookie(request, result.token));
  return response;
}
