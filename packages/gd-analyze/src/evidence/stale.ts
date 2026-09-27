/**
 * `gd-analyze evidence --refresh --stale`: which proofs and case files a refresh must re-measure,
 * so a change re-runs what it touched rather than every proof and case file.
 *
 * A proof or case file is selected when:
 * - a claim it carries is stale (`gd-analyze liveness`): a proof's claims carry its recorded
 *   input digest, a case file's claims are the ones its `authority/godot-4.7/<name>.json` holds;
 * - its own source differs from what the last refresh that measured it recorded in
 *   `evidence/refresh-sources/godot-<version>.json` (liveness recomputes implementation digests, never a proof's or case
 *   file's own inputs): `src/evidence/proofs/<name>.ts`, or `evidence/godot-4.7/<name>.cases.ts`
 *   with every other file under `evidence/godot-4.7/` a case file may import;
 * - it has no authority file yet, or no recorded sources.
 * A stale claim no proof or case file accounts for selects everything: the full refresh is the
 * authority, and this is only its fast path.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  type GodotEvidenceVersion,
  type GodotProofName,
  godotEvidenceDir,
  godotProofIdentities,
  godotProofIdentityFile,
} from '../godot-frontend/proof-identities';
import { godotStaleClaimRecords } from '../report/liveness';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CASES_DIR = path.join(PACKAGE_ROOT, 'evidence', 'godot-4.7');

export interface StaleEvidence {
  readonly proofs: ReadonlySet<string>;
  readonly cases: ReadonlySet<string>;
  /** Why each was selected, for the refresh's log. */
  readonly reasons: ReadonlyMap<string, string>;
  /** Every proof and case file is selected. */
  readonly all: boolean;
}

/** Where the refresh records the sources each proof and case file was last measured from. */
function sourcesFile(version: GodotEvidenceVersion): string {
  return path.join(PACKAGE_ROOT, 'evidence', 'refresh-sources', `godot-${version}.json`);
}

/**
 * What every proof or every case file is measured with besides its own source: the evidence
 * tooling, the project's lockfile (the dependencies both sides run), and for proofs the pinned
 * fixtures they read. A change here selects all of them.
 */
const CASE_TOOLING = ['src/evidence/run-evidence.ts', 'src/evidence/case.ts', 'src/evidence/shader-evaluation.ts', 'src/evidence/node-assets.ts', 'src/evidence/node-asset-hook.mjs', 'src/evidence/node-asset-loader.mjs', 'src/evidence/node-callsite-stamp.mjs'];
const PROOF_TOOLING = ['src/evidence/proofs/proof.ts', 'src/evidence/proofs/emitted-node-modules.ts', 'src/evidence/browser-harness.ts', 'src/evidence/node-assets.ts', 'src/evidence/node-asset-hook.mjs', 'src/evidence/node-asset-loader.mjs', 'src/evidence/node-callsite-stamp.mjs'];
const LOCKFILE = path.resolve(PACKAGE_ROOT, '..', '..', 'package-lock.json');

/** The fixtures as git holds them, with any working-tree change's bytes. */
let fixturesDigest: string | undefined;
function fixtures(): string {
  if (fixturesDigest !== undefined) return fixturesDigest;
  const run = (args: readonly string[]) => spawnSync('git', [...args], { cwd: PACKAGE_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stdout;
  const hash = createHash('sha256').update(run(['ls-files', '-s', '--', 'test/fixtures']));
  const changed = run(['status', '--porcelain', '--untracked-files=all', '--', 'test/fixtures']);
  hash.update(changed);
  for (const line of changed.split('\n')) {
    const file = path.join(PACKAGE_ROOT, '..', '..', line.slice(3));
    if (line.length > 3 && existsSync(file)) hash.update(readFileSync(file));
  }
  fixturesDigest = hash.digest('hex');
  return fixturesDigest;
}

function digest(files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(`${path.relative(PACKAGE_ROOT, file)}\0`);
    hash.update(existsSync(file) ? readFileSync(file) : 'absent');
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** The sources a proof or case file is measured from, digested. */
export function godotEvidenceSourceDigest(kind: 'proof' | 'case', name: string): string {
  if (kind === 'proof') {
    return createHash('sha256')
      .update(digest([path.join(PACKAGE_ROOT, 'src/evidence/proofs', `${name}.ts`), ...PROOF_TOOLING.map((file) => path.join(PACKAGE_ROOT, file)), LOCKFILE]))
      .update(fixtures())
      .digest('hex');
  }
  const shared = readdirSync(CASES_DIR)
    .filter((file) => !file.endsWith('.cases.ts'))
    .map((file) => path.join(CASES_DIR, file));
  return digest([path.join(CASES_DIR, `${name}.cases.ts`), ...shared, ...CASE_TOOLING.map((file) => path.join(PACKAGE_ROOT, file)), LOCKFILE]);
}

type RecordedSources = Record<string, string>;

function recordedSources(version: GodotEvidenceVersion): RecordedSources {
  const file = sourcesFile(version);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as RecordedSources) : {};
}

/** Every proof's and case file's source digest, taken before a refresh measures anything. */
export function godotEvidenceSourceDigests(proofNames: readonly string[], caseNames: readonly string[]): ReadonlyMap<string, string> {
  return new Map([
    ...proofNames.map((name) => [`proof:${name}`, godotEvidenceSourceDigest('proof', name)] as const),
    ...caseNames.map((name) => [`case:${name}`, godotEvidenceSourceDigest('case', name)] as const),
  ]);
}

/**
 * Record, for what a refresh measured and found in agreement, the source digests taken before it
 * measured (`godotEvidenceSourceDigests`): an edit made while it ran is not credited to it.
 */
export function recordGodotEvidenceSources(
  measured: readonly (readonly ['proof' | 'case', string])[],
  before: ReadonlyMap<string, string>,
  version: GodotEvidenceVersion = '4.7',
): void {
  if (measured.length === 0) return;
  const recorded = recordedSources(version);
  for (const [kind, name] of measured) {
    const was = before.get(`${kind}:${name}`);
    if (was !== undefined) recorded[`${kind}:${name}`] = was;
  }
  const ordered = Object.fromEntries(Object.entries(recorded).sort(([left], [right]) => left.localeCompare(right)));
  mkdirSync(path.dirname(sourcesFile(version)), { recursive: true });
  writeFileSync(sourcesFile(version), `${JSON.stringify(ordered, null, 2)}\n`);
}

export function godotStaleEvidence(
  proofNames: readonly GodotProofName[],
  caseNames: readonly string[],
  before: ReadonlyMap<string, string>,
  version: GodotEvidenceVersion = '4.7',
): StaleEvidence {
  // Liveness checks the 4.7 authorities only; a 4.6 refresh has nothing to select stale claims by.
  if (version !== '4.7') throw new Error('evidence --refresh --stale measures 4.7 only; refresh 4.6 in full');
  const proofs = new Set<string>();
  const cases = new Set<string>();
  const reasons = new Map<string, string>();
  const select = (set: Set<string>, name: string, reason: string) => {
    if (!set.has(name)) reasons.set(name, reason);
    set.add(name);
  };

  // Stale claims, each back to the proof or case file that measures it.
  const proofByInput = new Map<string, string>();
  for (const name of proofNames) {
    if (!existsSync(godotProofIdentityFile(name, version))) {
      select(proofs, name, 'no recorded identities');
      continue;
    }
    proofByInput.set(godotProofIdentities(name, version).input, name);
  }
  const caseByClaim = new Map<string, string>();
  for (const name of caseNames) {
    const file = path.join(godotEvidenceDir(version), `${name}.json`);
    if (!existsSync(file)) {
      select(cases, name, 'no authority file');
      continue;
    }
    const recorded = JSON.parse(readFileSync(file, 'utf8')) as { readonly claims?: readonly { readonly claimId: string }[] };
    for (const claim of recorded.claims ?? []) caseByClaim.set(claim.claimId, name);
  }
  const unaccounted: string[] = [];
  for (const claims of godotStaleClaimRecords().values()) {
    for (const claim of claims) {
      const byCase = caseByClaim.get(claim.claimId);
      const byProof = claim.native === undefined ? undefined : proofByInput.get(claim.native.inputSha256);
      if (byCase !== undefined) select(cases, byCase, `stale claim ${claim.claimId}`);
      else if (byProof !== undefined) select(proofs, byProof, `stale claim ${claim.claimId}`);
      else unaccounted.push(claim.claimId);
    }
  }
  if (unaccounted.length > 0) {
    return {
      proofs: new Set(proofNames),
      cases: new Set(caseNames),
      reasons: new Map([['*', `stale claims no proof or case file accounts for: ${unaccounted.slice(0, 5).join(', ')}${unaccounted.length > 5 ? ', …' : ''}`]]),
      all: true,
    };
  }

  // Their own sources, against what the refresh that last measured them recorded.
  const recorded = recordedSources(version);
  for (const name of proofNames) {
    const was = recorded[`proof:${name}`];
    if (was === undefined) select(proofs, name, 'no recorded sources');
    else if (was !== before.get(`proof:${name}`)) select(proofs, name, 'its proof source, the evidence tooling, the fixtures or the lockfile changed');
  }
  for (const name of caseNames) {
    const was = recorded[`case:${name}`];
    if (was === undefined) select(cases, name, 'no recorded sources');
    else if (was !== before.get(`case:${name}`)) select(cases, name, 'its case file, a shared case helper, the evidence tooling or the lockfile changed');
  }
  return { proofs, cases, reasons, all: false };
}
