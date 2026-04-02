import * as fs from 'fs/promises';
import * as path from 'path';

const DOCKERFILE_NAMES = /^dockerfile(\.[^/]*)?$/i;

/**
 * True if a Dockerfile exists at the root of the build context (user-provided).
 */
export async function hasUserDockerfileAtContextRoot(contextDir: string): Promise<boolean> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(contextDir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((e) => e.isFile() && DOCKERFILE_NAMES.test(e.name));
}

export type DetectedStackKind =
  | 'node'
  | 'go'
  | 'python'
  | 'static'
  | 'unknown';

/**
 * Priority: Node (package.json) > Go > Python > static (index.html only when nothing else matches).
 */
export async function detectStackKind(contextDir: string): Promise<DetectedStackKind> {
  const has = async (name: string) => {
    try {
      await fs.access(path.join(contextDir, name));
      return true;
    } catch {
      return false;
    }
  };

  if (await has('package.json')) return 'node';
  if (await has('go.mod')) return 'go';
  if (await has('requirements.txt') || (await has('pyproject.toml'))) return 'python';
  if (await has('index.html')) return 'static';
  return 'unknown';
}
