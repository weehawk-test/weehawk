import { getServerApiBase } from "@/lib/server-api";
import { getServerApiKey } from "@/lib/server-api-key";

type Ctx = { params: Promise<{ path?: string[] }> };

function buildUpstreamUrl(path: string[] | undefined, search: string): string {
  const base = getServerApiBase().replace(/\/+$/, "");
  const suffix = Array.isArray(path) && path.length > 0 ? path.map(encodeURIComponent).join("/") : "";
  return `${base}/api/${suffix}${search || ""}`;
}

function isPublicPassThroughPath(path: string[] | undefined): boolean {
  const p = `/${(path ?? []).join("/")}`.toLowerCase();
  return (
    p.startsWith("/oauth2/") ||
    p.startsWith("/login/oauth2/") ||
    p === "/auth/confirm-email" ||
    p === "/auth/forgot-password" ||
    p === "/auth/reset-password" ||
    p === "/user/confirm-email-change"
  );
}

function isAllowedAppRequest(req: Request): boolean {
  const forwardedApiKey = (req.headers.get("x-weehawk-api-key") ?? "").trim();
  if (forwardedApiKey) return true;

  const explicitClient = (req.headers.get("x-weehawk-client") ?? "").trim().toLowerCase();
  if (explicitClient === "web-ui") return true;

  // Allow only same-origin browser fetch/XHR calls (application traffic).
  // Direct URL navigation is `navigate` + `document` and should be denied.
  const secFetchSite = (req.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  const secFetchMode = (req.headers.get("sec-fetch-mode") ?? "").trim().toLowerCase();
  const secFetchDest = (req.headers.get("sec-fetch-dest") ?? "").trim().toLowerCase();
  return secFetchSite === "same-origin" && secFetchMode !== "navigate" && secFetchDest !== "document";
}

async function proxy(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  if (!isPublicPassThroughPath(path) && !isAllowedAppRequest(req)) {
    return Response.json({ status: 403, error: "Forbidden", message: "Invalid or missing API key" }, { status: 403 });
  }

  const url = new URL(req.url);
  const upstreamUrl = buildUpstreamUrl(path, url.search);

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");
  const apiKey = getServerApiKey();
  if (apiKey) headers.set("X-Weehawk-Api-Key", apiKey);

  // Buffer non-GET/HEAD bodies. Forwarding `req.body` + `duplex: "half"` hits undici
  // "expected non-null body source" when the incoming body stream is null or not usable.
  let body: ArrayBuffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const buf = await req.arrayBuffer();
    body = buf.byteLength > 0 ? buf : undefined;
    if (body) headers.set("content-length", String(body.byteLength));
  }

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    redirect: "manual",
    body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return proxy(req, ctx);
}
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return proxy(req, ctx);
}
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return proxy(req, ctx);
}
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return proxy(req, ctx);
}
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return proxy(req, ctx);
}
export async function OPTIONS(req: Request, ctx: Ctx): Promise<Response> {
  return proxy(req, ctx);
}
export async function HEAD(req: Request, ctx: Ctx): Promise<Response> {
  return proxy(req, ctx);
}

