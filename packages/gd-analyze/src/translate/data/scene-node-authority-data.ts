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
  GODOT_4_7_SIGNAL_RULES,
  GODOT_4_7_STRUCTURE_RULES,
} from './authority/godot-4.7-scene-nodes';
import {
  GODOT_4_7_IMPORTED_CLAIMS,
  GODOT_4_7_IMPORTED_LIVENESS,
  GODOT_4_7_IMPORTED_STRUCTURE_RULES,
  GODOT_4_7_RENDER_CLAIMS,
  GODOT_4_7_RENDER_LIVENESS,
  GODOT_4_7_RENDER_NODE_RULES,
  GODOT_4_7_RENDER_RESOURCE_RULES,
  GODOT_4_7_RENDER_STRUCTURE_RULES,
} from './authority/godot-4.7-scene-render';
import {
  GODOT_4_7_UI_CLAIMS,
  GODOT_4_7_UI_LIVENESS,
  GODOT_4_7_UI_NODE_RULES,
  GODOT_4_7_UI_RESOURCE_RULES,
} from './authority/godot-4.7-scene-ui';
import {
  GODOT_4_7_TEXTURE_CLAIMS,
  GODOT_4_7_TEXTURE_LIVENESS,
  GODOT_4_7_TEXTURE_RESOURCE_RULES,
} from './authority/godot-4.7-scene-textures';
import {
  GODOT_4_7_MESH_CLAIMS,
  GODOT_4_7_MESH_LIVENESS,
  GODOT_4_7_MESH_NODE_RULES,
  GODOT_4_7_MESH_RESOURCE_RULES,
} from './authority/godot-4.7-scene-meshes';
import {
  GODOT_4_7_AUDIO_CLAIMS,
  GODOT_4_7_AUDIO_LIVENESS,
  GODOT_4_7_AUDIO_NODE_RULES,
  GODOT_4_7_AUDIO_RESOURCE_RULES,
} from './authority/godot-4.7-scene-audio';
import {
  GODOT_4_7_PHYSICS_CLAIMS,
  GODOT_4_7_PHYSICS_LIVENESS,
  GODOT_4_7_PHYSICS_NODE_RULES,
  GODOT_4_7_PHYSICS_RESOURCE_RULES,
  GODOT_4_7_PHYSICS_SIGNAL_RULES,
} from './authority/godot-4.7-scene-physics';
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
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/signal.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/react-lifecycle.tsx',
  'packages/gd-analyze/src/translate/emit/direct-scene-lifecycle-syntax.ts',
  'packages/gd-analyze/src/read/scene.ts',
] as const;

const COMPAT = 'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat';

/** What the scene-render proof runs: planning, emission and the render compat it mounts. */
export const GODOT_SCENE_RENDER_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/analyze/bound-project.ts',
  'packages/gd-analyze/src/translate/data/scene-node-authority.ts',
  'packages/gd-analyze/src/translate/data/scene-document-plan.ts',
  'packages/gd-analyze/src/translate/data/scene-setters.ts',
  'packages/gd-analyze/src/translate/data/direct-project-composition-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  ...[
    'node.ts',
    'node-3d.ts',
    'visual-instance-3d.ts',
    'geometry-instance-3d.ts',
    'mesh-instance-3d.ts',
    'primitive-mesh.ts',
    'plane-mesh.ts',
    'quad-mesh.ts',
    'sphere-mesh.ts',
    'cylinder-mesh.ts',
    'base-material-3d.ts',
    'standard-material-3d.ts',
    'light-3d.ts',
    'directional-light-3d.ts',
    'omni-light-3d.ts',
  ].map((file) => `${COMPAT}/${file}`),
] as const;

/** What the scene-ui proof runs: planning, emission and the UI compat it mounts. */
export const GODOT_SCENE_UI_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/analyze/bound-project.ts',
  'packages/gd-analyze/src/translate/data/scene-node-authority.ts',
  'packages/gd-analyze/src/translate/data/scene-document-plan.ts',
  'packages/gd-analyze/src/translate/data/scene-setters.ts',
  'packages/gd-analyze/src/translate/data/direct-project-composition-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  ...[
    'node.ts',
    'object.ts',
    'scene-tree.ts',
    'window.ts',
    'viewport.ts',
    'canvas-item.ts',
    'canvas-layer.ts',
    'control.ts',
    'container.ts',
    'box-container.ts',
    'h-box-container.ts',
    'font.ts',
    'label.ts',
    'label-settings.ts',
    'texture-2d.ts',
    'placeholder-texture-2d.ts',
    'canvas-texture.ts',
    'texture-rect.ts',
    'node-2d.ts',
    'sprite-2d.ts',
    'touch-screen-button.ts',
    'transform-2d.ts',
    'OpenSans_SemiBold.woff2',
  ].map((file) => `${COMPAT}/${file}`),
] as const;

/** What the scene-textures proof runs: the texture reader, planning, emission, the image compat. */
export const GODOT_SCENE_TEXTURE_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/read/import-sidecar.ts',
  'packages/gd-analyze/src/analyze/bound-project.ts',
  'packages/gd-analyze/src/translate/data/scene-document-plan.ts',
  'packages/gd-analyze/src/translate/data/scene-setters.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  'packages/gd-analyze/src/translate/translation-plan.ts',
  ...[
    'image.ts',
    'compressed-texture-2d.ts',
    'resource-loader.ts',
    'texture-2d.ts',
    'base-material-3d.ts',
    'texture-rect.ts',
    'sprite-2d.ts',
  ].map((file) => `${COMPAT}/${file}`),
] as const;

/** What the scene-meshes proof runs: the surface reader, planning, emission, the mesh compat. */
export const GODOT_SCENE_MESH_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/read/godot4-surfaces.ts',
  'packages/gd-analyze/src/read/array-mesh.ts',
  'packages/gd-analyze/src/read/binary-format.ts',
  'packages/gd-analyze/src/read/binary-document.ts',
  'packages/gd-analyze/src/translate/data/scene-document-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  ...['array-mesh.ts', 'mesh.ts', 'mesh-instance-3d.ts', 'base-material-3d.ts', 'image.ts', 'compressed-texture-2d.ts', 'label-3d.ts', 'font.ts', 'visual-instance-3d.ts'].map((file) => `${COMPAT}/${file}`),
] as const;

/** What the scene-audio proof runs: the sound reader, planning, emission, the audio compat. */
export const GODOT_SCENE_AUDIO_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/read/import-sidecar.ts',
  'packages/gd-analyze/src/analyze/bound-project.ts',
  'packages/gd-analyze/src/translate/data/scene-document-plan.ts',
  'packages/gd-analyze/src/translate/data/scene-setters.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  'packages/gd-analyze/src/translate/translation-plan.ts',
  ...['audio-stream.ts', 'audio-stream-wav.ts', 'audio-stream-randomizer.ts', 'audio-stream-player.ts', 'audio-stream-player-3d.ts', 'resource-loader.ts'].map((file) => `${COMPAT}/${file}`),
] as const;

/** What the scene-imported proof runs: the importer model, planning, emission, packed-scene. */
export const GODOT_SCENE_IMPORTED_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/read/gltf-godot-scene.ts',
  'packages/gd-analyze/src/analyze/bound-project.ts',
  'packages/gd-analyze/src/translate/data/scene-document-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  'packages/gd-analyze/src/translate/artifacts/asset-copy.ts',
  `${COMPAT}/packed-scene.tsx`,
  `${COMPAT}/node.ts`,
  `${COMPAT}/node-3d.ts`,
  `${COMPAT}/skeleton-3d.ts`,
  `${COMPAT}/quaternion.ts`,
  'packages/gd-analyze/src/translate/data/scene-setters.ts',
] as const;

/** What the scene-physics proof runs: planning, emission, the world hand-over and physics compat. */
export const GODOT_SCENE_PHYSICS_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/analyze/bound-project.ts',
  'packages/gd-analyze/src/translate/data/scene-node-authority.ts',
  'packages/gd-analyze/src/translate/data/scene-document-plan.ts',
  'packages/gd-analyze/src/translate/data/scene-setters.ts',
  'packages/gd-analyze/src/translate/data/direct-project-composition-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  'packages/gd-analyze/src/translate/emit/direct-project-world-syntax.ts',
  ...[
    'node.ts',
    'node-3d.ts',
    'scene-tree.ts',
    'world-3d.ts',
    'collision-object-3d.ts',
    'collision-shape-3d.ts',
    'shape-3d.ts',
    'box-shape-3d.ts',
    'sphere-shape-3d.ts',
    'capsule-shape-3d.ts',
    'convex-polygon-shape-3d.ts',
    'concave-polygon-shape-3d.ts',
    'physics-material.ts',
    'physics-body-3d.ts',
    'static-body-3d.ts',
    'rigid-body-3d.ts',
    'character-body-3d.ts',
    'area-3d.ts',
    'ray-cast-3d.ts',
    'marker-3d.ts',
    'physics-server-3d.ts',
    'physics-direct-space-state-3d.ts',
  ].map((file) => `${COMPAT}/${file}`),
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
    rules: supported
      ? [
          ...GODOT_4_7_SCENE_NODE_RULES,
          ...GODOT_4_7_STRUCTURE_NODE_RULES,
          ...GODOT_4_7_RENDER_NODE_RULES,
          ...GODOT_4_7_UI_NODE_RULES,
          ...GODOT_4_7_PHYSICS_NODE_RULES,
          ...GODOT_4_7_MESH_NODE_RULES,
          ...GODOT_4_7_AUDIO_NODE_RULES,
        ]
      : [],
    placementRules: supported ? GODOT_4_7_SCENE_PLACEMENT_RULES : [],
    propertyRules: supported
      ? [...GODOT_4_7_SCENE_PROPERTY_RULES, ...GODOT_4_7_STRUCTURE_PROPERTY_RULES]
      : [],
    structureRules: supported
      ? [...GODOT_4_7_STRUCTURE_RULES, ...GODOT_4_7_RENDER_STRUCTURE_RULES, ...GODOT_4_7_IMPORTED_STRUCTURE_RULES]
      : [],
    signalRules: supported ? [...GODOT_4_7_SIGNAL_RULES, ...GODOT_4_7_PHYSICS_SIGNAL_RULES] : [],
    resourceRules: supported
      ? [...GODOT_4_7_RENDER_RESOURCE_RULES, ...GODOT_4_7_UI_RESOURCE_RULES, ...GODOT_4_7_PHYSICS_RESOURCE_RULES, ...GODOT_4_7_TEXTURE_RESOURCE_RULES, ...GODOT_4_7_MESH_RESOURCE_RULES, ...GODOT_4_7_AUDIO_RESOURCE_RULES]
      : [],
    claims: supported
      ? [
          ...GODOT_4_7_SCENE_NODE_CLAIMS,
          ...GODOT_4_7_STRUCTURE_CLAIMS,
          ...GODOT_4_7_RENDER_CLAIMS,
          ...GODOT_4_7_UI_CLAIMS,
          ...GODOT_4_7_IMPORTED_CLAIMS,
          ...GODOT_4_7_PHYSICS_CLAIMS,
          ...GODOT_4_7_TEXTURE_CLAIMS,
          ...GODOT_4_7_MESH_CLAIMS,
          ...GODOT_4_7_AUDIO_CLAIMS,
        ]
      : [],
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
          ...withLiveImplementation(
            GODOT_4_7_RENDER_LIVENESS,
            monorepoImplementationDigest(GODOT_SCENE_RENDER_IMPLEMENTATION_FILES),
          ),
          ...withLiveImplementation(
            GODOT_4_7_UI_LIVENESS,
            monorepoImplementationDigest(GODOT_SCENE_UI_IMPLEMENTATION_FILES),
          ),
          ...withLiveImplementation(
            GODOT_4_7_IMPORTED_LIVENESS,
            monorepoImplementationDigest(GODOT_SCENE_IMPORTED_IMPLEMENTATION_FILES),
          ),
          ...withLiveImplementation(
            GODOT_4_7_PHYSICS_LIVENESS,
            monorepoImplementationDigest(GODOT_SCENE_PHYSICS_IMPLEMENTATION_FILES),
          ),
          ...withLiveImplementation(
            GODOT_4_7_TEXTURE_LIVENESS,
            monorepoImplementationDigest(GODOT_SCENE_TEXTURE_IMPLEMENTATION_FILES),
          ),
          ...withLiveImplementation(
            GODOT_4_7_MESH_LIVENESS,
            monorepoImplementationDigest(GODOT_SCENE_MESH_IMPLEMENTATION_FILES),
          ),
          ...withLiveImplementation(
            GODOT_4_7_AUDIO_LIVENESS,
            monorepoImplementationDigest(GODOT_SCENE_AUDIO_IMPLEMENTATION_FILES),
          ),
        ]
      : [],
  };
}
