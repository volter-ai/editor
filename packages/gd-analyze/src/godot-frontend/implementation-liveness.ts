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

/** Replace a checked-in self-assertion with the digest of the code actually executing now. */
export function withLiveImplementation<T extends SemanticClaimLiveness>(
  rows: readonly T[],
  implementationSha256: string,
): readonly T[] {
  return rows.map((row) => ({ ...row, implementationSha256 }));
}
