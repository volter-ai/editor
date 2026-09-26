import {
  BOUND_GODOT_AUTOLOAD_REFERENCE_CLAIM_ID,
  boundGodotAutoloadReferenceCanonicalIdentity,
} from '../../../analyze/bound-autoload-references';
import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import type { GodotCodeClaimLiveness } from '../authority';
import { type GodotCodeRuleEntry, godotCodeRuleKey } from '../lowering-rules';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from './godot-4.7-seed';

export const GODOT_4_7_AUTOLOAD_REFERENCE_INPUT_SHA256 =
  'dbc0b83584a02bbd82e8649c50685aa55cde9f725f8e1ee137e2ac6971ecfb16' as const;
export const GODOT_4_7_AUTOLOAD_REFERENCE_IMPLEMENTATION_SHA256 =
  '72d17a013b0c9fd19d70f7f53df02bf2f300caa6467158455c7e178b7e8f1a35' as const;
export const GODOT_4_7_AUTOLOAD_REFERENCE_OBSERVED_OUTPUT_SHA256 =
  '2f5302b341be7f84e789420e4ae41c7942001c9659a550adedd3d082a7fdcd94' as const;
export const GODOT_4_7_AUTOLOAD_REFERENCE_COMPARISON_SHA256 =
  'c8e41273f85a17ee811c7e24dfdd75dff228975244dca5f780b443c5a42c13a6' as const;

export const GODOT_4_7_AUTOLOAD_REFERENCE_RULES: readonly GodotCodeRuleEntry[] = [
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'IDENTIFIER',
      semanticKey: 'autoload-identifier:resolved-script-singleton|annotations:[]',
      inputDatatypes: [],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'autoload-identifier' },
    evidenceClaimId: 'godot-4.7-autoload-script-singleton-identifier',
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'RETURN',
      semanticKey: 'return:value|annotations:[]',
      inputDatatypes: [
        'CLASS|ANNOTATED_EXPLICIT|SettingsState|Object|Node||res://settings.gd|SettingsState|constant|writable|instance|concrete|sync|[]',
      ],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'return' },
    evidenceClaimId: 'godot-4.7-autoload-script-singleton-return-settings',
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'RETURN',
      semanticKey: 'return:value|annotations:[]',
      inputDatatypes: [
        'CLASS|ANNOTATED_EXPLICIT|GlobalsState|Object|Node||res://globals.gd|GlobalsState|constant|writable|instance|concrete|sync|[]',
      ],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'return' },
    evidenceClaimId: 'godot-4.7-autoload-script-singleton-return-globals',
  },
];

const reproductionCommand = [
  'npm',
  'run',
  'godot-autoload-reference-proof',
  '-w',
  '@vgai/gd-analyze',
  '--',
  '--exporter-binary',
  '.vgai/tmp/godot-bound-exporter/godot-4.7-bound-exporter-arm64',
  '--official-binary',
  '.vgai/tmp/godot-4.7-stable/Godot.app/Contents/MacOS/Godot',
] as const;

const analysisClaim: SemanticClaimRecord = {
  registryVersion: 1,
  claimId: BOUND_GODOT_AUTOLOAD_REFERENCE_CLAIM_ID,
  layer: 'analyze',
  canonicalIdentity: boundGodotAutoloadReferenceCanonicalIdentity(
    GODOT_4_7_CODE_SEED_SOURCE_REVISION,
  ),
  godot: {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    sourceFile: 'modules/gdscript/gdscript_analyzer.cpp',
    sourceSymbol: 'GDScriptAnalyzer::reduce_identifier autoload singleton branch',
    sourceLine: 4577,
  },
  native: {
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
    inputSha256: GODOT_4_7_AUTOLOAD_REFERENCE_INPUT_SHA256,
    callsite:
      'ProjectSettings autoload singleton resolution at res://globals.gd:5 and res://consumer_base.gd:5',
    observedOutputSha256: GODOT_4_7_AUTOLOAD_REFERENCE_OBSERVED_OUTPUT_SHA256,
  },
  target: {
    implementationSha256: GODOT_4_7_AUTOLOAD_REFERENCE_IMPLEMENTATION_SHA256,
    callsite: 'bindGodotScriptSingletonReferences official-node identity join',
    observedOutputSha256: GODOT_4_7_AUTOLOAD_REFERENCE_OBSERVED_OUTPUT_SHA256,
  },
  comparison: {
    comparator: 'canonical JSON exact equality',
    tolerance: 'exact',
    resultSha256: GODOT_4_7_AUTOLOAD_REFERENCE_COMPARISON_SHA256,
  },
  reproductionCommand,
};

export const GODOT_4_7_AUTOLOAD_REFERENCE_CLAIMS: readonly SemanticClaimRecord[] = [
  analysisClaim,
  ...GODOT_4_7_AUTOLOAD_REFERENCE_RULES.map(
    (rule): SemanticClaimRecord => ({
      registryVersion: 1,
      claimId: rule.evidenceClaimId,
      layer: 'translate-code',
      canonicalIdentity: godotCodeRuleKey(rule.source),
      godot: {
        sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
        apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
        sourceFile:
          rule.source.nodeKind === 'IDENTIFIER'
            ? 'modules/gdscript/gdscript_analyzer.cpp'
            : 'modules/gdscript/gdscript_parser.cpp',
        sourceSymbol:
          rule.source.nodeKind === 'IDENTIFIER'
            ? 'GDScriptAnalyzer::reduce_identifier autoload singleton branch'
            : 'GDScriptParser::parse_statement/RETURN',
        sourceLine: rule.source.nodeKind === 'IDENTIFIER' ? 4577 : 2091,
      },
      native: {
        executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
        buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
        inputSha256: GODOT_4_7_AUTOLOAD_REFERENCE_INPUT_SHA256,
        callsite:
          'res://consumer_base.gd:5 ConsumerBase.globals_singleton() and res://globals.gd:5 GlobalsState.settings_singleton()',
        observedOutputSha256: GODOT_4_7_AUTOLOAD_REFERENCE_OBSERVED_OUTPUT_SHA256,
      },
      target: {
        implementationSha256: GODOT_4_7_AUTOLOAD_REFERENCE_IMPLEMENTATION_SHA256,
        callsite:
          'ConsumerBase.globals_singleton() and GlobalsState.settings_singleton() direct typed composition binding',
        observedOutputSha256: GODOT_4_7_AUTOLOAD_REFERENCE_OBSERVED_OUTPUT_SHA256,
      },
      comparison: {
        comparator: 'canonical JSON exact equality',
        tolerance: 'exact',
        resultSha256: GODOT_4_7_AUTOLOAD_REFERENCE_COMPARISON_SHA256,
      },
      reproductionCommand,
    }),
  ),
];

export const GODOT_4_7_AUTOLOAD_REFERENCE_LIVENESS: readonly GodotCodeClaimLiveness[] =
  GODOT_4_7_AUTOLOAD_REFERENCE_CLAIMS.map((claim) => ({
    claimId: claim.claimId,
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256: GODOT_4_7_AUTOLOAD_REFERENCE_INPUT_SHA256,
    implementationSha256: GODOT_4_7_AUTOLOAD_REFERENCE_IMPLEMENTATION_SHA256,
  }));
