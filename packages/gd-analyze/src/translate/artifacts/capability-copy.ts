import { createHash } from 'node:crypto';
import type { CapabilityCopyArtifact } from '../../snapshot/toolchain-snapshot';
import { plannedArtifactIdentity } from './identity';
import type { GodotPlannedCapabilityCopyArtifact } from './types';

/** The only constructor for byte-identical frozen catalog capability source. */
export function capabilityCopyArtifact(
  copy: CapabilityCopyArtifact,
): GodotPlannedCapabilityCopyArtifact {
  const digest = createHash('sha256').update(copy.bytes).digest('hex');
  if (digest !== copy.digest) throw new Error(`${copy.path}: frozen capability bytes changed`);
  const origin = copy.origin;
  return {
    kind: 'capability-copy',
    path: copy.path,
    bytes: copy.bytes,
    digest,
    origin,
    planIdentity: plannedArtifactIdentity('capability-copy', copy.path, undefined, digest, origin),
  };
}
