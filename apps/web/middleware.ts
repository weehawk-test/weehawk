import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Must match API `WEEHAWK_EDITION`; set `NEXT_PUBLIC_WEEHAWK_EDITION` in apps/web. */
function isCloudEdition(): boolean {
  return (process.env.NEXT_PUBLIC_WEEHAWK_EDITION ?? "").toLowerCase() === "cloud";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cloud = isCloudEdition();

  if (!cloud) {
    if (pathname === "/subscription" || pathname.startsWith("/subscription/")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/console/local" || pathname.startsWith("/console/local/")) {
    return NextResponse.redirect(new URL("/remote-server", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/console/local", "/console/local/:path*", "/subscription", "/subscription/:path*"],
};
