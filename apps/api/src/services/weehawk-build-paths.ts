import * as fs from 'fs/promises';
import * as path from 'path';

/** Relative path inside the build context for a Weehawk-generated Dockerfile (e.g. from future auto-detect flows). */
export const WEEHAWK_GENERATED_DOCKERFILE_REL = '.weehawk/generated.Dockerfile';

/**
 * If `.weehawk/generated.Dockerfile` exists under the build context, it wins over the
 * header `dockerfilePath` (used by isolated `docker build -f` inside the builder container).
 */
export async function resolveEffectiveDockerfileRel(
  fullContextPath: string,
  dockerfilePathFromConfig: string,
): Promise<{ relativePath: string; usedGenerated: boolean }> {
  const generatedAbs = path.join(fullContextPath, WEEHAWK_GENERATED_DOCKERFILE_REL);
  const hasGenerated = await fs
    .access(generatedAbs)
    .then(() => true)
    .catch(() => false);
  if (hasGenerated) {
    return {
      relativePath: WEEHAWK_GENERATED_DOCKERFILE_REL.replace(/\\/g, '/'),
      usedGenerated: true,
    };
  }
  return {
    relativePath: dockerfilePathFromConfig.replace(/\\/g, '/'),
    usedGenerated: false,
  };
}

/**
 * Writes a generated Dockerfile under `.weehawk/` for use on the next deploy build.
 * Call from upload or codegen paths that produce a Dockerfile without user-supplied file.
 */
export async function writeWeehawkGeneratedDockerfile(
  fullContextPath: string,
  dockerfileContents: string,
): Promise<{ relativePath: string }> {
  const dir = path.join(fullContextPath, '.weehawk');
  await fs.mkdir(dir, { recursive: true });
  const abs = path.join(fullContextPath, WEEHAWK_GENERATED_DOCKERFILE_REL);
  await fs.writeFile(abs, dockerfileContents, 'utf8');
  return { relativePath: WEEHAWK_GENERATED_DOCKERFILE_REL.replace(/\\/g, '/') };
}
