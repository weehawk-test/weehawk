import type { ReactNode } from "react";
import { PlatformNewsReadSync } from "./platform-news-read-sync";

export default function NewsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlatformNewsReadSync />
      {children}
    </>
  );
}
