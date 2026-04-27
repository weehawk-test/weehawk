import { getServerApiBase } from "@/lib/server-api";

type Ctx = { params: Promise<{ path?: string[] }> };

function buildUpstreamUrl(path: string[] | undefined, search: string): string {
  const base = getServerApiBase().replace(/\/+$/, "");
  const suffix = Array.isArray(path) && path.length > 0 ? path.map(encodeURIComponent).join("/") : "";
  return `${base}/api/${suffix}${search || ""}`;
}

async function proxy(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const upstreamUrl = buildUpstreamUrl(path, url.search);

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");
  const apiKey = (process.env.WEEHAWK_API_KEY ?? "").trim();
  if (apiKey) headers.set("X-Weehawk-Api-Key", apiKey);

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
  };

  const upstream = await fetch(upstreamUrl, init as RequestInit);
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

