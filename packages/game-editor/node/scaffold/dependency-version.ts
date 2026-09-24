/**
 * Pure per-package `package.json` dependency-version comparison. Sibling to
 * `compareEnginePin` (engine-version.ts): that function compares the
 * MANIFEST's `engine.version` — an EXACT identity pin, never relaxed —
 * against the checkout's engine version. This compares a `package.json` DEPENDENCY spec for a `@volter/*`
 * package against a target version. Project dependencies use normal semver,
 * so that spec may be a CARET range (`^0.2.0`) rather than an exact pin — the
 * two axes are independent by design (see upgrade.ts's module doc): the
 * manifest pin stays exact, the dependency spec keeps whatever form
 * (caret or exact) the project already used.
 *
 * Both endpoints are caller-supplied — never read from disk here — same
 * discipline as `compareEnginePin`/`currentEngineVersion` (upgrade.ts's
 * module doc), so tests and the CLI's own target-version resolution (§D,
 * the baked-constant/`--to`/`ENGINE_ROOT` precedence) control both without
 * this module touching a filesystem.
 */

import { compareTuples, parseSemver } from './engine-version.js';

export type DependencyVersionStatus = 'match' | 'behind' | 'ahead' | 'invalid';

export interface DependencyVersionComparison {
  status: DependencyVersionStatus;
  /** The `package.json` dependency spec, exactly as found (e.g. `"^0.2.0"`, `"0.2.0"`, `"file:../../engine"`). */
  currentSpec: string;
  /**
   * The bare semver parsed out of `currentSpec`, when recognized (an exact
   * version or a caret-prefixed one). Undefined for anything else — a
   * legacy `file:` dependency, a `*`/`~`/other range — which is exactly
   * `status: 'invalid'`; those specs are never rewritten by the re-pin step
   * (`upgrade.ts`'s `rewriteDependencyVersions` skips any entry without a
   * `currentVersion`).
   */
  currentVersion?: string;
  /**
   * True iff `currentSpec` used a caret prefix. Preserved by the re-pin
   * step so a project's caret range is re-pinned to a new
   * caret range, never silently switched to an exact pin (or vice versa) —
   * deliverable A's explicit requirement.
   */
  caret: boolean;
  /** The version to compare/re-pin against, as given. */
  target: string;
  /** Only set when `status === 'invalid'` — which side failed to parse and why. */
  reason?: string;
}

/**
 * Compare one `package.json` dependency spec against a target version.
 * Accepts an exact semver (`"0.2.0"`) or a caret range (`"^0.2.0"` — the
 * only range shape `scaffoldProject` writes) as `currentSpec`; anything else
 * (a legacy `file:` dependency, `*`, `~`,
 * or any other range form) is `'invalid'` — not a version this axis can
 * compare or rewrite.
 */
export function compareDependencyVersion(
  currentSpec: string,
  target: string,
): DependencyVersionComparison {
  const caret = currentSpec.startsWith('^');
  const versionPart = caret ? currentSpec.slice(1) : currentSpec;
  const currentTuple = parseSemver(versionPart);
  const targetTuple = parseSemver(target);

  if (!currentTuple || !targetTuple) {
    const reason = !currentTuple
      ? `dependency spec "${currentSpec}" is not an exact or caret-prefixed semver version`
      : `target "${target}" is not a valid exact semver string`;
    return { status: 'invalid', currentSpec, caret, target, reason };
  }

  const cmp = compareTuples(currentTuple, targetTuple);
  const status: DependencyVersionStatus = cmp === 0 ? 'match' : cmp < 0 ? 'behind' : 'ahead';
  return { status, currentSpec, currentVersion: versionPart, caret, target };
}
