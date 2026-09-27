/**
 * UI node families: canvas layers, Controls and their containers, labels and texture rects, 2D
 * nodes, sprites and touch-screen buttons, and the resources they take (canvas and placeholder
 * textures, label settings). Their own proof (`src/evidence/proofs/scene-ui.ts`) instantiates a
 * scene of them in official Godot and reads each node's layout back through Godot's getters
 * (global rects, sizes, minimum sizes, line counts, transforms), against the emitted component
 * mounted in Node and read through compat's getters.
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
  type GodotSceneResourceRule,
  godotSceneNodeRuleKey,
  godotSceneResourceRuleKey,
} from '../scene-node-authority';

const UI_IDENTITIES = godotProofIdentities('scene-ui');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;
const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

/** Each UI class: the compat element that writes it (`Godot<Class>` in its module), and its constructor. */
export const GODOT_4_7_UI_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = (
  [
    ['CanvasLayer', 'canvas-layer', 'scene/main/canvas_layer.cpp', 359],
    ['Control', 'control', 'scene/gui/control.cpp', 5161],
    ['HBoxContainer', 'h-box-container', 'scene/gui/box_container.h', 85],
    ['Label', 'label', 'scene/gui/label.cpp', 1526],
    ['TextureRect', 'texture-rect', 'scene/gui/texture_rect.cpp', 299],
    ['Node2D', 'node-2d', 'scene/2d/node_2d.cpp', 519],
    ['Sprite2D', 'sprite-2d', 'scene/2d/sprite_2d.cpp', 555],
    ['TouchScreenButton', 'touch-screen-button', 'scene/2d/physics/touch_screen_button.cpp', 458],
  ] as const
).map(([className, module, file, line]) => ({
  sourceRevision: REVISION,
  nativeCanonicalIdentity: identityOf(className),
  targetKind: 'three-node' as const,
  evidenceClaimId: `godot-4.7-scene-node-${module}`,
  source: { file, symbol: `${className}::${className}`, line },
}));

export const GODOT_4_7_UI_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['CanvasTexture', 'canvas-texture', 'godot_canvas_texture_new', 'scene/main/canvas_item.cpp', 2087],
    ['PlaceholderTexture2D', 'placeholder-texture-2d', 'godot_placeholder_texture_2d_new', 'scene/resources/placeholder_textures.cpp', 70],
    ['LabelSettings', 'label-settings', 'godot_label_settings_new', 'scene/resources/label_settings.h', 152],
  ] as const
).map(([className, module, exportName, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName },
  evidenceClaimId: `godot-4.7-scene-resource-${module}`,
  source: { file, symbol: `${className}::${className}`, line },
}));

function uiClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
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
      inputSha256: UI_IDENTITIES.input,
      callsite: 'res://observe.gd _process()',
      observedOutputSha256: UI_IDENTITIES.observed,
    },
    target: {
      implementationSha256: UI_IDENTITIES.implementation,
      callsite: 'emitted scene components mounted by @react-three/fiber, read through compat getters',
      observedOutputSha256: UI_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'canonical UI layout (global rects, sizes, minimum sizes, line counts, transforms) exact equality',
      tolerance: 'exact',
      resultSha256: UI_IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_UI_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_UI_NODE_RULES.map((rule) =>
    uiClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_UI_RESOURCE_RULES.map((rule) =>
    uiClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_UI_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_UI_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: UI_IDENTITIES.input,
  implementationSha256: UI_IDENTITIES.implementation,
}));
