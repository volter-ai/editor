import type { GodotBoundScript } from '../godot-frontend/bound-program';

export const BOUND_GODOT_AUTOLOAD_REFERENCE_CLAIM_ID =
  'godot-4.7-autoload-script-singleton-analysis-join' as const;

export function boundGodotAutoloadReferenceCanonicalIdentity(sourceRevision: string): string {
  return `${sourceRevision}:BoundGodotProject:autoload-script-singleton-reference`;
}

export interface BoundGodotScriptSingletonTarget {
  readonly name: string;
  readonly resPath: string;
  readonly className: string;
}

/**
 * One project-wide singleton identity selected by Godot's analyzer for one exact identifier node.
 * Translation consumes this join by node id; it never repeats ProjectSettings name resolution.
 */
export interface BoundGodotScriptSingletonReference {
  readonly nodeId: number;
  readonly name: string;
  readonly resPath: string;
  readonly className: string;
  readonly evidenceClaimId: typeof BOUND_GODOT_AUTOLOAD_REFERENCE_CLAIM_ID;
  readonly canonicalIdentity: string;
}

/** Join official identifier meaning to decoded script-autoload identity exactly once in analysis. */
export function bindGodotScriptSingletonReferences(
  sourceRevision: string,
  script: GodotBoundScript,
  targets: readonly BoundGodotScriptSingletonTarget[],
): readonly BoundGodotScriptSingletonReference[] {
  const byName = new Map<string, BoundGodotScriptSingletonTarget>();
  for (const target of targets) {
    if (byName.has(target.name)) {
      throw new Error(`project repeats autoload singleton ${target.name}`);
    }
    byName.set(target.name, target);
  }
  const canonicalIdentity = boundGodotAutoloadReferenceCanonicalIdentity(sourceRevision);
  return script.nodes.flatMap((node) => {
    if (node.kind !== 'IDENTIFIER' || node.source !== 'UNDEFINED_SOURCE') return [];
    const target = byName.get(node.name);
    if (target === undefined) return [];
    if (
      node.datatype.kind !== 'CLASS' ||
      node.datatype.constant !== true ||
      node.datatype.scriptPath !== target.resPath ||
      (target.className !== '' && node.datatype.className !== target.className)
    ) {
      return [];
    }
    return [
      {
        nodeId: node.id,
        name: target.name,
        resPath: target.resPath,
        className: target.className,
        evidenceClaimId: BOUND_GODOT_AUTOLOAD_REFERENCE_CLAIM_ID,
        canonicalIdentity,
      },
    ];
  });
}
