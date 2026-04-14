"use client";

import { useLayoutEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { writeStoredSession } from "@/lib/auth-storage";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useLayoutEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      router.replace(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    const accessToken = searchParams.get("access_token") ?? "";
    const refreshToken = searchParams.get("refresh_token") ?? "";
    const userId = Number(searchParams.get("user_id") ?? "0");
    const email = searchParams.get("email") ?? "";
    const firstName = searchParams.get("first_name") ?? "";
    const lastName = searchParams.get("last_name") ?? "";
    const imageUrl = searchParams.get("image_url");

    if (!accessToken || !refreshToken || !userId || !email) {
      router.replace("/login?error=OAuth%20callback%20is%20missing%20required%20fields");
      return;
    }

    writeStoredSession({
      accessToken,
      refreshToken,
      user: {
        userId,
        email,
        firstName,
        lastName,
        imageUrl: imageUrl && imageUrl.trim() ? imageUrl : null,
      },
    });
    router.replace("/");
  }, [router, searchParams]);

  return null;
}

