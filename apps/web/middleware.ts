import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseConsoleServerSlug } from "@/lib/console-target";
import {
  flatUrlPathFromLegacyOrgPath,
  tryParseLegacyOrganizationsPath,
} from "@/lib/legacy-org-url";
import { usesOrgWorkspaceShell } from "@/lib/platform-shell-path";
import { WEHAWK_ACTIVE_ORG_COOKIE, ACTIVE_ORG_COOKIE_MAX_AGE_SEC } from "@/lib/active-org-cookie";

const LEGACY_PREFIX = "/console/";
const MANAGER_PREFIX = "/docker-manager/";
const PATHNAME_HEADER = "x-weehawk-pathname";

const AUTH_ACCESS_COOKIE = "weehawk_access_token";
const AUTH_REFRESH_COOKIE = "weehawk_refresh_token";

function nextWithPathname(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get(AUTH_ACCESS_COOKIE)?.value ||
      request.cookies.get(AUTH_REFRESH_COOKIE)?.value,
  );
}

async function fetchDefaultOrgPublicIdViaInternalRoute(
  request: NextRequest,
): Promise<string | null> {
  const url = new URL("/api/weehawk/session-default-org", request.nextUrl.origin);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { publicId?: string | null };
    const id = typeof data.publicId === "string" ? data.publicId.trim() : "";
    return id || null;
  } catch {
    return null;
  }
}

function activeOrgCookieOptions() {
  return {
    path: "/",
    maxAge: ACTIVE_ORG_COOKIE_MAX_AGE_SEC,
    sameSite: "lax" as const,
  };
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
    const res = NextResponse.redirect(target, 308);
    res.cookies.set(WEHAWK_ACTIVE_ORG_COOKIE, legacy.orgPublicId, activeOrgCookieOptions());
    return res;
  }

  if (
    hasSessionCookie(request) &&
    usesOrgWorkspaceShell(pathname) &&
    !request.cookies.get(WEHAWK_ACTIVE_ORG_COOKIE)?.value?.trim()
  ) {
    const orgId = await fetchDefaultOrgPublicIdViaInternalRoute(request);
    if (orgId) {
      const res = nextWithPathname(request);
      res.cookies.set(WEHAWK_ACTIVE_ORG_COOKIE, orgId, activeOrgCookieOptions());
      return res;
    }
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
