"use client";

/** Dispatched after login / logout / session refresh so listeners can re-sync. */
export const AUTH_CHANGE_EVENT = "weehawk-auth-storage";

/**
 * Non-secret marker stored in React context so existing `Boolean(accessToken)` checks keep working.
 * JWTs and refresh tokens live in HttpOnly cookies on the API host only.
 */
export const COOKIE_SESSION_MARKER = "cookie-session";

export function notifyAuthChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  }
}
