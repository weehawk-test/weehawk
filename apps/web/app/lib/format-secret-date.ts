import { format } from "date-fns";

/** Docker / API timestamps may be non-ISO; avoid throwing from date-fns on invalid input. */
export function formatSecretDate(value: string) {
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return format(d, "MMM d, yyyy");
  const s = value.trim();
  return s.length > 24 ? `${s.slice(0, 24)}…` : s || "—";
}
