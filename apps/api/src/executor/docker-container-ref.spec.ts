import {
  extractDockerContainerIdFromOutput,
  firstNonEmptyCliLine,
  isDockerContainerId,
  looksLikeDockerContainerName,
} from './docker-container-ref';

describe('docker-container-ref', () => {
  it('accepts short and full hex ids', () => {
    expect(isDockerContainerId('a1b2c3d4e5f6')).toBe(true);
    expect(isDockerContainerId('a'.repeat(64))).toBe(true);
    expect(isDockerContainerId('wh-myapp-n8n')).toBe(false);
  });

  it('extracts id from noisy stdout', () => {
    expect(
      extractDockerContainerIdFromOutput(
        'WARN[0000] something\na1b2c3d4e5f6\n',
      ),
    ).toBe('a1b2c3d4e5f6');
  });

  it('detects container names', () => {
    expect(looksLikeDockerContainerName('wh-my-app-n8n')).toBe(true);
    expect(firstNonEmptyCliLine(' \nwh-my-app-n8n\n')).toBe('wh-my-app-n8n');
  });
});
