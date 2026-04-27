import { existsSync, readFileSync } from "fs";

/**
 * Server-side API key resolver.
 * Priority:
 * 1) `WEEHAWK_API_KEY`
 * 2) file pointed by `WEEHAWK_API_KEY_FILE` (Docker secrets style)
 */
export function getServerApiKey(): string {
  const direct = (process.env.WEEHAWK_API_KEY ?? "").trim();
  if (direct) return direct;

  const filePath = (process.env.WEEHAWK_API_KEY_FILE ?? "").trim();
  if (!filePath) return "";

  try {
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

