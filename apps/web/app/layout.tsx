import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/providers";
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

export const metadata: Metadata = {
  title: "Weehawk",
  description: "Webhook and deployment management",
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('weehawk-theme');var dark=t!=='light';document.documentElement.classList.toggle('dark',dark);}catch(_e){document.documentElement.classList.remove('dark');}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await fetchUserProfileSSR();
  const initialUser = profile
    ? {
        userId: profile.userId,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        provider: profile.provider,
        emailVerified: profile.emailVerified ?? false,
        imageUrl: profile.imageUrl ?? null,
      }
    : null;

  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background">
        <Providers initialUser={initialUser}>{children}</Providers>
      </body>
    </html>
  );
}
