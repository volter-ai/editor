/**
 * The relative import specifier a human would write from one module to
 * another — the ONE copy of the shared-prefix walk that existed five times
 * (owner-directed overlap audit, 2026-08-22): `R3fSourceAuthoringAdapter.
 * relativeModuleSpecifier`, `ReactRootAuthoringAdapter.relativeProjectModule`,
 * `pixi-source-write-target`'s `relativeProjectModule`, and the
 * `relativeSpecifier` locals in `plan-fork-component.ts` and
 * `plan-extract-component.ts`.
 *
 * Dependency-free on purpose (no `node:path`): two of the five consumers are
 * pure planner modules that must stay headlessly probeable, and a specifier is
 * a POSIX-slash artifact regardless of host platform.
 *
 * What stays at the call site, deliberately: resolving the two paths into the
 * SAME address space (project-relative vs absolute — both work, the walk eats
 * any shared prefix, but they must match). A source extension on the target is
 * stripped; an extension-less module id passes through unchanged.
 */
export function relativeImportSpecifier(fromFile: string, toModule: string): string {
  const from = normalize(fromFile).split('/').filter(Boolean).slice(0, -1);
  const to = normalize(toModule)
    .replace(/\.[cm]?[jt]sx?$/, '')
    .split('/')
    .filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  const up = new Array(from.length - shared).fill('..');
  const specifier = [...up, ...to.slice(shared)].join('/');
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}
