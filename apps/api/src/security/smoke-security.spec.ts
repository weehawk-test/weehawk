jest.mock('../org-realtime/org-realtime-emitter.service', () => ({
  OrgRealtimeEmitter: jest.fn().mockImplementation(() => ({
    notifyOrgDataChanged: jest.fn(),
  })),
}));

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_ACCESS_COOKIE } from '../auth/auth-cookies';
import { GitService } from '../git/git.service';
import { RegistryService } from '../registry/registry.service';
import {
  OrganizationResourceScopedRepository,
  ProjectTenantScopedRepository,
} from '../common/tenant-scoped.service';

describe('Security Smoke Suite', () => {
  describe('Outbound Git Check', () => {
    it('resolves and uses pinned endpoint for GitHub HTTPS URL', async () => {
      const svc = new GitService(
        { get: jest.fn() } as unknown as ConfigService,
        {} as never,
        { notifyOrgDataChanged: jest.fn() } as never,
      ) as unknown as {
        fetchPinnedWithValidation: (
          url: string,
          options?: Record<string, unknown>,
        ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
        assertPublicHttpEndpoint: (url: string, label: string) => Promise<{
          url: string;
          hostname: string;
          ipAddress: string;
        }>;
        singlePinnedRequest: (
          endpoint: { url: string; hostname: string; ipAddress: string },
          options: { method: string; headers: Record<string, string>; body?: string },
        ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
      };

      const assertSpy = jest
        .spyOn(svc as any, 'assertPublicHttpEndpoint')
        .mockResolvedValue({
          url: 'https://api.github.com/repos/octocat/Hello-World',
          hostname: 'api.github.com',
          ipAddress: '140.82.113.5',
        });
      const singleSpy = jest
        .spyOn(svc as any, 'singlePinnedRequest')
        .mockResolvedValue({
          status: 200,
          headers: {},
          body: '{"ok":true}',
        });

      const res = await svc.fetchPinnedWithValidation(
        'https://api.github.com/repos/octocat/Hello-World',
        {
          headers: { Accept: 'application/json' },
          label: 'GitHub API URL',
        },
      );

      expect(res.status).toBe(200);
      expect(assertSpy).toHaveBeenCalledWith(
        'https://api.github.com/repos/octocat/Hello-World',
        'GitHub API URL',
      );
      expect(singleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'api.github.com',
          ipAddress: '140.82.113.5',
        }),
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });
  });

  describe('Registry Auth Check', () => {
    it('validates credentials through pinned requests and auth headers', async () => {
      const svc = new RegistryService(
        {} as never,
        { get: jest.fn() } as unknown as ConfigService,
        { notifyOrgDataChanged: jest.fn() } as never,
      ) as unknown as {
        assertRegistryCredentialsValid: (
          providerUrl: string,
          username: string,
          password: string,
        ) => Promise<void>;
      };

      jest
        .spyOn(svc as any, 'assertPublicRegistryEndpoint')
        .mockResolvedValue({
          url: 'https://registry-1.docker.io',
          hostname: 'registry-1.docker.io',
          ipAddress: '44.205.64.79',
        });

      const requestSpy = jest
        .spyOn(svc as any, 'requestWithPinnedIp')
        .mockResolvedValueOnce({
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull"',
          },
          body: '',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: '{"token":"abc"}',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: '',
        });

      await svc.assertRegistryCredentialsValid('docker.io', 'alice', 'secret');

      expect(requestSpy).toHaveBeenCalledTimes(3);
      expect(requestSpy).toHaveBeenNthCalledWith(
        2,
        'https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Falpine%3Apull&account=alice',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        }),
      );
      expect(requestSpy).toHaveBeenNthCalledWith(
        3,
        'https://registry-1.docker.io/v2/',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer abc',
          }),
        }),
      );
    });
  });

  describe('Resource Access Check', () => {
    it('scopes findScoped for RemoteServer by organization membership and Service by project org', async () => {
      const membershipRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 1 }),
      };
      const remoteQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ id: 10 }),
      };
      const remoteRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(remoteQb),
        findOne: jest.fn().mockResolvedValue({ id: 10, organizationId: 1 }),
      };
      const scopedRemote =
        new OrganizationResourceScopedRepository<{
          id: number;
          organizationId: number;
        }>(remoteRepo as never, membershipRepo as never, 'Remote server');
      await scopedRemote.findScoped(10, 77);
      expect(remoteRepo.createQueryBuilder).toHaveBeenCalledWith('e');
      expect(remoteQb.getRawOne).toHaveBeenCalled();

      const qb = {
        select: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ id: 4 }),
      };
      const serviceRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        findOne: jest.fn().mockResolvedValue({ id: 4 }),
      };
      const scopedService = new ProjectTenantScopedRepository<{ id: number }>(
        serviceRepo as never,
        'Service',
      );
      await scopedService.findScoped(4, 77);
      expect(serviceRepo.createQueryBuilder).toHaveBeenCalledWith('e');
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('organization_id'),
        expect.objectContaining({ userId: 77 }),
      );
      expect(serviceRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 4 }),
        }),
      );
    });
  });

  describe('WebSocket Handshake', () => {
    it('resolves serverId for user during remote terminal handshake', async () => {
      jest.resetModules();
      jest.doMock('../remote-servers/remote-servers.service', () => ({
        RemoteServersService: class RemoteServersServiceMock {},
      }));
      const { RemoteTerminalGateway } = require('../remote-servers/remote-terminal.gateway') as {
        RemoteTerminalGateway: new (
          remoteServersService: unknown,
          jwtService: unknown,
        ) => {
          handleConnection: (client: unknown, ...args: unknown[]) => Promise<void>;
        };
      };

      const remoteServersService = {
        resolveServerIdForUser: jest.fn().mockResolvedValue(42),
        getSshTerminalContext: jest
          .fn()
          .mockRejectedValue(new BadRequestException('stop after resolve')),
        clearPendingSshHostKeyForServer: jest.fn(),
      };
      const jwtService = {
        verifyAsync: jest.fn().mockResolvedValue({ userId: 7 }),
      };
      const gateway = new RemoteTerminalGateway(
        remoteServersService as never,
        jwtService as never,
      );

      const send = jest.fn();
      const close = jest.fn();
      const on = jest.fn();
      const client = { send, close, on, readyState: 1 } as any;
      const req = {
        headers: {
          origin: 'https://app.example.com',
          host: 'api.example.com',
          cookie: `${AUTH_ACCESS_COOKIE}=token123`,
        },
        url: '/ws/remote-terminal?serverId=rsv_abc123',
      } as any;
      const prevCors = process.env.CORS_ORIGIN;
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.CORS_ORIGIN = 'https://app.example.com';
      process.env.NODE_ENV = 'production';

      try {
        await gateway.handleConnection(client, req);
      } finally {
        process.env.CORS_ORIGIN = prevCors;
        process.env.NODE_ENV = prevNodeEnv;
      }

      expect(remoteServersService.resolveServerIdForUser).toHaveBeenCalledWith(
        'rsv_abc123',
        7,
      );
      expect(remoteServersService.getSshTerminalContext).toHaveBeenCalledWith(
        42,
        7,
      );
    });
  });
});

