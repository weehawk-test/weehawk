"use client";

import { useLayoutEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSession } = useAuth();

  useLayoutEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      router.replace(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    const userId = Number(searchParams.get("user_id") ?? "0");
    const email = searchParams.get("email") ?? "";
    const firstName = searchParams.get("first_name") ?? "";
    const lastName = searchParams.get("last_name") ?? "";
    const imageUrl = searchParams.get("image_url");
    const providerRaw = searchParams.get("provider")?.trim().toUpperCase();
    const provider =
      providerRaw === "LOCAL" || providerRaw === "GOOGLE" ? providerRaw : "GOOGLE";
    const emailVerifiedRaw = searchParams.get("email_verified");
    const emailVerified =
      emailVerifiedRaw === "true" || (emailVerifiedRaw == null && provider === "GOOGLE");

    if (!userId || !email) {
      router.replace("/login?error=OAuth%20callback%20is%20missing%20required%20fields");
      return;
    }

    setSession({
      userId,
      email,
      firstName,
      lastName,
      provider,
      emailVerified,
      imageUrl: imageUrl && imageUrl.trim() ? imageUrl : null,
    });
    router.replace("/");
  }, [router, searchParams, setSession]);

  return null;
}
