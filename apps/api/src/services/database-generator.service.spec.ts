import { DatabaseGeneratorService } from './database-generator.service';

describe('DatabaseGeneratorService', () => {
  const gen = new DatabaseGeneratorService();

  it('keeps internal overlay only when standalone', () => {
    const yaml = gen.buildDatabaseDockerConfig('postgres', 'mydb', 1);
    expect(yaml).toContain('# network.weehawk: standalone');
    expect(yaml).not.toContain('name: weehawk');
    expect(yaml).toContain('internal: true');
  });

  it('adds external weehawk network when attach is requested', () => {
    const yaml = gen.buildDatabaseDockerConfig(
      'postgres',
      'mydb',
      1,
      null,
      null,
      null,
      undefined,
      true,
    );
    expect(yaml).toContain('# network.weehawk: attach');
    expect(yaml).toContain('name: weehawk');
    expect(yaml).toContain('- weehawk-proxy');
  });
});
