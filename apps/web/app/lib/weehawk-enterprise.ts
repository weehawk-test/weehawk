/** Default URL for enterprise / contact when the API does not override `enterpriseSalesUrl`. */
export const WEEHAWK_ENTERPRISE_SALES_URL_DEFAULT = "https://weehawk.io";

export function parseEnterpriseSalesUrl(raw: unknown): string {
  if (typeof raw === "string" && raw.trim() !== "") {
    const t = raw.trim();
    try {
      const u = new URL(t);
      if (u.protocol === "http:" || u.protocol === "https:") {
        return u.toString().replace(/\/$/, "") || WEEHAWK_ENTERPRISE_SALES_URL_DEFAULT;
      }
    } catch {
      /* ignore */
    }
  }
  return WEEHAWK_ENTERPRISE_SALES_URL_DEFAULT;
}

export function parseEnterpriseLicensed(raw: unknown): boolean {
  return raw === true;
}
