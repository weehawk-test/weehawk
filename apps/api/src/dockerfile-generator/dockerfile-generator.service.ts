import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  detectStackKind,
  hasUserDockerfileAtContextRoot,
  type DetectedStackKind,
} from './dockerfile-detector';
import {
  goDistrolessDockerfile,
  nodeMultiStageDockerfile,
  pythonAlpineDockerfile,
  staticNginxDockerfile,
} from './dockerfile-templates';

export type DockerfileGenerationResult =
  | { usedUserDockerfile: true; kind: 'user-dockerfile' }
  | { usedUserDockerfile: false; kind: DetectedStackKind; writtenPath: string };

@Injectable()
export class DockerfileGeneratorService {
  /**
   * If a Dockerfile exists at the build context root, do nothing (Dockerfile-first).
   * Otherwise detect stack and write `Dockerfile` into `contextDir`.
   */
  async ensureDockerfileForContext(
    contextDir: string,
    options: { port: number },
  ): Promise<DockerfileGenerationResult> {
    if (await hasUserDockerfileAtContextRoot(contextDir)) {
      return { usedUserDockerfile: true, kind: 'user-dockerfile' };
    }

    const kind = await detectStackKind(contextDir);
    const content = await this.buildDockerfileContent(contextDir, kind, options.port);
    const outPath = path.join(contextDir, 'Dockerfile');
    await fs.writeFile(outPath, content, 'utf8');
    return { usedUserDockerfile: false, kind, writtenPath: 'Dockerfile' };
  }

  private async buildDockerfileContent(
    contextDir: string,
    kind: DetectedStackKind,
    port: number,
  ): Promise<string> {
    switch (kind) {
      case 'node': {
        const variant = await this.detectNodeVariant(contextDir);
        await this.assertNodeRunnable(contextDir, variant);
        return nodeMultiStageDockerfile({ port, variant });
      }
      case 'go':
        return goDistrolessDockerfile({ port });
      case 'python':
        return pythonAlpineDockerfile({ port });
      case 'static':
        return staticNginxDockerfile();
      default:
        throw new BadRequestException(
          'Could not detect a supported stack. Add a Dockerfile at the build context root, or include ' +
            'package.json (Node), go.mod (Go), requirements.txt / pyproject.toml (Python), or index.html (static).',
        );
    }
  }

  private async assertNodeRunnable(
    contextDir: string,
    variant: 'next' | 'generic',
  ): Promise<void> {
    const raw = await fs.readFile(path.join(contextDir, 'package.json'), 'utf8');
    let pkg: { scripts?: Record<string, string> };
    try {
      pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    } catch {
      throw new BadRequestException('Invalid package.json in archive.');
    }
    if (!pkg.scripts?.start?.trim()) {
      throw new BadRequestException(
        'Node project must define a "start" script in package.json, or provide your own Dockerfile.',
      );
    }
    if (variant === 'next' && !pkg.scripts?.build?.trim()) {
      throw new BadRequestException(
        'Next.js projects must define a "build" script in package.json, or provide your own Dockerfile.',
      );
    }
  }

  private async detectNodeVariant(contextDir: string): Promise<'next' | 'generic'> {
    const raw = await fs.readFile(path.join(contextDir, 'package.json'), 'utf8');
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
    } catch {
      return 'generic';
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps && typeof deps === 'object' && 'next' in deps) {
      return 'next';
    }
    return 'generic';
  }

}
