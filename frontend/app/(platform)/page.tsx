import { HomePageClient } from "./home-page-client";

/** Root route must stay a Server Component; client UI lives in `home-page-client.tsx` to avoid Turbopack mis-bundling `page.tsx` as RSC while it contains hooks. */
export default function Page() {
  return <HomePageClient />;
}
