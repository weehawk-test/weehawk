import { NextResponse } from "next/server";
import { fetchPlatformNews } from "@/(platform)/news/platform-news";

export async function GET() {
  const items = await fetchPlatformNews();
  return NextResponse.json(items, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
