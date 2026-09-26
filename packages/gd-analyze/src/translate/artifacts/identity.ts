import { createHash } from 'node:crypto';
import type { GodotArtifactOrigin, GodotPlannedArtifact } from './types';

export function structuralDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Bind a planned payload, legal origin, output path and optional map path into one identity. */
export function plannedArtifactIdentity(
  kind: GodotPlannedArtifact['kind'],
  path: string,
  sourceMapPath: string | undefined,
  payloadDigest: string,
  origin: GodotArtifactOrigin,
): string {
  return structuralDigest({
    kind,
    path,
    sourceMapPath: sourceMapPath ?? null,
    payloadDigest,
    origin,
  });
}
