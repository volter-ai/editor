import {
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

/** Checked-in, exact-pin scene-node mapping authority for the selected official frontend. */
export function godotSceneNodeAuthority(source: GodotSourceAuthority): GodotSceneNodeAuthority {
  const supported =
    source.revision === GODOT_4_7_CODE_SEED_SOURCE_REVISION &&
    source.apiDumpSha256 === GODOT_4_7_CODE_SEED_API_DUMP_SHA256;
  return {
    version: GODOT_SCENE_NODE_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    rules: supported ? GODOT_4_7_SCENE_NODE_RULES : [],
    placementRules: supported ? GODOT_4_7_SCENE_PLACEMENT_RULES : [],
    propertyRules: supported ? GODOT_4_7_SCENE_PROPERTY_RULES : [],
    claims: supported ? GODOT_4_7_SCENE_NODE_CLAIMS : [],
    liveness: supported
      ? withLiveImplementation(
          GODOT_4_7_SCENE_NODE_LIVENESS,
          packageImplementationDigest(GODOT_SCENE_NODE_IMPLEMENTATION_FILES),
        )
      : [],
  };
}
