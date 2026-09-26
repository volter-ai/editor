import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { SemanticClaimLiveness } from './semantic-claims';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function implementationDigest(root: string, relativePaths: readonly string[]): string {
  return sha256(
    [...relativePaths]
      .sort()
      .map((relative) => `${relative}\0${sha256(readFileSync(path.join(root, relative)))}`)
      .join('\n'),
  );
}

/** Capture the live identity of implementation files addressed from packages/gd-analyze/. */
export function packageImplementationDigest(relativePaths: readonly string[]): string {
  return implementationDigest(PACKAGE_ROOT, relativePaths);
}

/** Capture the live identity of a proof closure that also includes copied catalog source. */
export function monorepoImplementationDigest(relativePaths: readonly string[]): string {
  return implementationDigest(MONOREPO_ROOT, relativePaths);
}

let measuringEvidence = false;

/**
 * Enter evidence measurement for the rest of this process. `gd-analyze evidence --refresh` runs
 * the pipeline to measure the very claims the pipeline checks, so while measuring, an authority
 * keeps its recorded implementation digest instead of the live one: a changed implementation is
 * measured, not refused. The import command refuses to run in a measuring process.
 */
export function enterEvidenceMeasurement(): void {
  measuringEvidence = true;
}

export function measuringEvidenceActive(): boolean {
  return measuringEvidence;
}

/** Replace a checked-in self-assertion with the digest of the code actually executing now. */
export function withLiveImplementation<T extends SemanticClaimLiveness>(
  rows: readonly T[],
  implementationSha256: string,
): readonly T[] {
  if (measuringEvidence) return rows;
  return rows.map((row) => ({ ...row, implementationSha256 }));
}
