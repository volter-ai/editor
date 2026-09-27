import { createHash } from 'node:crypto';

export const SEMANTIC_CLAIM_REGISTRY_VERSION = 1 as const;

export type SemanticClaimLayer =
  | 'read'
  | 'analyze'
  | 'translate-data'
  | 'translate-code'
  | 'binding'
  | 'compat';

export interface SemanticClaimRecord {
  readonly registryVersion: typeof SEMANTIC_CLAIM_REGISTRY_VERSION;
  readonly claimId: string;
  readonly layer: SemanticClaimLayer;
  readonly canonicalIdentity: string;
  readonly godot: {
    readonly sourceRevision: string;
    readonly apiDumpSha256: string;
    readonly sourceFile: string;
    readonly sourceSymbol: string;
    readonly sourceLine: number;
  };
  readonly native: {
    readonly executableSha256: string;
    readonly buildIdentity: string;
    readonly inputSha256: string;
    readonly callsite: string;
    readonly observedOutputSha256: string;
  };
  readonly target: {
    readonly implementationSha256: string;
    readonly callsite: string;
    readonly observedOutputSha256: string;
  };
  readonly comparison: {
    readonly comparator: string;
    readonly tolerance: string;
    readonly resultSha256: string;
  };
  readonly reproductionCommand: readonly string[];
}

export interface SemanticClaimLiveness {
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly executableSha256: string;
  readonly inputSha256: string;
  readonly implementationSha256: string;
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * A claim is usable only while every identity that can change its meaning still matches. This is
 * evidence liveness, not architecture certification.
 */
export function semanticClaimIsLive(
  claim: SemanticClaimRecord,
  expected: SemanticClaimLiveness,
): boolean {
  return (
    claim.registryVersion === SEMANTIC_CLAIM_REGISTRY_VERSION &&
    claim.godot.sourceRevision === expected.sourceRevision &&
    claim.godot.apiDumpSha256 === expected.apiDumpSha256 &&
    claim.native.executableSha256 === expected.executableSha256 &&
    claim.native.inputSha256 === expected.inputSha256 &&
    claim.target.implementationSha256 === expected.implementationSha256 &&
    isSha256(claim.native.observedOutputSha256) &&
    isSha256(claim.target.observedOutputSha256) &&
    isSha256(claim.comparison.resultSha256) &&
    claim.reproductionCommand.length > 0 &&
    claim.reproductionCommand.every((part) => part.length > 0)
  );
}

/** Stable content identity for immutable claim registries and compiler reports. */
export function semanticClaimRegistryDigest(claims: readonly SemanticClaimRecord[]): string {
  const ordered = [...claims].sort((left, right) => left.claimId.localeCompare(right.claimId));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

export class SemanticClaimRegistry {
  readonly digest: string;
  readonly #claims: ReadonlyMap<string, SemanticClaimRecord>;

  constructor(claims: readonly SemanticClaimRecord[]) {
    const byId = new Map<string, SemanticClaimRecord>();
    for (const claim of claims) {
      if (claim.claimId.length === 0 || byId.has(claim.claimId)) {
        throw new Error(`semantic claim identity is empty or duplicated: ${claim.claimId}`);
      }
      if (claim.canonicalIdentity.length === 0 || claim.reproductionCommand.length === 0) {
        throw new Error(`semantic claim ${claim.claimId} is incomplete`);
      }
      byId.set(claim.claimId, claim);
    }
    this.#claims = byId;
    this.digest = semanticClaimRegistryDigest(claims);
  }

  claim(id: string, expected: SemanticClaimLiveness): SemanticClaimRecord {
    const claim = this.#claims.get(id);
    if (claim === undefined) throw new Error(`semantic claim is missing: ${id}`);
    if (!semanticClaimIsLive(claim, expected)) {
      throw new Error(`semantic claim is stale: ${id}`);
    }
    return claim;
  }
}
