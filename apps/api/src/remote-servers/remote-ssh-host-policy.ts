import { BadRequestException } from '@nestjs/common';
import * as net from 'net';
import { promises as dns } from 'dns';
import { domainToASCII } from 'node:url';

/** Shown when a user-supplied host resolves to or equals a blocked network. */
export const REMOTE_SSH_HOST_POLICY_HINT =
  'Private, loopback, link-local, and similar addresses are not allowed for remote SSH hosts on this instance. Use a publicly reachable server.';

const blocklist = buildRemoteSshBlocklist();

function buildRemoteSshBlocklist(): net.BlockList {
  const b = new net.BlockList();
  b.addSubnet('0.0.0.0', 8, 'ipv4');
  b.addSubnet('10.0.0.0', 8, 'ipv4');
  b.addSubnet('127.0.0.0', 8, 'ipv4');
  b.addSubnet('169.254.0.0', 16, 'ipv4');
  b.addSubnet('172.16.0.0', 12, 'ipv4');
  b.addSubnet('192.168.0.0', 16, 'ipv4');
  b.addSubnet('100.64.0.0', 10, 'ipv4');
  b.addSubnet('224.0.0.0', 4, 'ipv4');
  b.addSubnet('240.0.0.0', 4, 'ipv4');
  b.addAddress('::1', 'ipv6');
  b.addSubnet('fe80::', 10, 'ipv6');
  b.addSubnet('fc00::', 7, 'ipv6');
  b.addSubnet('ff00::', 8, 'ipv6');
  // Do NOT add ::ffff:0:0/96 here. In Node.js, BlockList checks IPv4 literals against IPv6
  // rules too by mapping them to ::ffff:a.b.c.d; a /96 here would mark every public IPv4 as blocked.
  return b;
}

export function isRemoteSshIpBlocked(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return blocklist.check(ip, 'ipv4');
  if (v === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped IPv6: only apply private/bogon rules to the embedded IPv4 (see ::ffff note above).
    if (lower.startsWith('::ffff:')) {
      const tail = lower.slice(7);
      if (net.isIP(tail) === 4) return blocklist.check(tail, 'ipv4');
    }
    return blocklist.check(ip, 'ipv6');
  }
  return false;
}

function stripIpv6Brackets(host: string): string {
  const t = host.trim();
  if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1).trim();
  return t;
}

function assertHostnameNotReserved(hostname: string): void {
  let ascii: string;
  try {
    ascii = domainToASCII(hostname.trim());
  } catch {
    throw new BadRequestException(
      `Invalid SSH host name. ${REMOTE_SSH_HOST_POLICY_HINT}`,
    );
  }
  const lower = ascii.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) {
    throw new BadRequestException(
      `SSH host "${hostname}" is not allowed (localhost). ${REMOTE_SSH_HOST_POLICY_HINT}`,
    );
  }
  if (lower === 'local' || lower.endsWith('.local')) {
    throw new BadRequestException(
      `SSH host "${hostname}" is not allowed (.local). ${REMOTE_SSH_HOST_POLICY_HINT}`,
    );
  }
  if (
    lower === 'metadata.google.internal' ||
    lower.endsWith('.metadata.google.internal')
  ) {
    throw new BadRequestException(
      `SSH host "${hostname}" is not allowed. ${REMOTE_SSH_HOST_POLICY_HINT}`,
    );
  }
}

/**
 * Ensures `host` is not an SSRF-style target: blocks literals and hostnames that resolve only to blocked IPs.
 */
export async function assertPublicRemoteSshHost(host: string): Promise<void> {
  const raw = stripIpv6Brackets(host);
  if (!raw) {
    throw new BadRequestException(
      `SSH host is required. ${REMOTE_SSH_HOST_POLICY_HINT}`,
    );
  }

  const asIp = net.isIP(raw);
  if (asIp === 4 || asIp === 6) {
    if (isRemoteSshIpBlocked(raw)) {
      throw new BadRequestException(
        `SSH host "${host}" is not a publicly reachable address. ${REMOTE_SSH_HOST_POLICY_HINT}`,
      );
    }
    return;
  }

  assertHostnameNotReserved(raw);

  const v4 = await dns.resolve4(raw).catch(() => [] as string[]);
  const v6 = await dns.resolve6(raw).catch(() => [] as string[]);
  const ips = [...new Set([...v4, ...v6])];
  if (ips.length === 0) {
    throw new BadRequestException(
      `Could not resolve SSH host "${raw}" to an IP address. Check DNS or use a public IP. ${REMOTE_SSH_HOST_POLICY_HINT}`,
    );
  }
  if (ips.length > 32) {
    throw new BadRequestException(
      `SSH host "${raw}" resolves to too many addresses (${ips.length}). Use a hostname with fewer records.`,
    );
  }
  for (const ip of ips) {
    if (isRemoteSshIpBlocked(ip)) {
      throw new BadRequestException(
        `SSH host "${raw}" resolves to a non-public address (${ip}). ${REMOTE_SSH_HOST_POLICY_HINT}`,
      );
    }
  }
}

/** `publicIpv4` column: must be a public IPv4 when policy is enforced. */
export function assertPublicRemoteIpv4Literal(ip: string): void {
  if (net.isIP(ip) !== 4) {
    throw new BadRequestException(
      `publicIpv4 must be a dotted IPv4 address. ${REMOTE_SSH_HOST_POLICY_HINT}`,
    );
  }
  if (isRemoteSshIpBlocked(ip)) {
    throw new BadRequestException(
      `publicIpv4 "${ip}" is not a publicly reachable address. ${REMOTE_SSH_HOST_POLICY_HINT}`,
    );
  }
}
