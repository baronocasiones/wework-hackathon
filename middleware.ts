import { NextRequest, NextResponse } from "next/server";

function isPublic(pathname: string): boolean {
  return pathname === "/login" || pathname === "/register" || pathname.startsWith("/api/auth/") ||
    pathname === "/product" || pathname.startsWith("/product/") || pathname === "/api/purchase" ||
    pathname.startsWith("/uploads/") || pathname.startsWith("/api/media/") || pathname.startsWith("/brand/") || pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" || pathname === "/icon.svg";
}

export function middleware(request: NextRequest) {
  if (isPublic(request.nextUrl.pathname)) return NextResponse.next();
  // This is a navigation hint only. Pages and APIs verify the session against SQLite.
  if (request.cookies.has("post_house_session")) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in to use the studio." }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: "/:path*" };
