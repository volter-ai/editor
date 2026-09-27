/**
 * `gd-analyze liveness`: every claim the import's authorities carry, checked the way the import
 * checks one before using it (`semanticClaimIsLive` against the authority's liveness, whose
 * implementation digests are recomputed from the working tree). A stale claim makes an import that
 * reaches it refuse; this names them all without a Godot binary, in seconds.
 */
import { godotAnalysisAuthority } from '../analyze/authority-data';
import { semanticClaimIsLive, type SemanticClaimLiveness, type SemanticClaimRecord } from '../godot-frontend/semantic-claims';
import { godotSourceAuthority } from '../godot-frontend/source-authority';
import { godotReadAuthority } from '../read/authority-data';
import { godotCodeTranslationAuthority } from '../translate/code/authority-data';
import { godotFieldValueAuthority } from '../translate/data/field-value-authority-data';
import { godotLifecycleAuthority } from '../translate/data/lifecycle-authority-data';
import { godotSceneNodeAuthority } from '../translate/data/scene-node-authority-data';

interface Authority {
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly (SemanticClaimLiveness & { readonly claimId: string })[];
}

/** The stale claims of each authority, by authority. */
export function godotStaleClaimRecords(): ReadonlyMap<string, readonly SemanticClaimRecord[]> {
  const source = godotSourceAuthority(4);
  const authorities: readonly (readonly [string, Authority])[] = [
    ['read', godotReadAuthority(source) as unknown as Authority],
    ['analysis', godotAnalysisAuthority(source) as unknown as Authority],
    ['code', godotCodeTranslationAuthority(source) as unknown as Authority],
    ['field-values', godotFieldValueAuthority(source) as unknown as Authority],
    ['scene-nodes', godotSceneNodeAuthority(source) as unknown as Authority],
    ['lifecycle', godotLifecycleAuthority(source) as unknown as Authority],
  ];
  const stale = new Map<string, SemanticClaimRecord[]>();
  for (const [name, authority] of authorities) {
    const claims = new Map(authority.claims.map((claim) => [claim.claimId, claim] as const));
    const found = authority.liveness.flatMap((entry) => {
      const claim = claims.get(entry.claimId);
      if (claim !== undefined && semanticClaimIsLive(claim, entry)) return [];
      // A liveness entry with no claim at all: a stand-in that names only its id.
      return [claim ?? ({ claimId: entry.claimId } as SemanticClaimRecord)];
    });
    if (found.length > 0) stale.set(name, found);
  }
  return stale;
}

/** The stale claim ids of each authority, by authority. */
export function godotStaleClaims(): ReadonlyMap<string, readonly string[]> {
  return new Map([...godotStaleClaimRecords()].map(([name, claims]) => [name, claims.map((claim) => claim.claimId)] as const));
}

export function runLiveness(): number {
  const stale = godotStaleClaims();
  if (stale.size === 0) {
    process.stdout.write('every claim is live\n');
    return 0;
  }
  for (const [name, ids] of stale) process.stdout.write(`${name}: ${String(ids.length)} stale\n  ${ids.join('\n  ')}\n`);
  return 1;
}
