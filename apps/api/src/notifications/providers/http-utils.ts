export function readString(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}
