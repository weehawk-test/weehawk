import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseConsoleServerSlug } from "@/lib/console-target";

const LEGACY_PREFIX = "/console/";
const MANAGER_PREFIX = "/docker-manager/";

/**
 * Canonical Docker Manager URL is `/docker-manager/:serverId/...`.
 * - Legacy `/console/...` redirects permanently to `/docker-manager/...`
 * - Invalid server ids (e.g. `local`) render full-page not-found without sidebar
 */
export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith(LEGACY_PREFIX)) {
    const url = request.nextUrl.clone();
    url.pathname = `${MANAGER_PREFIX}${pathname.slice(LEGACY_PREFIX.length)}`;
    return NextResponse.redirect(url, 308);
  }

  if (!pathname.startsWith(MANAGER_PREFIX)) return NextResponse.next();

  const rest = pathname.slice(MANAGER_PREFIX.length);
  const firstSegment = rest.split("/")[0] ?? "";
  if (!firstSegment) return NextResponse.next();

  const slug = decodeURIComponent(firstSegment);
  if (parseConsoleServerSlug(slug) == null) {
    const url = request.nextUrl.clone();
    url.pathname = "/console-not-found";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/console/:path*", "/docker-manager/:path*"],
};
