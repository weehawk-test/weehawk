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
  title: "Weehawk Platform",
  description: "Webhook and deployment management",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await fetchUserProfileSSR();
  const initialUser = profile
    ? { email: profile.email, firstName: profile.firstName, lastName: profile.lastName }
    : null;

  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontMono.variable} h-full`}
      style={{ backgroundColor: "hsl(0, 0%, 2%)" }}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background">
        <Providers initialUser={initialUser}>{children}</Providers>
      </body>
    </html>
  );
}
