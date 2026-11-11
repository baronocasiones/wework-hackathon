import { NextRequest, NextResponse } from "next/server";

function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function isPublicPath(pathname: string): boolean {
  return pathname === "/product" || pathname.startsWith("/product/") || pathname === "/api/purchase" ||
    pathname.startsWith("/uploads/") || pathname.startsWith("/api/media/") || pathname.startsWith("/_next/") || pathname === "/favicon.ico";
}

async function matchesPassword(authorization: string | null, username: string, password: string): Promise<boolean> {
  if (!authorization?.startsWith("Basic ")) return false;
  let supplied: string;
  try { supplied = atob(authorization.slice(6)); } catch { return false; }
  const split = supplied.indexOf(":");
  if (split < 0) return false;
  const candidate = supplied.slice(0, split) === username ? supplied.slice(split + 1) : "";
  const encoder = new TextEncoder();
  const [expectedHash, candidateHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(password)),
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
  ]);
  const expected = new Uint8Array(expectedHash);
  const actual = new Uint8Array(candidateHash);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
  return difference === 0 && supplied.slice(0, split) === username;
}

export async function middleware(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  const password = process.env.STUDIO_PASSWORD;
  const configuredHost = (() => {
    try { return new URL(process.env.APP_URL ?? "http://localhost:3000").hostname; }
    catch { return "invalid"; }
  })();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().split(":")[0] ?? "localhost";
  const publicAccess = !isLocal(request.nextUrl.hostname) || !isLocal(configuredHost) || !isLocal(forwardedHost);
  if (!password) {
    if (!publicAccess) return NextResponse.next();
    return new NextResponse("Set STUDIO_PASSWORD in .env.local before exposing the studio publicly.", { status: 503 });
  }
  const username = process.env.STUDIO_USERNAME || "operator";
  if (await matchesPassword(request.headers.get("authorization"), username, password)) return NextResponse.next();
  return new NextResponse("Studio sign-in required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Post House studio", charset="UTF-8"' },
  });
}

export const config = { matcher: "/:path*" };
