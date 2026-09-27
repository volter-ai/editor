import {
  GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  godotProofIdentities,
} from '../../../godot-frontend/proof-identities';
import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import type { GodotCodeClaimLiveness } from '../authority';
import { type GodotBindingEntry, godotOfficialSymbolKey } from '../bindings';
import { type GodotCodeRuleEntry, godotCodeRuleKey } from '../lowering-rules';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from './godot-4.7-seed';

/**
 * A script instantiating a project scene: `preload("res://x.tscn")` and `PackedScene.instantiate`,
 * measured by the scene-spawn proof (a scene spawned from `_ready` and one from `_physics_process`,
 * added, moved and freed, against official Godot).
 */
const SCENE_SPAWN_IDENTITIES = godotProofIdentities('scene-spawn');
export const GODOT_4_7_SCENE_SPAWN_INPUT_SHA256 = SCENE_SPAWN_IDENTITIES.input;
export const GODOT_4_7_SCENE_SPAWN_IMPLEMENTATION_SHA256 = SCENE_SPAWN_IDENTITIES.implementation;
export const GODOT_4_7_SCENE_SPAWN_OBSERVED_OUTPUT_SHA256 = SCENE_SPAWN_IDENTITIES.observed;
export const GODOT_4_7_SCENE_SPAWN_COMPARISON_SHA256 = SCENE_SPAWN_IDENTITIES.comparison;

const INSTANTIATE_CLAIM = 'godot-4.7-binding-PackedScene.instantiate';
const PRELOAD_CLAIM = 'godot-4.7-preload-packed-scene';

export const GODOT_4_7_SCENE_SPAWN_BINDINGS: readonly GodotBindingEntry[] = [
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      owner: 'PackedScene',
      member: 'instantiate',
      kind: 'native-member',
      signature: 'hash:2628778455',
    },
    target: {
      kind: 'compat-binding',
      capabilityId: 'godot-compat',
      module: 'lib/godot-compat/packed-scene-instance',
      exportName: 'instantiate',
      localName: 'PackedScene_instantiate',
      use: { kind: 'call', sourceReceiver: 'first-argument' },
      evidenceClaimId: INSTANTIATE_CLAIM,
    },
  },
];

export const GODOT_4_7_SCENE_SPAWN_RULES: readonly GodotCodeRuleEntry[] = [
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'PRELOAD',
      semanticKey: 'preload:packed-scene|annotations:[]',
      inputDatatypes: [],
      resultDatatype: 'NATIVE:PackedScene',
    },
    target: { kind: 'structural', construct: 'preload' },
    evidenceClaimId: PRELOAD_CLAIM,
  },
];

function claim(
  claimId: string,
  layer: SemanticClaimRecord['layer'],
  canonicalIdentity: string,
  source: { readonly file: string; readonly symbol: string; readonly line: number },
  targetCallsite: string,
): SemanticClaimRecord {
  return {
    registryVersion: 1,
    claimId,
    layer,
    canonicalIdentity,
    godot: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: source.file,
      sourceSymbol: source.symbol,
      sourceLine: source.line,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: GODOT_4_7_SCENE_SPAWN_INPUT_SHA256,
      callsite: 'res://main.gd _ready() and _physics_process(): preload("res://shot.tscn").instantiate(), add_child, queue_free',
      observedOutputSha256: GODOT_4_7_SCENE_SPAWN_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_SCENE_SPAWN_IMPLEMENTATION_SHA256,
      callsite: targetCallsite,
      observedOutputSha256: GODOT_4_7_SCENE_SPAWN_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'canonical JSON exact equality',
      tolerance: 'exact',
      resultSha256: GODOT_4_7_SCENE_SPAWN_COMPARISON_SHA256,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_SCENE_SPAWN_CLAIMS: readonly SemanticClaimRecord[] = [
  claim(
    INSTANTIATE_CLAIM,
    'binding',
    godotOfficialSymbolKey((GODOT_4_7_SCENE_SPAWN_BINDINGS[0] as GodotBindingEntry).source),
    { file: 'scene/resources/packed_scene.cpp', symbol: 'PackedScene::instantiate', line: 2507 },
    'lib/godot-compat/packed-scene-instance.tsx instantiate',
  ),
  claim(
    PRELOAD_CLAIM,
    'translate-code',
    godotCodeRuleKey((GODOT_4_7_SCENE_SPAWN_RULES[0] as GodotCodeRuleEntry).source),
    { file: 'modules/gdscript/gdscript_analyzer.cpp', symbol: 'GDScriptAnalyzer::reduce_preload', line: 4723 },
    'lower-official-expression PRELOAD godot_packed_scene_preload',
  ),
];

export const GODOT_4_7_SCENE_SPAWN_LIVENESS: readonly GodotCodeClaimLiveness[] = GODOT_4_7_SCENE_SPAWN_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: GODOT_4_7_SCENE_SPAWN_INPUT_SHA256,
  implementationSha256: GODOT_4_7_SCENE_SPAWN_IMPLEMENTATION_SHA256,
}));
