import { ProviderResult } from './provider.types';

export async function postJson(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<ProviderResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const text = await res.text();
    return { ok: false, description: text || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : 'Network error' };
  }
}

export async function postFormUrlEncoded(
  url: string,
  data: Record<string, string>,
): Promise<ProviderResult> {
  try {
    const body = new URLSearchParams(data);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (res.ok) return { ok: true };
    const text = await res.text();
    return { ok: false, description: text || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : 'Network error' };
  }
}

export function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

