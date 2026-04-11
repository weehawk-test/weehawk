/**
 * True when an SSH "remote" target is the API machine itself (loopback).
 * Such hosts must not be deploy targets — use a real remote host for stacks/containers.
 */
export function isLoopbackSshHost(raw: string): boolean {
  const t = raw.trim();
  const lower = t.toLowerCase();
  return (
    lower === 'localhost' ||
    t === '127.0.0.1' ||
    lower === '::1' ||
    lower === '[::1]'
  );
}
