import { createHash } from 'node:crypto';
import { plannedArtifactIdentity } from './identity';
import type { GodotAssetOrigin, GodotPlannedAssetArtifact } from './types';

/** A source asset copied byte for byte beside the app (`public/godot/<res path>`). */
export function assetCopyArtifact(resPath: string, sourceDigest: string, bytes: Uint8Array): GodotPlannedAssetArtifact {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== sourceDigest) throw new Error(`${resPath}: captured asset bytes changed`);
  const path = `public/godot/${resPath.slice('res://'.length)}`;
  const origin: GodotAssetOrigin = {
    kind: 'asset-copy',
    sourcePath: resPath,
    sourceDigest,
    operation: { kind: 'byte-identical-copy' },
  };
  return { kind: 'asset-copy', path, bytes, digest, origin, planIdentity: plannedArtifactIdentity('asset-copy', path, undefined, digest, origin) };
}
