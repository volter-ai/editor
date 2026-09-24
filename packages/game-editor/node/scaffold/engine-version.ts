/**
 * Pure engine-pin comparison (T2.3/D3 §1.E).
 *
 * `manifest.engine.version` is an EXACT semver
 * identity pin, not a range — the engine is a source link (a `file:`
 * dependency resolved as a symlink back into this checkout), so there is no
 * resolvable version range the way a registry dependency would have.
 * `compareEnginePin` is the read side of that pin: given a manifest's pin
 * and the checkout's CURRENT engine version (deliberately a parameter, not
 * read from disk here, so callers — including the §2 AC test — can inject
 * both endpoints), report whether the project is up to date, behind
 * (`vgai upgrade`, slice 2, should re-pin it), ahead (the checkout was
 * downgraded — unusual, still reported rather than silently ignored), or
 * either string isn't a valid exact semver in the first place.
 */

export type EnginePinComparisonStatus = 'match' | 'pin-behind' | 'pin-ahead' | 'invalid';

export interface EnginePinComparison {
  status: EnginePinComparisonStatus;
  /** The manifest's `engine.version` pin, as given. */
  pin: string;
  /** The checkout's current engine version, as given. */
  current: string;
  /** Only set when `status === 'invalid'` — which side failed to parse and why. */
  reason?: string;
}

/** Exact semver identity. Groups 4/5 retain prerelease/build metadata. */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;

export type SemverTuple = readonly [number, number, number];

/**
 * Exported so `dependency-version.ts` can parse the semver
 * embedded in a `package.json` dependency spec (after stripping an optional
 * leading `^`) with the exact same tolerance (prerelease/build metadata)
 * this module uses for the manifest pin, rather than a second regex that
 * could silently drift out of sync.
 */
export function parseSemver(version: string): SemverTuple | null {
  const match = SEMVER_RE.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1 / 0 / 1, comparing `major.minor.patch` in order (no range semantics — exact identity only). Exported for reuse by `dependency-version.ts` — see `parseSemver`'s comment. */
export function compareTuples(a: SemverTuple, b: SemverTuple): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

function comparePrerelease(a: string | undefined, b: string | undefined): -1 | 0 | 1 {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const aParts = a.split('.');
  const bParts = b.split('.');
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
    const aPart = aParts[index];
    const bPart = bParts[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) < Number(bPart) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

/**
 * Compare a manifest's `engine.version` pin against the checkout's current
 * engine version. Pure — no filesystem/process reads; both versions are
 * caller-supplied. Exact-semver only (§1.5 rejects ranges for this pin, and
 * D3/§1.E rejects them for the engine axis generally — a source-linked
 * engine has nothing for a range to resolve against).
 */
export function compareEnginePin(pin: string, current: string): EnginePinComparison {
  const pinMatch = SEMVER_RE.exec(pin);
  const currentMatch = SEMVER_RE.exec(current);
  const pinTuple = parseSemver(pin);
  const currentTuple = parseSemver(current);

  if (!pinTuple || !currentTuple) {
    const reason =
      !pinTuple && !currentTuple
        ? `neither pin "${pin}" nor current "${current}" is a valid exact semver string`
        : !pinTuple
          ? `pin "${pin}" is not a valid exact semver string`
          : `current "${current}" is not a valid exact semver string`;
    return { status: 'invalid', pin, current, reason };
  }

  if (pin === current) return { status: 'match', pin, current };

  const tupleCmp = compareTuples(pinTuple, currentTuple);
  const cmp = tupleCmp !== 0 ? tupleCmp : comparePrerelease(pinMatch?.[4], currentMatch?.[4]) || -1;
  const status: EnginePinComparisonStatus = cmp < 0 ? 'pin-behind' : 'pin-ahead';
  return { status, pin, current };
}

/**
 * Minimal npm range-satisfaction check for the shapes this repo's shared
 * dependencies (three/zod/postprocessing/...) ever declare in a
 * `package.json`: `^`-caret (the only form the template/engine actually
 * use), `~`-tilde (supported for completeness — cheap, never exercised
 * today), and an exact version. NOT a general semver-range parser — no
 * `||`, no `x`/`*` partial ranges, no `>=`/`<` comparator lists. Adding a
 * real `semver` dependency for this one predicate was considered and
 * rejected: nothing in this repo declares it directly (only
 * present transitively in `node_modules`), and the two range shapes this
 * function needs to reason about are cheap to implement correctly.
 *
 * Exported so `pinSharedDependencyVersions` (scaffold.ts) can decide whether
 * an already-installed exact version still satisfies a (possibly WIDENED)
 * new template range before overwriting that range with the installed
 * version — see that function's `fallbackDir` doc comment (PG-1). Without
 * this check, a no-checkout upgrade whose new template widens a shared-dep
 * range beyond what the project currently has installed would silently pin
 * the snapshot back down to the OLD installed version, permanently
 * classifying `package.json` as unchanged and suppressing the bump.
 *
 * Unrecognized range forms (a `file:` spec, `*`, a git URL, ...) return
 * `true` — "assume satisfied" is the conservative choice: it preserves this
 * function's callers' pre-existing behavior (always pin) for any shape this
 * repo's shared deps have never actually used, rather than silently
 * refusing to pin a range it doesn't understand.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const versionTuple = parseSemver(version);
  if (!versionTuple) return false; // can't reason about an unparseable installed version

  if (range.startsWith('^')) {
    const base = parseSemver(range.slice(1));
    return base ? satisfiesCaret(versionTuple, base) : true;
  }
  if (range.startsWith('~')) {
    const base = parseSemver(range.slice(1));
    return base ? satisfiesTilde(versionTuple, base) : true;
  }
  const exact = parseSemver(range);
  return exact ? compareTuples(versionTuple, exact) === 0 : true;
}

/** `^A.B.C` — npm caret semantics: patch-and-minor-free above the leftmost non-zero component, floor-inclusive. */
function satisfiesCaret(version: SemverTuple, base: SemverTuple): boolean {
  if (compareTuples(version, base) < 0) return false; // below the floor
  const [vMaj, vMin, vPat] = version;
  const [bMaj, bMin, bPat] = base;
  if (bMaj > 0) return vMaj === bMaj;
  if (bMin > 0) return vMaj === 0 && vMin === bMin;
  return vMaj === 0 && vMin === 0 && vPat === bPat; // ^0.0.x — patch-locked
}

/** `~A.B.C` — npm tilde semantics: patch-free within the same major.minor, floor-inclusive. */
function satisfiesTilde(version: SemverTuple, base: SemverTuple): boolean {
  if (compareTuples(version, base) < 0) return false;
  return version[0] === base[0] && version[1] === base[1];
}
