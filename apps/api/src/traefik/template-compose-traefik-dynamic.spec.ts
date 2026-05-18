import {
  buildTemplateComposeTraefikDynamicYaml,
  templateComposeTraefikContainerName,
  templateComposeTraefikDynamicFilename,
} from './template-compose-traefik-dynamic';

describe('template-compose-traefik-dynamic', () => {
  it('builds file-provider yaml with router and backend URL', () => {
    const yaml = buildTemplateComposeTraefikDynamicYaml(
      {
        certResolver: 'letsencrypt',
        httpEntrypoint: 'web',
        httpsEntrypoint: 'websecure',
        routes: [
          {
            router: 'n8n',
            rule: 'Host(`n8n.example.com`)',
            port: 5678,
            https: true,
          },
        ],
      },
      'n8n',
      'wh-myapp-n8n',
    );
    expect(yaml).toContain('wh-tpl-n8n:');
    expect(yaml).toContain('Host(`n8n.example.com`)');
    expect(yaml).toContain('websecure');
    expect(yaml).toContain('url: "http://wh-myapp-n8n:5678"');
  });

  it('names dynamic files and containers safely', () => {
    expect(templateComposeTraefikDynamicFilename('My App!')).toBe(
      'weehawk-compose-my-app.yml',
    );
    expect(templateComposeTraefikContainerName('My App', 'n8n')).toBe(
      'wh-my-app-n8n',
    );
  });
});
