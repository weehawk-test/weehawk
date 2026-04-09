import fs from "node:fs/promises";
import path from "node:path";

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function rmRf(p: string) {
  if (!(await exists(p))) return;
  await fs.rm(p, { recursive: true, force: true });
}

async function mkdirp(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function copyDir(src: string, dest: string) {
  const stat = await fs.stat(src);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${src}`);
  await mkdirp(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (e) => {
      const from = path.join(src, e.name);
      const to = path.join(dest, e.name);
      if (e.isDirectory()) return copyDir(from, to);
      if (e.isSymbolicLink()) return;
      await fs.copyFile(from, to);
    }),
  );
}

function repoRootFromDesktopApp() {
  // apps/desktop/dist or apps/desktop/src -> repo root
  return path.resolve(__dirname, "..", "..", "..");
}

async function main() {
  const repoRoot = repoRootFromDesktopApp();
  const desktopRoot = path.join(repoRoot, "apps", "desktop");
  const outRoot = path.join(desktopRoot, ".dist-resources");

  const apiDist = path.join(repoRoot, "apps", "api", "dist");
  const webStandalone = path.join(repoRoot, "apps", "web", ".next", "standalone");
  const webStatic = path.join(repoRoot, "apps", "web", ".next", "static");
  const webPublic = path.join(repoRoot, "apps", "web", "public");

  if (!(await exists(apiDist))) {
    throw new Error(`Missing api dist folder: ${apiDist}. Run: pnpm --filter api build`);
  }
  if (!(await exists(webStandalone))) {
    throw new Error(
      `Missing Next standalone output: ${webStandalone}. Run: pnpm --filter web build`,
    );
  }

  await rmRf(outRoot);
  await mkdirp(outRoot);

  await copyDir(apiDist, path.join(outRoot, "api", "dist"));
  await copyDir(webStandalone, path.join(outRoot, "web"));
  await copyDir(webStatic, path.join(outRoot, "web", ".next", "static"));
  if (await exists(webPublic)) {
    await copyDir(webPublic, path.join(outRoot, "web", "public"));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

