import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/confirm-email" ||
    pathname === "/confirm-email-change" ||
    pathname === "/auth/callback"
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname === "/subscription" || pathname.startsWith("/subscription/")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/subscription",
    "/subscription/:path*",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/confirm-email",
    "/confirm-email-change",
    "/auth/callback",
  ],
};
