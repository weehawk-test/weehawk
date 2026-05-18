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

/** Swarm stack deploy requires `depends_on` as a list, not `service: { condition: ... }`. */
export function ensureComposeDependsOnListForSwarm(composeYaml: string): string {
  const lines = (composeYaml || "").split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const header = line.match(/^(\s*)depends_on:\s*(\{\})?\s*$/);
    if (!header) {
      out.push(line);
      i++;
      continue;
    }

    const baseIndent = header[1]!.length;
    const childIndent = baseIndent + 2;
    const childNameRe = new RegExp(
      `^\\s{${childIndent}}([a-zA-Z0-9][a-zA-Z0-9_.-]*):\\s*$`,
    );
    const listItemRe = new RegExp(`^\\s{${childIndent}}-\\s+`);

    let j = i + 1;
    const deps: string[] = [];
    let sawList = false;
    let sawMap = false;

    while (j < lines.length) {
      const l = lines[j]!;
      if (!l.trim() || l.trim().startsWith("#")) {
        j++;
        continue;
      }
      const indent = l.match(/^\s*/)?.[0]?.length ?? 0;
      if (indent <= baseIndent) break;

      if (listItemRe.test(l)) {
        sawList = true;
        break;
      }

      const nameMatch = l.match(childNameRe);
      if (nameMatch) {
        sawMap = true;
        deps.push(nameMatch[1]!);
        j++;
        continue;
      }

      if (sawMap && indent > childIndent) {
        j++;
        continue;
      }

      break;
    }

    if (sawMap && deps.length > 0 && !sawList) {
      out.push(`${header[1]}depends_on:`);
      for (const dep of deps) {
        out.push(`${" ".repeat(childIndent)}- ${dep}`);
      }
      i = j;
      continue;
    }

    out.push(line);
    i++;
  }

  return out.join("\n");
}

/** Normalize template compose before save / deploy (volumes, depends_on for Swarm-style YAML). */
export function normalizeTemplateComposeForDeploy(composeYaml: string): string {
  let c = composeYaml;
  c = ensureComposeNamedVolumesDeclared(c);
  c = ensureComposeDependsOnListForSwarm(c);
  return c;
}
