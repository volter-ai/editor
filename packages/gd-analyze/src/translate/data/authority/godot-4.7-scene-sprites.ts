/**
 * Sprites: `Sprite3D` and `AnimatedSprite3D` nodes (compat's `<GodotSprite3D>` and
 * `<GodotAnimatedSprite3D>`, a three `Mesh` whose quad compat draws), the `SpriteFrames` and
 * `AtlasTexture` resources their frames are, and an AnimatedSprite3D's `animation_finished`
 * connection. Their own proof (`src/evidence/proofs/scene-sprites.ts`) imports the fps kit's
 * sprite images, instantiates a scene of them in official Godot, plays them from a script and reads
 * each sprite back frame by frame, against the emitted scene mounted in Node and stepped by compat's
 * tree clock.
 */
import {
  GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  godotProofIdentities,
} from '../../../godot-frontend/proof-identities';
import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../../code/authority/godot-4.7-seed';
import {
  type GodotSceneNodeClaimLiveness,
  type GodotSceneNodeRule,
  godotSceneNodeRuleKey,
  type GodotSceneResourceRule,
  godotSceneResourceRuleKey,
  type GodotSceneSignalRule,
  godotSceneSignalRuleKey,
} from '../scene-node-authority';

const SPRITE_IDENTITIES = godotProofIdentities('scene-sprites');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

export const GODOT_4_7_SPRITE_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Sprite3D'),
    targetKind: 'three-mesh',
    evidenceClaimId: 'godot-4.7-scene-node-sprite-3d',
    source: { file: 'scene/3d/sprite_3d.cpp', symbol: 'Sprite3D::Sprite3D', line: 1030 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('AnimatedSprite3D'),
    targetKind: 'three-mesh',
    evidenceClaimId: 'godot-4.7-scene-node-animated-sprite-3d',
    source: { file: 'scene/3d/sprite_3d.cpp', symbol: 'AnimatedSprite3D::AnimatedSprite3D', line: 1563 },
  },
];

export const GODOT_4_7_SPRITE_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['SpriteFrames', 'sprite-frames', 'godot_sprite_frames_new', 'scene/resources/sprite_frames.cpp', 206],
    ['AtlasTexture', 'atlas-texture', 'godot_atlas_texture_new', 'scene/resources/atlas_texture.cpp', 74],
  ] as const
).map(([className, module, exportName, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName },
  evidenceClaimId: `godot-4.7-scene-resource-${module}`,
  source: { file, symbol: `${className}::${className}`, line },
}));

/** An AnimatedSprite3D's `animation_finished`, connected through compat's signal accessor. */
export const GODOT_4_7_SPRITE_SIGNAL_RULES: readonly (GodotSceneSignalRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    ownerClass: 'AnimatedSprite3D',
    signal: 'animation_finished',
    accessor: { module: 'lib/godot-compat/animated-sprite-3d', exportName: 'godot_animated_sprite_3d_signal', named: true },
    arguments: 0,
    evidenceClaimId: 'godot-4.7-scene-connection-animated-sprite-3d-animation-finished',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (connections)', line: 682 },
  },
];

function spriteClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
  return {
    registryVersion: 1,
    claimId,
    layer: 'translate-data',
    canonicalIdentity,
    godot: {
      sourceRevision: REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: source.file,
      sourceSymbol: source.symbol,
      sourceLine: source.line,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: SPRITE_IDENTITIES.input,
      callsite: 'res://observe.gd process_frame',
      observedOutputSha256: SPRITE_IDENTITIES.observed,
    },
    target: {
      implementationSha256: SPRITE_IDENTITIES.implementation,
      callsite: 'emitted scene components mounted by @react-three/fiber, stepped by compat scene-tree, read through compat',
      observedOutputSha256: SPRITE_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'per-frame sprite state (animation, frame, progress, playing, AABB, drawn, texture size) and the finished handler exact equality',
      tolerance: 'exact',
      resultSha256: SPRITE_IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_SPRITE_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_SPRITE_RESOURCE_RULES.map((rule) => spriteClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source)),
  ...GODOT_4_7_SPRITE_NODE_RULES.map((rule) => spriteClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source)),
  ...GODOT_4_7_SPRITE_SIGNAL_RULES.map((rule) => spriteClaim(godotSceneSignalRuleKey(rule.sourceRevision, rule.ownerClass, rule.signal), rule.evidenceClaimId, rule.source)),
];

export const GODOT_4_7_SPRITE_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_SPRITE_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: SPRITE_IDENTITIES.input,
  implementationSha256: SPRITE_IDENTITIES.implementation,
}));
