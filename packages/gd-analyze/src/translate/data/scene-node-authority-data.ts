import {
  monorepoImplementationDigest,
  packageImplementationDigest,
  withLiveImplementation,
} from '../../godot-frontend/implementation-liveness';
import type { GodotSourceAuthority } from '../../godot-frontend/source-authority';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../code/authority/godot-4.7-seed';
import {
  GODOT_4_7_SCENE_NODE_CLAIMS,
  GODOT_4_7_SCENE_NODE_LIVENESS,
  GODOT_4_7_SCENE_NODE_RULES,
  GODOT_4_7_SCENE_PLACEMENT_RULES,
  GODOT_4_7_SCENE_PROPERTY_RULES,
  GODOT_4_7_STRUCTURE_CLAIMS,
  GODOT_4_7_STRUCTURE_LIVENESS,
  GODOT_4_7_STRUCTURE_NODE_RULES,
  GODOT_4_7_STRUCTURE_PROPERTY_RULES,
  GODOT_4_7_STRUCTURE_RULES,
} from './authority/godot-4.7-scene-nodes';
import {
  GODOT_SCENE_NODE_AUTHORITY_VERSION,
  type GodotSceneNodeAuthority,
} from './scene-node-authority';

export const GODOT_SCENE_NODE_IMPLEMENTATION_FILES = [
  'src/analyze/bound-project.ts',
  'src/translate/data/scene-node-authority.ts',
  'src/translate/data/scene-document-plan.ts',
] as const;

/** What the scene-structure proof runs: planning, composition, emission and the compat it mounts. */
export const GODOT_SCENE_STRUCTURE_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/analyze/bound-project.ts',
  'packages/gd-analyze/src/translate/data/scene-node-authority.ts',
  'packages/gd-analyze/src/translate/data/scene-document-plan.ts',
  'packages/gd-analyze/src/translate/data/direct-project-composition-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/node.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/node-3d.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/camera-3d.ts',
] as const;

/** Checked-in, exact-pin scene-node mapping authority for the selected official frontend. */
export function godotSceneNodeAuthority(source: GodotSourceAuthority): GodotSceneNodeAuthority {
  const supported =
    source.revision === GODOT_4_7_CODE_SEED_SOURCE_REVISION &&
    source.apiDumpSha256 === GODOT_4_7_CODE_SEED_API_DUMP_SHA256;
  return {
    version: GODOT_SCENE_NODE_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    rules: supported ? [...GODOT_4_7_SCENE_NODE_RULES, ...GODOT_4_7_STRUCTURE_NODE_RULES] : [],
    placementRules: supported ? GODOT_4_7_SCENE_PLACEMENT_RULES : [],
    propertyRules: supported
      ? [...GODOT_4_7_SCENE_PROPERTY_RULES, ...GODOT_4_7_STRUCTURE_PROPERTY_RULES]
      : [],
    structureRules: supported ? GODOT_4_7_STRUCTURE_RULES : [],
    claims: supported ? [...GODOT_4_7_SCENE_NODE_CLAIMS, ...GODOT_4_7_STRUCTURE_CLAIMS] : [],
    liveness: supported
      ? [
          ...withLiveImplementation(
            GODOT_4_7_SCENE_NODE_LIVENESS,
            packageImplementationDigest(GODOT_SCENE_NODE_IMPLEMENTATION_FILES),
          ),
          ...withLiveImplementation(
            GODOT_4_7_STRUCTURE_LIVENESS,
            monorepoImplementationDigest(GODOT_SCENE_STRUCTURE_IMPLEMENTATION_FILES),
          ),
        ]
      : [],
  };
}
