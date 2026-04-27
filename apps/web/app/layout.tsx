import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/providers";
import { documentTitleFromPathname } from "@/lib/seo/page-title-from-pathname";
import { fetchUserProfileSSR } from "@/lib/ssr/fetch-user-profile";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  weight: ["400", "500", "600", "700"],
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "500"],
});

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const pathname = h.get("x-weehawk-pathname") ?? "";
  return {
    title: documentTitleFromPathname(pathname),
    description: "Webhook and deployment management",
  };
}

const THEME_COOKIE_KEY = "weehawk-theme";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = (cookieStore.get(THEME_COOKIE_KEY)?.value ?? "").trim();
  const initialTheme: "light" | "dark" = themeCookie === "light" ? "light" : "dark";
  const initialSidebarCollapsed = cookieStore.get("weehawk-sidebar-collapsed")?.value === "1";

  const profile = await fetchUserProfileSSR();
  const initialUser = profile
    ? {
        userId: profile.userId,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        provider: profile.provider,
        providerId: profile.providerId,
        googleAccountEmail: profile.googleAccountEmail,
        emailVerified: profile.emailVerified ?? false,
        imageUrl: profile.imageUrl ?? null,
      }
    : null;

  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontMono.variable} h-full ${initialTheme === "dark" ? "dark" : ""}`}
      style={{ ["--app-sidebar-width" as string]: initialSidebarCollapsed ? "4rem" : "16rem" }}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background">
        <Providers initialUser={initialUser} initialTheme={initialTheme}>{children}</Providers>
      </body>
    </html>
  );
}
