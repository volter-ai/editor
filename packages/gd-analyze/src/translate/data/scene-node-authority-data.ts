import type { GodotSourceAuthority } from '../../godot-frontend/source-authority';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../code/authority/godot-4.7-seed';
import {
  GODOT_4_7_SCENE_NODE_RULES,
  GODOT_4_7_SCENE_PLACEMENT_RULES,
  GODOT_4_7_SCENE_PROPERTY_RULES,
  GODOT_4_7_STRUCTURE_NODE_RULES,
  GODOT_4_7_STRUCTURE_PROPERTY_RULES,
  GODOT_4_7_SIGNAL_RULES,
  GODOT_4_7_STRUCTURE_RULES,
} from './authority/godot-4.7-scene-nodes';
import {
  GODOT_4_7_IMPORTED_STRUCTURE_RULES,
  GODOT_4_7_RENDER_NODE_RULES,
  GODOT_4_7_RENDER_RESOURCE_RULES,
  GODOT_4_7_RENDER_STRUCTURE_RULES,
} from './authority/godot-4.7-scene-render';
import {
  GODOT_4_7_UI_NODE_RULES,
  GODOT_4_7_UI_RESOURCE_RULES,
} from './authority/godot-4.7-scene-ui';
import {
  GODOT_4_7_TEXTURE_RESOURCE_RULES,
} from './authority/godot-4.7-scene-textures';
import {
  GODOT_4_7_MESH_NODE_RULES,
  GODOT_4_7_MESH_RESOURCE_RULES,
} from './authority/godot-4.7-scene-meshes';
import {
  GODOT_4_7_GRIDMAP_NODE_RULES,
  GODOT_4_7_GRIDMAP_RESOURCE_RULES,
} from './authority/godot-4.7-scene-gridmap';
import {
  GODOT_4_7_ANIMATION_NODE_RULES,
  GODOT_4_7_ANIMATION_RESOURCE_RULES,
} from './authority/godot-4.7-scene-animation';
import {
  GODOT_4_7_AUDIO_NODE_RULES,
  GODOT_4_7_AUDIO_RESOURCE_RULES,
} from './authority/godot-4.7-scene-audio';
import {
  GODOT_4_7_ENVIRONMENT_NODE_RULES,
  GODOT_4_7_ENVIRONMENT_RESOURCE_RULES,
} from './authority/godot-4.7-scene-environment';
import {
  GODOT_4_7_PARTICLE_NODE_RULES,
  GODOT_4_7_PARTICLE_RESOURCE_RULES,
} from './authority/godot-4.7-scene-particles';
import {
  GODOT_4_7_PHYSICS_NODE_RULES,
  GODOT_4_7_PHYSICS_RESOURCE_RULES,
  GODOT_4_7_PHYSICS_SIGNAL_RULES,
} from './authority/godot-4.7-scene-physics';
import {
  GODOT_4_7_IDIOMATIC_STRUCTURE_RULES,
} from './authority/godot-4.7-scene-idiomatic';
import {
  GODOT_SCENE_NODE_AUTHORITY_VERSION,
  type GodotSceneNodeAuthority,
} from './scene-node-authority';

/** The scene-node mapping rules for the selected official frontend. */
export function godotSceneNodeAuthority(source: GodotSourceAuthority): GodotSceneNodeAuthority {
  const supported =
    source.revision === GODOT_4_7_CODE_SEED_SOURCE_REVISION &&
    source.apiDumpSha256 === GODOT_4_7_CODE_SEED_API_DUMP_SHA256;
  return {
    version: GODOT_SCENE_NODE_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    rules: supported
      ? [
          ...GODOT_4_7_SCENE_NODE_RULES,
          ...GODOT_4_7_STRUCTURE_NODE_RULES,
          ...GODOT_4_7_RENDER_NODE_RULES,
          ...GODOT_4_7_UI_NODE_RULES,
          ...GODOT_4_7_PHYSICS_NODE_RULES,
          ...GODOT_4_7_MESH_NODE_RULES,
          ...GODOT_4_7_AUDIO_NODE_RULES,
          ...GODOT_4_7_GRIDMAP_NODE_RULES,
          ...GODOT_4_7_PARTICLE_NODE_RULES,
          ...GODOT_4_7_ENVIRONMENT_NODE_RULES,
          ...GODOT_4_7_ANIMATION_NODE_RULES,
        ]
      : [],
    placementRules: supported ? GODOT_4_7_SCENE_PLACEMENT_RULES : [],
    propertyRules: supported
      ? [...GODOT_4_7_SCENE_PROPERTY_RULES, ...GODOT_4_7_STRUCTURE_PROPERTY_RULES]
      : [],
    structureRules: supported
      ? [
          ...GODOT_4_7_STRUCTURE_RULES,
          ...GODOT_4_7_RENDER_STRUCTURE_RULES,
          ...GODOT_4_7_IMPORTED_STRUCTURE_RULES,
          ...GODOT_4_7_IDIOMATIC_STRUCTURE_RULES,
        ]
      : [],
    signalRules: supported ? [...GODOT_4_7_SIGNAL_RULES, ...GODOT_4_7_PHYSICS_SIGNAL_RULES] : [],
    resourceRules: supported
      ? [...GODOT_4_7_RENDER_RESOURCE_RULES, ...GODOT_4_7_UI_RESOURCE_RULES, ...GODOT_4_7_PHYSICS_RESOURCE_RULES, ...GODOT_4_7_TEXTURE_RESOURCE_RULES, ...GODOT_4_7_MESH_RESOURCE_RULES, ...GODOT_4_7_AUDIO_RESOURCE_RULES, ...GODOT_4_7_GRIDMAP_RESOURCE_RULES, ...GODOT_4_7_PARTICLE_RESOURCE_RULES, ...GODOT_4_7_ENVIRONMENT_RESOURCE_RULES, ...GODOT_4_7_ANIMATION_RESOURCE_RULES]
      : [],
  };
}
