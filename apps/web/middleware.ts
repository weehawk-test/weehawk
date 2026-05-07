import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseConsoleServerSlug } from "@/lib/console-target";
import {
  flatUrlPathFromLegacyOrgPath,
  tryParseLegacyOrganizationsPath,
} from "@/lib/legacy-org-url";

const LEGACY_PREFIX = "/console/";
const MANAGER_PREFIX = "/docker-manager/";
const PATHNAME_HEADER = "x-weehawk-pathname";

function nextWithPathname(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

/**
 * Canonical Docker Manager URL is `/docker-manager/:serverId/...`.
 * - Legacy `/console/...` redirects permanently to `/docker-manager/...`
 * - Invalid server ids (e.g. `local`) render full-page not-found without sidebar
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const legacy = tryParseLegacyOrganizationsPath(pathname);
  if (legacy) {
    const flatPath = flatUrlPathFromLegacyOrgPath(legacy.restPath);
    const target = new URL(flatPath + request.nextUrl.search, request.nextUrl.origin);
    return NextResponse.redirect(target, 308);
  }

  if (pathname.startsWith(LEGACY_PREFIX)) {
    const url = request.nextUrl.clone();
    url.pathname = `${MANAGER_PREFIX}${pathname.slice(LEGACY_PREFIX.length)}`;
    return NextResponse.redirect(url, 308);
  }

  if (!pathname.startsWith(MANAGER_PREFIX)) {
    return nextWithPathname(request);
  }

  const rest = pathname.slice(MANAGER_PREFIX.length);
  const firstSegment = rest.split("/")[0] ?? "";
  if (!firstSegment) return nextWithPathname(request);

  const slug = decodeURIComponent(firstSegment);
  if (parseConsoleServerSlug(slug) == null) {
    const url = request.nextUrl.clone();
    url.pathname = "/console-not-found";
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname);
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return nextWithPathname(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
