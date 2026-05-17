import {
  buildCoolifyTemplateEnvVars,
  extractCoolifyEnvKeysFromCompose,
  mergeCoolifyTemplateDeployEnv,
} from './coolify-template-env';

describe('coolify-template-env', () => {
  const activepiecesSnippet = `
services:
  activepieces:
    environment:
      - SERVICE_FQDN_ACTIVEPIECES
      - AP_API_KEY=$SERVICE_PASSWORD_64_APIKEY
      - AP_ENCRYPTION_KEY=$SERVICE_PASSWORD_ENCRYPTIONKEY
      - AP_JWT_SECRET=$SERVICE_PASSWORD_64_JWT
  postgres:
    environment:
      - POSTGRES_PASSWORD=$SERVICE_PASSWORD_POSTGRES
      - POSTGRES_USER=$SERVICE_USER_POSTGRES
`;

  it('extracts all SERVICE_* keys from multi-service compose', () => {
    const keys = extractCoolifyEnvKeysFromCompose(activepiecesSnippet).map(
      (v) => v.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'SERVICE_FQDN_ACTIVEPIECES',
        'SERVICE_PASSWORD_64_APIKEY',
        'SERVICE_PASSWORD_64_JWT',
        'SERVICE_PASSWORD_ENCRYPTIONKEY',
        'SERVICE_PASSWORD_POSTGRES',
        'SERVICE_USER_POSTGRES',
      ]),
    );
  });

  it('merge fills missing keys without overwriting user values', () => {
    const merged = mergeCoolifyTemplateDeployEnv(
      activepiecesSnippet,
      { appName: 'ap', serviceName: 'Activepieces', templateId: 'activepieces' },
      { SERVICE_USER_POSTGRES: 'myuser' },
    );
    expect(merged.SERVICE_USER_POSTGRES).toBe('myuser');
    expect(merged.SERVICE_PASSWORD_POSTGRES?.length).toBeGreaterThan(8);
    expect(merged.SERVICE_PASSWORD_64_APIKEY?.length).toBeGreaterThan(16);
  });

  it('generates non-empty values for every extracted key', () => {
    const vars = buildCoolifyTemplateEnvVars(activepiecesSnippet, {
      appName: 'ap',
      serviceName: 'Activepieces',
      templateId: 'activepieces',
      templatePort: '80',
    });
    for (const [k, v] of Object.entries(vars)) {
      expect(v.trim().length).toBeGreaterThan(0);
      expect(k.length).toBeGreaterThan(0);
    }
  });
});
