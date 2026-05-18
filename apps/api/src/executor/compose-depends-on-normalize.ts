/**
 * Swarm `docker stack deploy` requires `depends_on` as a list. Template compose files
 * often use the long form (`service: { condition: ... }`), which stack deploy rejects.
 */

/**
 * Convert map-style `depends_on` blocks to `- service` lists (drops health conditions).
 */
export function ensureComposeDependsOnListForSwarm(
  composeYaml: string,
): string {
  const lines = (composeYaml || '').split(/\r?\n/);
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
      if (!l.trim() || l.trim().startsWith('#')) {
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
        out.push(`${' '.repeat(childIndent)}- ${dep}`);
      }
      i = j;
      continue;
    }

    out.push(line);
    i++;
  }

  return out.join('\n');
}
