/**
 * Mirror of apps/api/src/executor/compose-volume-normalize.ts for template compose at create time.
 */

const NAMED_MOUNT =
  /^\s*-\s*(?:['"]([a-zA-Z][a-zA-Z0-9_.-]*)|([a-zA-Z][a-zA-Z0-9_.-]*)):(?:\/|\$\{)/;

function extractNamedVolumeMountsFromCompose(composeYaml: string): string[] {
  const names = new Set<string>();
  for (const line of (composeYaml || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = line.match(NAMED_MOUNT);
    if (!m) continue;
    const name = (m[1] ?? m[2])?.trim();
    if (!name || name.startsWith(".") || name.includes("/")) continue;
    names.add(name);
  }
  return Array.from(names).sort();
}

function extractDeclaredTopLevelVolumes(composeYaml: string): Set<string> {
  const declared = new Set<string>();
  const lines = (composeYaml || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^volumes:\s*(\{\})?\s*$/.test(line)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      const trimmed = l.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (/^\S/.test(l) && !/^[a-zA-Z_][\w.-]*:\s*$/.test(trimmed)) break;
      const keyMatch = trimmed.match(/^([a-zA-Z_][\w.-]*):\s*$/);
      if (keyMatch) {
        declared.add(keyMatch[1]!);
        continue;
      }
      if (/^\S/.test(l)) break;
    }
    break;
  }
  return declared;
}

export function ensureComposeNamedVolumesDeclared(composeYaml: string): string {
  const raw = (composeYaml || "").trim();
  if (!raw) return composeYaml;

  const used = extractNamedVolumeMountsFromCompose(raw);
  if (used.length === 0) return composeYaml;

  const declared = extractDeclaredTopLevelVolumes(raw);
  const missing = used.filter((n) => !declared.has(n));
  if (missing.length === 0) return composeYaml;

  const blocks = missing.map((name) => `  ${name}:\n    driver: local`).join("\n");

  if (declared.size > 0) {
    return `${composeYaml.replace(/\s*$/, "")}\n${blocks}\n`;
  }

  return `${composeYaml.replace(/\s*$/, "")}\n\nvolumes:\n${blocks}\n`;
}
