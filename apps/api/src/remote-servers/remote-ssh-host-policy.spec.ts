import { isRemoteSshIpBlocked } from './remote-ssh-host-policy';

describe('isRemoteSshIpBlocked', () => {
  it('allows common public IPv4 literals', () => {
    expect(isRemoteSshIpBlocked('8.8.8.8')).toBe(false);
    expect(isRemoteSshIpBlocked('203.0.113.1')).toBe(false);
  });

  it('blocks RFC1918 and similar', () => {
    expect(isRemoteSshIpBlocked('10.0.0.1')).toBe(true);
    expect(isRemoteSshIpBlocked('192.168.1.1')).toBe(true);
    expect(isRemoteSshIpBlocked('127.0.0.1')).toBe(true);
  });

  it('evaluates IPv4-mapped IPv6 using the embedded IPv4 only', () => {
    expect(isRemoteSshIpBlocked('::ffff:8.8.8.8')).toBe(false);
    expect(isRemoteSshIpBlocked('::ffff:10.0.0.1')).toBe(true);
  });
});
