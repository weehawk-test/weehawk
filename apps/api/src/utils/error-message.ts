import { HttpException } from '@nestjs/common';

/**
 * Human-readable message for any thrown value (AWS SDK, Nest HttpException, plain objects).
 */
export function formatUnknownError(e: unknown): string {
  if (e == null) return 'Unknown error (null or undefined)';
  if (typeof e === 'string') return e.trim() || '(empty string)';
  if (typeof e === 'number' || typeof e === 'boolean') return String(e);
  if (e instanceof Error) {
    const m = e.message?.trim();
    if (m) return m;
    const name = e.name && e.name !== 'Error' ? e.name : '';
    const cause = (e as { cause?: unknown }).cause;
    const withCause =
      cause !== undefined && cause !== null ? formatUnknownError(cause) : '';
    if (name || withCause) return [name, withCause].filter(Boolean).join(': ');
    return 'Error without message';
  }
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const msg = o.message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
    const name = typeof o.name === 'string' ? o.name : '';
    const code =
      typeof o.Code === 'string'
        ? o.Code
        : typeof o.code === 'string'
          ? o.code
          : '';
    const meta = o.$metadata as Record<string, unknown> | undefined;
    const status = meta?.httpStatusCode;
    const reqId = meta?.requestId;
    const parts: string[] = [];
    if (name) parts.push(name);
    if (code) parts.push(code);
    if (status !== undefined) parts.push(`HTTP ${String(status)}`);
    if (reqId !== undefined) parts.push(`requestId=${String(reqId)}`);
    if (parts.length) return parts.join(' ');
    try {
      const j = JSON.stringify(e);
      if (j && j !== '{}') return j;
    } catch {
      /* ignore */
    }
  }
  try {
    return String(e);
  } catch {
    return 'Unknown error';
  }
}

export function getErrorMessage(e: unknown): string {
  if (e instanceof HttpException) {
    const r = e.getResponse();
    if (typeof r === 'string' && r.trim()) return r.trim();
    if (typeof r === 'object' && r && r !== null) {
      const o = r as Record<string, unknown>;
      const m = o.message;
      if (typeof m === 'string' && m.trim()) return m.trim();
      if (Array.isArray(m)) return m.map(String).join('; ');
      const err = o.error;
      if (typeof err === 'string' && err.trim()) return err.trim();
    }
    const em = e.message?.trim();
    if (em) return em;
  }
  if (e instanceof Error) {
    const m = e.message?.trim();
    if (m) return m;
  }
  return formatUnknownError(e);
}
