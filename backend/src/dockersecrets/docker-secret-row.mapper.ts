export interface DockerSecretListItemDto {
  id: string;
  name: string;
  createdAt: string;
}

function pickStr(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).length) return String(v);
  }
  return '';
}

export function mapDockerSecretLsRow(
  row: Record<string, unknown>,
  index: number,
): DockerSecretListItemDto {
  const id = pickStr(row, 'ID', 'Id') || `secret-${index}`;
  const name = pickStr(row, 'Name');
  const createdAt =
    pickStr(row, 'createdAt', 'CreatedAt', 'Created') ||
    new Date().toISOString();
  return { id, name, createdAt };
}

export function filterSecrets(
  items: DockerSecretListItemDto[],
  q: string,
): DockerSecretListItemDto[] {
  const s = q.trim().toLowerCase();
  if (!s) return items;
  return items.filter((x) => x.name.toLowerCase().includes(s));
}
