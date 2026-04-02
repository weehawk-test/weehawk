import * as fs from 'fs/promises';

export async function removeDeploymentFolder(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    console.error(`Could not remove directory: ${dir}`);
  }
}
