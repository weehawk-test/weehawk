import { generatePublicId, isLikelyNumericId } from './public-id';

describe('public-id helpers', () => {
  it('generates a prefixed id', () => {
    const id = generatePublicId('svc');
    expect(id.startsWith('svc_')).toBe(true);
    expect(id.length).toBeGreaterThan(8);
  });

  it('detects numeric legacy identifiers', () => {
    expect(isLikelyNumericId('123')).toBe(true);
    expect(isLikelyNumericId('svc_123')).toBe(false);
  });
});
