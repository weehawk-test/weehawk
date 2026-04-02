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
  | 'spring-boot'
  | 'python'
  | 'static'
  | 'unknown';

function isSpringBootMavenContent(pomXml: string): boolean {
  return /spring-boot-starter-parent|spring-boot-maven-plugin|spring-boot\.version|org\.springframework\.boot/i.test(
    pomXml,
  );
}

function isSpringBootGradleContent(gradle: string): boolean {
  return /org\.springframework\.boot|spring-boot-starter|spring-boot-gradle-plugin|spring-boot\.plugins/i.test(
    gradle,
  );
}

async function readUtf8IfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** True when pom.xml or Gradle build files indicate a Spring Boot project. */
export async function detectSpringBoot(contextDir: string): Promise<boolean> {
  const pom = await readUtf8IfExists(path.join(contextDir, 'pom.xml'));
  if (pom && isSpringBootMavenContent(pom)) return true;
  for (const name of ['build.gradle', 'build.gradle.kts']) {
    const g = await readUtf8IfExists(path.join(contextDir, name));
    if (g && isSpringBootGradleContent(g)) return true;
  }
  return false;
}

/** Prefer Maven when pom.xml is Spring Boot; otherwise Gradle if Spring Boot Gradle files exist. */
export async function detectSpringBootBuildTool(
  contextDir: string,
): Promise<'maven' | 'gradle'> {
  const pom = await readUtf8IfExists(path.join(contextDir, 'pom.xml'));
  if (pom && isSpringBootMavenContent(pom)) return 'maven';
  for (const name of ['build.gradle', 'build.gradle.kts']) {
    const g = await readUtf8IfExists(path.join(contextDir, name));
    if (g && isSpringBootGradleContent(g)) return 'gradle';
  }
  return 'maven';
}

/**
 * Priority: Node (package.json) > Go > Spring Boot > Python > static (index.html only when nothing else matches).
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
  if (await detectSpringBoot(contextDir)) return 'spring-boot';
  if (await has('requirements.txt') || (await has('pyproject.toml'))) return 'python';
  if (await has('index.html')) return 'static';
  return 'unknown';
}
