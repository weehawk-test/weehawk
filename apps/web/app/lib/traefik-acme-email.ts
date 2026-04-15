/** Emails that must not be used as Let's Encrypt contacts (defaults / test values). */
const BLOCKED_ACME_CONTACT_EMAILS = new Set(
  ["admin@example.com", "admin@test.com", "test@test.com"].map((e) => e.toLowerCase()),
);

export function isBlockedAcmeContactEmail(email: string): boolean {
  return BLOCKED_ACME_CONTACT_EMAILS.has(email.trim().toLowerCase());
}

export function isValidEmailShape(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** Saved ACME email is valid for provision: real address, not a blocked placeholder. */
export function isLetsEncryptEmailConfigured(acmeEmail: string | null | undefined): boolean {
  const t = (acmeEmail ?? "").trim();
  if (!t || !isValidEmailShape(t)) return false;
  if (isBlockedAcmeContactEmail(t)) return false;
  return true;
}
