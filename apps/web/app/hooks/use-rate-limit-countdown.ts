"use client";

import { useEffect, useState } from "react";

export function formatRetryMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Live countdown until `blockedUntilMs` (epoch ms). Returns seconds left for disabling UI.
 */
export function useRateLimitCountdown(blockedUntilMs: number | null): {
  secondsLeft: number;
  label: string;
} {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!blockedUntilMs || blockedUntilMs <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [blockedUntilMs]);

  if (!blockedUntilMs) return { secondsLeft: 0, label: "" };
  const secondsLeft = Math.max(0, Math.ceil((blockedUntilMs - now) / 1000));
  return {
    secondsLeft,
    label: secondsLeft > 0 ? formatRetryMmSs(secondsLeft) : "",
  };
}
