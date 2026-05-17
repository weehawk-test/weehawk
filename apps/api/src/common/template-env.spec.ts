import {
  buildTemplateEnvVars,
  extractTemplateEnvKeysFromCompose,
  mergeTemplateDeployEnv,
} from './template-env';

describe('template-env', () => {
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
    const keys = extractTemplateEnvKeysFromCompose(activepiecesSnippet).map(
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
    const merged = mergeTemplateDeployEnv(
      activepiecesSnippet,
      { appName: 'ap', serviceName: 'Activepieces', templateId: 'activepieces' },
      { SERVICE_USER_POSTGRES: 'myuser' },
    );
    expect(merged.SERVICE_USER_POSTGRES).toBe('myuser');
    expect(merged.SERVICE_PASSWORD_POSTGRES?.length).toBeGreaterThan(8);
    expect(merged.SERVICE_PASSWORD_64_APIKEY?.length).toBeGreaterThan(16);
  });

  it('generates non-empty values for required keys', () => {
    const vars = buildTemplateEnvVars(activepiecesSnippet, {
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

  const infisicalSnippet = `
services:
  redis:
    environment:
      - ALLOW_EMPTY_PASSWORD=\${ALLOW_EMPTY_PASSWORD:-yes}
  backend:
    environment:
      - SMTP_HOST=\${SMTP_HOST}
      - INF_APP_CONNECTION_GITHUB_APP_CLIENT_ID=\${INF_APP_CONNECTION_GITHUB_APP_CLIENT_ID}
      - ENCRYPTION_KEY=\${SERVICE_PASSWORD_ENCRYPTIONKEY}
`;

  it('uses compose defaults instead of random values for flags like ALLOW_EMPTY_PASSWORD', () => {
    const vars = buildTemplateEnvVars(infisicalSnippet, {
      appName: 'inf',
      serviceName: 'Infisical',
      templateId: 'infisical',
    });
    expect(vars.ALLOW_EMPTY_PASSWORD).toBe('yes');
    expect(vars.SERVICE_PASSWORD_ENCRYPTIONKEY?.length).toBeGreaterThan(8);
  });

  it('keeps optional SMTP and GitHub integration keys empty in saved env', () => {
    const vars = buildTemplateEnvVars(infisicalSnippet, {
      appName: 'inf',
      serviceName: 'Infisical',
      templateId: 'infisical',
    });
    expect(vars.SMTP_HOST).toBe('');
    expect(vars.INF_APP_CONNECTION_GITHUB_APP_CLIENT_ID).toBe('');
  });
});
