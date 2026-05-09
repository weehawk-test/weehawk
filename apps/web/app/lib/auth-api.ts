import { API_BASE } from "./api";

export type AuthSessionBody = {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  provider: "LOCAL" | "GOOGLE";
  imageUrl: string | null;
  emailVerified: boolean;
};

export type AuthUserSnapshot = {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  role?: string;
  provider?: "LOCAL" | "GOOGLE";
  emailVerified?: boolean;
  imageUrl?: string | null;
};

export type AuthStatus = {
  instanceMode: "cloud" | "self-hosted";
  userConfigured: boolean;
  registrationOpen: boolean;
};

export class AuthHttpError extends Error {
  readonly status: number;
  /** Seconds until the client may retry (from Retry-After), when rate-limited. */
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "AuthHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Throttler `Retry-After`: seconds in Nest default storage; older Redis adapter used raw ms (large integers).
 */
function parseRetryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return undefined;
  if (n > 86_400) return Math.max(1, Math.ceil(n / 1000));
  return Math.max(1, n);
}

async function parseError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const json = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(json.message)) return json.message.join(", ");
    if (typeof json.message === "string") return json.message;
  } catch {
    // ignore JSON parse errors
  }
  return raw || res.statusText || `HTTP ${res.status}`;
}

async function throwAuthHttpError(res: Response): Promise<never> {
  const retryAfterSeconds = res.status === 429 ? parseRetryAfterSeconds(res) : undefined;
  const message = await parseError(res);
  throw new AuthHttpError(message, res.status, retryAfterSeconds);
}

function toUserSnapshot(session: AuthSessionBody): AuthUserSnapshot {
  return {
    userId: session.userId,
    email: session.email,
    firstName: session.firstName,
    lastName: session.lastName,
    role: session.role,
    provider: session.provider,
    emailVerified: session.emailVerified,
    imageUrl: session.imageUrl,
  };
}

const jsonCredInit: RequestInit = {
  credentials: "include",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
};

export async function loginApi(input: {
  email: string;
  password: string;
}): Promise<{ user: AuthUserSnapshot }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    ...jsonCredInit,
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) return throwAuthHttpError(res);
  const session = (await res.json()) as AuthSessionBody;
  return { user: toUserSnapshot(session) };
}

export async function registerApi(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<{ user: AuthUserSnapshot }> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    ...jsonCredInit,
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) return throwAuthHttpError(res);
  const session = (await res.json()) as AuthSessionBody;
  return { user: toUserSnapshot(session) };
}

export async function getAuthStatusApi(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE}/api/auth/status`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });
  if (!res.ok) return throwAuthHttpError(res);
  return (await res.json()) as AuthStatus;
}

export async function logoutApi(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function forgotPasswordApi(input: { email: string }): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { message: string };
}

export async function resetPasswordApi(input: {
  token: string;
  newPassword: string;
}): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { message: string };
}
