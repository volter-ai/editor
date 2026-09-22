/**
 * One glob → one anchored RegExp, for a finder selection's `include`
 * (ARCHITECTURE-CORE §The project model): `**` matches any depth, `*` one
 * segment. No imports, so the editor server and the browser share it.
 */
export function globToRegExp(glob: string): RegExp {
  const GLOBSTAR = '__VGAI_GLOBSTAR__';
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, GLOBSTAR)
    .replace(/\*/g, '[^/]*')
    .split(GLOBSTAR)
    .join('(?:.*/)?');
  return new RegExp(`^${escaped}$`);
}
