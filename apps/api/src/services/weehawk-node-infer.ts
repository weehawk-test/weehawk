import * as fs from 'fs/promises';
import * as path from 'path';

/** Config files that imply a buildable Node frontend/API at this folder (with package.json). */
const FRAMEWORK_CONFIG_RES = [
  /^next\.config\.(js|cjs|mjs|ts)$/i,
  /^vite\.config\.(js|ts|mjs|cjs)$/i,
  /^nuxt\.config\.(js|ts|mjs)$/i,
  /^astro\.config\.(js|ts|mjs)$/i,
  /^svelte\.config\.(js|ts)$/i,
  /^remix\.config\.(js|ts|mjs)$/i,
  /^angular\.json$/i,
  /^gatsby-config\.(js|ts|mjs)$/i,
];

function hasPackageStartSignal(pkg: {
  scripts?: Record<string, string>;
  main?: string;
}): boolean {
  const start = pkg.scripts?.start?.trim();
  if (start) return true;
  if (typeof pkg.main === 'string' && pkg.main.trim()) return true;
  return false;
}

async function hasIndexEntry(dir: string): Promise<boolean> {
  for (const name of ['index.js', 'index.mjs', 'index.cjs']) {
    try {
      await fs.access(path.join(dir, name));
      return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

/** Common server entry files when package.json has no explicit start (some templates). */
async function hasCommonServerEntry(dir: string): Promise<boolean> {
  for (const name of ['server.js', 'server.mjs', 'server.cjs', 'app.js', 'main.js']) {
    try {
      await fs.access(path.join(dir, name));
      return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

async function hasFrameworkOrBundlerConfigAtRoot(dir: string): Promise<boolean> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(
    (e) => e.isFile() && FRAMEWORK_CONFIG_RES.some((re) => re.test(e.name)),
  );
}

/**
 * True if this directory looks like a runnable Node app root for buildpacks / generic tooling.
 */
export async function isNodeAppStartableAt(dir: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, 'package.json'), 'utf8');
  } catch {
    return false;
  }
  let pkg: { scripts?: Record<string, string>; main?: string };
  try {
    pkg = JSON.parse(raw) as { scripts?: Record<string, string>; main?: string };
  } catch {
    return false;
  }
  if (hasPackageStartSignal(pkg)) return true;
  if (await hasIndexEntry(dir)) return true;
  if (await hasFrameworkOrBundlerConfigAtRoot(dir)) return true;
  if (await hasCommonServerEntry(dir)) return true;
  return false;
}

export type NodeBuildContextInferResult =
  | { ok: true }
  | {
      ok: false;
      /** When buildPath was `.` and exactly one sub-app was found (e.g. apps/web). */
      suggestedBuildPath?: string;
      message: string;
    };

const SUBROOTS = ['apps', 'packages', 'services'] as const;

const IGNORE_TOP_LEVEL_DIR = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.husky',
  '.github',
  'out',
  'tmp',
  'temp',
  '__tests__',
  'e2e',
  'test',
  'tests',
  'docs',
  'scripts',
]);

function posixRel(...parts: string[]): string {
  return path.posix.join(...parts.map((p) => p.replace(/\\/g, '/')));
}

/**
 * Startable packages one level under `prefix` (e.g. apps), and one more level if the first is not startable (e.g. apps/web).
 */
async function collectStartableUnderMonorepoRoot(
  contextDir: string,
  prefix: string,
): Promise<string[]> {
  const out: string[] = [];
  const absRoot = path.join(contextDir, prefix);
  let stRoot: import('fs').Stats;
  try {
    stRoot = await fs.stat(absRoot);
  } catch {
    return out;
  }
  if (stRoot.isDirectory() && (await isNodeAppStartableAt(absRoot))) {
    out.push(prefix.replace(/\\/g, '/'));
  }
  let childNames: string[];
  try {
    childNames = await fs.readdir(absRoot);
  } catch {
    return out;
  }
  for (const name of childNames) {
    const abs = path.join(absRoot, name);
    let st: { isDirectory: () => boolean };
    try {
      st = await fs.stat(abs);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const rel = posixRel(prefix, name);
    if (await isNodeAppStartableAt(abs)) {
      out.push(rel);
      continue;
    }
    let subNames: string[];
    try {
      subNames = await fs.readdir(abs);
    } catch {
      continue;
    }
    for (const name2 of subNames) {
      const abs2 = path.join(abs, name2);
      let st2: { isDirectory: () => boolean };
      try {
        st2 = await fs.stat(abs2);
      } catch {
        continue;
      }
      if (!st2.isDirectory()) continue;
      const rel2 = posixRel(prefix, name, name2);
      if (await isNodeAppStartableAt(abs2)) {
        out.push(rel2);
      }
    }
  }
  return out;
}

async function collectStartableTopLevelDirs(contextDir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(contextDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    if (IGNORE_TOP_LEVEL_DIR.has(name) || name.startsWith('.')) continue;
    if ((SUBROOTS as readonly string[]).includes(name)) continue;
    const abs = path.join(contextDir, name);
    if (await isNodeAppStartableAt(abs)) {
      out.push(name.replace(/\\/g, '/'));
    }
  }
  return out;
}

const GENERIC_HINT =
  'Add a `start` script or `main` in package.json, add a framework config (e.g. vite.config / next.config), or use Dockerfile mode. ' +
  'If this is a monorepo, set build path to the app folder (e.g. apps/web).';

/**
 * For monorepos: if the requested context root is not startable, look under `apps/`, `packages/`, `services/`,
 * one extra nesting level, and top-level folders (e.g. `web/`).
 */
export async function inferNodeBuildContext(
  contextDir: string,
  options?: { buildPath: string },
): Promise<NodeBuildContextInferResult> {
  const buildPath = (options?.buildPath ?? '.').trim() || '.';

  if (await isNodeAppStartableAt(contextDir)) {
    return { ok: true };
  }

  const candidates: string[] = [];
  for (const root of SUBROOTS) {
    candidates.push(...(await collectStartableUnderMonorepoRoot(contextDir, root)));
  }
  candidates.push(...(await collectStartableTopLevelDirs(contextDir)));

  const unique = [...new Set(candidates)];

  if (unique.length === 1 && (buildPath === '.' || buildPath === '')) {
    return {
      ok: false,
      suggestedBuildPath: unique[0],
      message:
        `[Weehawk] Cannot infer how to start this Node app at project root. ` +
        `Detected a startable app at "${unique[0]}". Set build path to "${unique[0]}" in the upload form or use Dockerfile mode.`,
    };
  }

  if (unique.length > 1) {
    return {
      ok: false,
      message:
        `[Weehawk] Cannot infer how to start this Node app at project root. Multiple startable packages found: ${unique.join(', ')}. ` +
        `Set build path to the app folder (e.g. apps/web) or use Dockerfile mode.`,
    };
  }

  return {
    ok: false,
    message: `[Weehawk] Cannot infer how to start this Node app. ${GENERIC_HINT}`,
  };
}
