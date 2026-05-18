import {
  ensureComposeNamedVolumesDeclared,
  extractNamedVolumeMountsFromCompose,
} from './compose-volume-normalize';

describe('compose-volume-normalize', () => {
  const pgadminSnippet = `
services:
  pgadmin:
    image: dpage/pgadmin4:latest
    volumes:
      - 'pgadmin-data:/var/lib/pgadmin'
`.trim();

  it('detects named volume mounts', () => {
    expect(extractNamedVolumeMountsFromCompose(pgadminSnippet)).toEqual([
      'pgadmin-data',
    ]);
  });

  it('adds top-level volumes block when missing', () => {
    const out = ensureComposeNamedVolumesDeclared(pgadminSnippet);
    expect(out).toContain('volumes:');
    expect(out).toContain('pgadmin-data:');
    expect(out).toContain('driver: local');
  });

  it('does not duplicate existing declarations', () => {
    const withVol = `${pgadminSnippet}

volumes:
  pgadmin-data:
    driver: local
`;
    expect(ensureComposeNamedVolumesDeclared(withVol)).toBe(withVol);
  });

  it('ignores bind mounts', () => {
    const bind = `
services:
  app:
    volumes:
      - /host/data:/data
      - ./local:/app
`;
    expect(ensureComposeNamedVolumesDeclared(bind).trim()).toBe(bind.trim());
  });
});
