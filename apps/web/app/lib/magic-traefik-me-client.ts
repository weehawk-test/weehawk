import type { Service } from "@/lib/schema";

/** Browser-only default IPv4 for Magic traefik.me (set on /traefik). */
export const MAGIC_TRAEFIK_SITE_IPV4_STORAGE_KEY = "weehawk.magicTraefikMe.siteIpv4";

export function getMagicTraefikSiteIpv4(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(MAGIC_TRAEFIK_SITE_IPV4_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setMagicTraefikSiteIpv4(ip: string): void {
  if (typeof window === "undefined") return;
  try {
    if (ip.trim() === "") localStorage.removeItem(MAGIC_TRAEFIK_SITE_IPV4_STORAGE_KEY);
    else localStorage.setItem(MAGIC_TRAEFIK_SITE_IPV4_STORAGE_KEY, ip.trim());
  } catch {
    /* ignore */
  }
}

export const MAGIC_TRAEFIK_IPV4_CHANGED_EVENT = "weehawk-magic-ipv4-changed";

export function dispatchMagicTraefikIpv4Changed(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MAGIC_TRAEFIK_IPV4_CHANGED_EVENT));
}

export function subscribeMagicTraefikIpv4Changed(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MAGIC_TRAEFIK_IPV4_CHANGED_EVENT, cb);
  return () => window.removeEventListener(MAGIC_TRAEFIK_IPV4_CHANGED_EVENT, cb);
}

/**
 * IPv4 sent when rolling Magic traefik.me: per-service saved value, then site default (/traefik),
 * then deploy host, then browser hostname if it is an IPv4 literal.
 */
export function guessRollMagicIpv4(service: Service): string {
  const saved = service.magicTraefikMeIpv4?.trim();
  if (saved) return saved;
  const site = getMagicTraefikSiteIpv4();
  if (site) return site;
  const p = service.remoteServer?.publicIpv4?.trim();
  if (p) return p;
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) return h;
  }
  return "";
}

/** Hostname for Traefik routes from API magic URL (e.g. https://x.y.127.0.0.1.traefik.me/path → x.y.127.0.0.1.traefik.me). */
export function hostnameFromMagicUrl(url: string | null | undefined): string {
  if (!url?.trim()) return "";
  const s = url.trim();
  try {
    return new URL(s.startsWith("http") ? s : `https://${s}`).hostname;
  } catch {
    return s.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  }
}
