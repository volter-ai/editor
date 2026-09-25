/**
 * Resolve a RELATIVE import specifier against an index of known project
 * paths — the extensionless-import answer (`./x` → `x.tsx`/`x.ts`/index
 * variants) answered from a REAL index, never by guessing an extension onto
 * a path. `null` when the specifier is not relative or nothing in the index
 * matches. The one algorithm behind both the component index and the
 * project adapter's module resolver; two copies of the candidate list is
 * how play and the finders disagree about which module a specifier names.
 */
export function resolveRelativeSpecifier(
  specifier: string,
  fromPath: string,
  paths: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const dir = fromPath.replaceAll('\\', '/').split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') dir.pop();
    else dir.push(segment);
  }
  const base = dir.join('/');
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ]) {
    if (paths.has(candidate)) return candidate;
  }
  return null;
}
