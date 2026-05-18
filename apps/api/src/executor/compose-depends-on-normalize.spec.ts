import { ensureComposeDependsOnListForSwarm } from './compose-depends-on-normalize';

describe('compose-depends-on-normalize', () => {
  const mapStyle = `
services:
  activepieces:
    image: activepieces/activepieces:latest
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:80"]
  postgres:
    image: postgres:16
  redis:
    image: redis:7
`.trim();

  it('converts map depends_on to list for swarm', () => {
    const out = ensureComposeDependsOnListForSwarm(mapStyle);
    expect(out).toContain('depends_on:');
    expect(out).toContain('- postgres');
    expect(out).toContain('- redis');
    expect(out).not.toContain('condition: service_healthy');
  });

  it('leaves list-style depends_on unchanged', () => {
    const listStyle = `
services:
  app:
    depends_on:
      - db
      - cache
`.trim();
    expect(ensureComposeDependsOnListForSwarm(listStyle).trim()).toBe(
      listStyle,
    );
  });
});
