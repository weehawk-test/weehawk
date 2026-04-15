import type { ReactNode } from "react";
import { fetchPlatformNews } from "./platform-news";
import { PlatformNewsReadSync } from "./platform-news-read-sync";

export default async function NewsLayout({ children }: { children: ReactNode }) {
  const initialFeed = await fetchPlatformNews();
  return (
    <>
      <PlatformNewsReadSync initialFeed={initialFeed} />
      {children}
    </>
  );
}
