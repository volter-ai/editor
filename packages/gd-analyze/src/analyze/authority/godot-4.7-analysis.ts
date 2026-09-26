import type { SemanticClaimRecord } from '../../godot-frontend/semantic-claims';
import {
  type GodotAnalysisClaimLiveness,
  type GodotAnalysisRule,
  godotAnalysisRuleKey,
} from '../authority';

const SOURCE_REVISION = '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88' as const;
const API_DUMP_SHA256 = '53d37f85be32b6d10fb2266ca51f6ef0c3a55728acdb7c8301b1458a93c00943' as const;
const NATIVE_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f' as const;

export const GODOT_4_7_ANALYSIS_INPUT_SHA256 =
  'b4aebbebba5ed7b1ee33656e56ade38168f773e5363d76420bf3ac60ca14e893' as const;
export const GODOT_4_7_ANALYSIS_IMPLEMENTATION_SHA256 =
  '90a26b8e9e3b8feb0bbc3d240e9455c4b00dab73150bbe10c922342ccc8e7665' as const;
export const GODOT_4_7_ANALYSIS_OBSERVED_OUTPUT_SHA256 =
  '968b4b3f04e905b9add12f569288d93638589439fd82599901b2d0cf092d2839' as const;
export const GODOT_4_7_ANALYSIS_COMPARISON_SHA256 =
  '43aef6142fd749e34e5f9a6aa2b1c78fbefdb3dadada3763f66a795bba58f626' as const;

export const GODOT_4_7_ANALYSIS_RULES: readonly GodotAnalysisRule[] = (
  [
    'native-ancestry',
    'script-inheritance',
    'lifecycle-selection',
    'scene-class-resolution',
    'field-attachment-join',
  ] as const
).map((id) => ({
  id,
  sourceRevision: SOURCE_REVISION,
  evidenceClaimId: `godot-4.7-analysis-${id}`,
}));

const reproductionCommand = [
  'npm',
  'run',
  'godot-bound-relationships-proof',
  '-w',
  '@vgai/gd-analyze',
  '--',
  '--exporter-binary',
  '.vgai/tmp/godot-bound-exporter/godot-4.7-bound-exporter-arm64',
  '--official-binary',
  '.vgai/tmp/godot-4.7-stable/Godot.app/Contents/MacOS/Godot',
] as const;

const sources: Readonly<
  Record<GodotAnalysisRule['id'], Readonly<{ file: string; symbol: string; line: number }>>
> = {
  'native-ancestry': {
    file: 'core/object/class_db.cpp',
    symbol: 'ClassDB::get_parent_class_nocheck',
    line: 323,
  },
  'script-inheritance': {
    file: 'modules/gdscript/gdscript_analyzer.cpp',
    symbol: 'GDScriptAnalyzer::resolve_class_inheritance',
    line: 346,
  },
  'lifecycle-selection': {
    file: 'scene/main/node.cpp',
    symbol: 'Node::_notification',
    line: 68,
  },
  'scene-class-resolution': {
    file: 'scene/resources/packed_scene.cpp',
    symbol: 'SceneState::instantiate',
    line: 318,
  },
  'field-attachment-join': {
    file: 'scene/resources/packed_scene.cpp',
    symbol: 'SceneState::instantiate',
    line: 364,
  },
};

function claim(rule: GodotAnalysisRule): SemanticClaimRecord {
  const source = sources[rule.id];
  return {
    registryVersion: 1,
    claimId: rule.evidenceClaimId,
    layer: 'analyze',
    canonicalIdentity: godotAnalysisRuleKey(SOURCE_REVISION, rule.id),
    godot: {
      sourceRevision: SOURCE_REVISION,
      apiDumpSha256: API_DUMP_SHA256,
      sourceFile: source.file,
      sourceSymbol: source.symbol,
      sourceLine: source.line,
    },
    native: {
      executableSha256: NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: GODOT_4_7_ANALYSIS_INPUT_SHA256,
      callsite: 'res://main.gd:9 _ready()',
      observedOutputSha256: GODOT_4_7_ANALYSIS_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_ANALYSIS_IMPLEMENTATION_SHA256,
      callsite:
        'bindGodotProject(snapshot, boundProgram, resourceProgram, authorities, apiDump, read)',
      observedOutputSha256: GODOT_4_7_ANALYSIS_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'canonical relationship verdict exact equality',
      tolerance: 'exact',
      resultSha256: GODOT_4_7_ANALYSIS_COMPARISON_SHA256,
    },
    reproductionCommand,
  };
}

export const GODOT_4_7_ANALYSIS_CLAIMS: readonly SemanticClaimRecord[] =
  GODOT_4_7_ANALYSIS_RULES.map(claim);

export const GODOT_4_7_ANALYSIS_LIVENESS: readonly GodotAnalysisClaimLiveness[] =
  GODOT_4_7_ANALYSIS_CLAIMS.map((entry) => ({
    claimId: entry.claimId,
    sourceRevision: SOURCE_REVISION,
    apiDumpSha256: API_DUMP_SHA256,
    executableSha256: NATIVE_EXECUTABLE_SHA256,
    inputSha256: GODOT_4_7_ANALYSIS_INPUT_SHA256,
    implementationSha256: GODOT_4_7_ANALYSIS_IMPLEMENTATION_SHA256,
  }));
