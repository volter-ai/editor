import {
  GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  type GodotProofName,
  godotProofIdentities,
} from '../../godot-frontend/proof-identities';
import type { SemanticClaimRecord } from '../../godot-frontend/semantic-claims';
import {
  type GodotAnalysisClaimLiveness,
  type GodotAnalysisRule,
  type GodotAnalysisRuleId,
  godotAnalysisRuleKey,
} from '../authority';

const SOURCE_REVISION = '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88' as const;
const API_DUMP_SHA256 = '53d37f85be32b6d10fb2266ca51f6ef0c3a55728acdb7c8301b1458a93c00943' as const;
const NATIVE_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f' as const;

const ANALYSIS_IDENTITIES = godotProofIdentities('analysis');
export const GODOT_4_7_ANALYSIS_INPUT_SHA256 = ANALYSIS_IDENTITIES.input;
export const GODOT_4_7_ANALYSIS_IMPLEMENTATION_SHA256 = ANALYSIS_IDENTITIES.implementation;
export const GODOT_4_7_ANALYSIS_OBSERVED_OUTPUT_SHA256 = ANALYSIS_IDENTITIES.observed;
export const GODOT_4_7_ANALYSIS_COMPARISON_SHA256 = ANALYSIS_IDENTITIES.comparison;

const PROVEN_RULE_IDS = [
  'native-ancestry',
  'script-inheritance',
  'lifecycle-selection',
  'scene-class-resolution',
  'field-attachment-join',
] as const;

export const GODOT_4_7_ANALYSIS_RULES: readonly GodotAnalysisRule[] = PROVEN_RULE_IDS.map((id) => ({
  id,
  sourceRevision: SOURCE_REVISION,
  evidenceClaimId: `godot-4.7-analysis-${id}`,
}));

const reproductionCommand = GODOT_4_7_PROOF_REPRODUCTION_COMMAND;

// Only the rules this proof measured. A rule added later carries its own evidence record; it is
// never minted from this proof's digests.
type ProvenRuleId = (typeof PROVEN_RULE_IDS)[number];

const sources: Readonly<
  Record<ProvenRuleId, Readonly<{ file: string; symbol: string; line: number }>>
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
  const source = sources[rule.id as ProvenRuleId];
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

type ProofSource = Readonly<{ file: string; symbol: string; line: number }>;

/** Claims for rules proven by their own proof (its identity set in `proof-<name>.json`). */
function provenRules(
  proof: GodotProofName,
  sources: Readonly<Partial<Record<GodotAnalysisRuleId, ProofSource>>>,
  callsites: { readonly native: string; readonly target: string; readonly comparator: string },
): {
  readonly rules: readonly GodotAnalysisRule[];
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly GodotAnalysisClaimLiveness[];
} {
  const identities = godotProofIdentities(proof);
  const rules = (Object.keys(sources) as GodotAnalysisRuleId[]).map((id) => ({
    id,
    sourceRevision: SOURCE_REVISION,
    evidenceClaimId: `godot-4.7-analysis-${id}`,
  }));
  const claims = rules.map((rule): SemanticClaimRecord => {
    const source = sources[rule.id] as ProofSource;
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
        inputSha256: identities.input,
        callsite: callsites.native,
        observedOutputSha256: identities.observed,
      },
      target: {
        implementationSha256: identities.implementation,
        callsite: callsites.target,
        observedOutputSha256: identities.observed,
      },
      comparison: {
        comparator: callsites.comparator,
        tolerance: 'exact',
        resultSha256: identities.comparison,
      },
      reproductionCommand,
    };
  });
  const liveness = claims.map((entry) => ({
    claimId: entry.claimId,
    sourceRevision: SOURCE_REVISION,
    apiDumpSha256: API_DUMP_SHA256,
    executableSha256: NATIVE_EXECUTABLE_SHA256,
    inputSha256: identities.input,
    implementationSha256: identities.implementation,
  }));
  return { rules, claims, liveness };
}

// Receiver typing (`src/analyze/call-receivers.ts`): official Godot's
// `get_node(path).get_class()` and ClassDB's declaring class for every call the analysis typed.
export const GODOT_4_7_RECEIVER_PROOF = provenRules(
  'receivers',
  {
    'scene-node-receiver': { file: 'scene/main/node.cpp', symbol: 'Node::get_node_or_null', line: 1904 },
    'classdb-method-selection': { file: 'core/object/class_db.cpp', symbol: 'ClassDB::get_method', line: 1132 },
  },
  {
    native: 'res://main.gd _ready()',
    target: 'typeCallReceivers(inputs) through bindGodotProject',
    comparator: 'canonical receiver typing exact equality',
  },
);

// Setting types (`src/analyze/project-setting-types.ts`): official Godot's
// `typeof(ProjectSettings.get_setting(key))` (and of operators over such values) against the types
// the analysis gave the same calls.
export const GODOT_4_7_PROJECT_SETTING_PROOF = provenRules(
  'project-settings',
  {
    'project-setting-type': {
      file: 'core/config/project_settings.cpp',
      symbol: 'ProjectSettings::get_setting_with_override',
      line: 415,
    },
  },
  {
    native: 'res://main.gd _ready()',
    target: 'typeProjectSettingValues(inputs) through bindGodotProject',
    comparator: 'canonical setting types exact equality',
  },
);
