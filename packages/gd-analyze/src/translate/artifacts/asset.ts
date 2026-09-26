import { createHash } from 'node:crypto';
import type { DirectJsonValue } from '../data/direct-project-data-plan';
import { plannedArtifactIdentity } from './identity';
import type { GodotPlannedAssetArtifact } from './types';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The only constructor for a byte-identical captured source asset. */
export function assetCopyArtifact(
  path: string,
  bytes: Uint8Array,
  sourcePath: string,
  sourceDigest: string,
): GodotPlannedAssetArtifact {
  const digest = sha256(bytes);
  if (digest !== sourceDigest) throw new Error(`${sourcePath}: copied asset bytes changed`);
  const origin = {
    kind: 'asset-copy',
    sourcePath,
    sourceDigest,
    operation: { kind: 'byte-identical-copy' },
  } as const;
  return {
    kind: 'asset-copy',
    path,
    bytes,
    digest,
    origin,
    planIdentity: plannedArtifactIdentity('asset-copy', path, undefined, digest, origin),
  };
}

/** The only constructor for final bytes produced by one declared native converter. */
export function convertedAssetArtifact(
  path: string,
  bytes: Uint8Array,
  sourcePath: string,
  sourceDigest: string,
  converterId: string,
  converterVersion: string,
  options: DirectJsonValue,
): GodotPlannedAssetArtifact {
  const digest = sha256(bytes);
  const origin = {
    kind: 'asset-copy',
    sourcePath,
    sourceDigest,
    operation: { kind: 'native-conversion', converterId, converterVersion, options },
  } as const;
  return {
    kind: 'asset-copy',
    path,
    bytes,
    digest,
    origin,
    planIdentity: plannedArtifactIdentity('asset-copy', path, undefined, digest, origin),
  };
}
