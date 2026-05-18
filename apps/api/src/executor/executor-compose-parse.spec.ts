import {
  firstComposeServiceName,
  primaryComposeServiceNameForExec,
} from './executor-compose-parse';

describe('primaryComposeServiceNameForExec', () => {
  it('prefers the service with SERVICE_URL_* over the first dependency', () => {
    const yaml = `
services:
  postgres:
    image: postgres:16
  n8n:
    image: n8nio/n8n
    environment:
      - SERVICE_URL_N8N_5678
`;
    expect(firstComposeServiceName(yaml)).toBe('postgres');
    expect(primaryComposeServiceNameForExec(yaml)).toBe('n8n');
  });
});
