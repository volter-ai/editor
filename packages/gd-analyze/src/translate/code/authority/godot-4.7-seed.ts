import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import type { GodotCodeClaimLiveness } from '../authority';
import {
  type GodotCodeRuleEntry,
  type GodotDatatypeRuleEntry,
  godotCodeRuleKey,
  godotDatatypeRuleKey,
} from '../lowering-rules';

export const GODOT_4_7_CODE_SEED_SOURCE_REVISION =
  '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88' as const;
export const GODOT_4_7_CODE_SEED_API_DUMP_SHA256 =
  '53d37f85be32b6d10fb2266ca51f6ef0c3a55728acdb7c8301b1458a93c00943' as const;
export const GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f' as const;
export const GODOT_4_7_CODE_SEED_INPUT_SHA256 =
  '6a4c7bfb02cb3f0f2791e18120a16dde30cf7d4d847ea93001bc51b5f33b1727' as const;
export const GODOT_4_7_CODE_SEED_IMPLEMENTATION_SHA256 =
  'c67ef03ea4a1338955a8fc9b660aaeac5abfce940408f1a92dccae9ac6586aa4' as const;
export const GODOT_4_7_CODE_SEED_OBSERVED_OUTPUT_SHA256 =
  'dc60e632a90329ccfd34fbe904d94704dbbb6669575185e26389854ff64139c3' as const;
export const GODOT_4_7_CODE_SEED_COMPARISON_SHA256 =
  '9600eeca5b28a40860a3f9476be0fb8bf21a223a567371509a7669525fc0feeb' as const;

const INT_VALUE =
  'BUILTIN|ANNOTATED_EXPLICIT|int|int|||||constant|writable|instance|concrete|sync|[]';
const INT_TYPE =
  'BUILTIN|ANNOTATED_EXPLICIT|int|int|||||mutable|writable|instance|concrete|sync|[]';

export const GODOT_4_7_CODE_SEED_RULES: readonly GodotCodeRuleEntry[] = [
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'CLASS',
      semanticKey: 'class:concrete|annotations:[]',
      inputDatatypes: [],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'class' },
    evidenceClaimId: 'godot-4.7-code-seed-class',
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'FUNCTION',
      semanticKey: 'function:static:synchronous|annotations:[]',
      inputDatatypes: [],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'function' },
    evidenceClaimId: 'godot-4.7-code-seed-function',
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'SUITE',
      semanticKey: 'suite|annotations:[]',
      inputDatatypes: [],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'suite' },
    evidenceClaimId: 'godot-4.7-code-seed-suite',
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'RETURN',
      semanticKey: 'return:value|annotations:[]',
      inputDatatypes: [INT_VALUE],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'return' },
    evidenceClaimId: 'godot-4.7-code-seed-return-int',
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'LITERAL',
      semanticKey: 'literal:int:reduced|annotations:[]',
      inputDatatypes: [],
      resultDatatype: INT_VALUE,
    },
    target: { kind: 'structural', construct: 'literal' },
    evidenceClaimId: 'godot-4.7-code-seed-literal-int',
  },
];

export const GODOT_4_7_CODE_SEED_DATATYPES: readonly GodotDatatypeRuleEntry[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    sourceDatatype: INT_TYPE,
    targetType: { kind: 'keyword-type', keyword: 'number' },
    evidenceClaimId: 'godot-4.7-code-seed-datatype-int',
  },
];

const reproductionCommand = [
  'npm',
  'run',
  'godot-code-authority-seed-proof',
  '-w',
  '@vgai/gd-analyze',
  '--',
  '--exporter-binary',
  '.vgai/tmp/godot-bound-exporter/godot-4.7-bound-exporter-arm64',
  '--official-binary',
  '.vgai/tmp/godot-4.7-stable/Godot.app/Contents/MacOS/Godot',
] as const;

function claim(
  claimId: string,
  canonicalIdentity: string,
  sourceSymbol: string,
  sourceLine: number,
): SemanticClaimRecord {
  return {
    registryVersion: 1,
    claimId,
    layer: 'translate-code',
    canonicalIdentity,
    godot: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: sourceSymbol.startsWith('GDScriptAnalyzer::')
        ? 'modules/gdscript/gdscript_analyzer.cpp'
        : 'modules/gdscript/gdscript_parser.cpp',
      sourceSymbol,
      sourceLine,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: GODOT_4_7_CODE_SEED_INPUT_SHA256,
      callsite: 'res://answer.gd:4 Answer.answer()',
      observedOutputSha256: GODOT_4_7_CODE_SEED_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_CODE_SEED_IMPLEMENTATION_SHA256,
      callsite: 'printed TargetTsSyntax Answer.answer()',
      observedOutputSha256: GODOT_4_7_CODE_SEED_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'canonical JSON exact equality',
      tolerance: 'exact',
      resultSha256: GODOT_4_7_CODE_SEED_COMPARISON_SHA256,
    },
    reproductionCommand,
  };
}

function codeRuleClaim(entry: GodotCodeRuleEntry): SemanticClaimRecord {
  switch (entry.source.nodeKind) {
    case 'CLASS':
      return claim(
        entry.evidenceClaimId,
        godotCodeRuleKey(entry.source),
        'GDScriptParser::parse_class',
        938,
      );
    case 'FUNCTION':
      return claim(
        entry.evidenceClaimId,
        godotCodeRuleKey(entry.source),
        'GDScriptParser::parse_function',
        1777,
      );
    case 'SUITE':
      return claim(
        entry.evidenceClaimId,
        godotCodeRuleKey(entry.source),
        'GDScriptParser::parse_suite',
        1938,
      );
    case 'RETURN':
      return claim(
        entry.evidenceClaimId,
        godotCodeRuleKey(entry.source),
        'GDScriptParser::parse_statement/RETURN',
        2091,
      );
    case 'LITERAL':
      return claim(
        entry.evidenceClaimId,
        godotCodeRuleKey(entry.source),
        'GDScriptParser::parse_literal',
        2880,
      );
    default:
      throw new Error(`missing source citation for ${entry.source.nodeKind}`);
  }
}

export const GODOT_4_7_CODE_SEED_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_CODE_SEED_RULES.map(codeRuleClaim),
  ...GODOT_4_7_CODE_SEED_DATATYPES.map((entry) =>
    claim(
      entry.evidenceClaimId,
      godotDatatypeRuleKey(entry),
      'GDScriptAnalyzer::resolve_function_signature',
      1855,
    ),
  ),
];

export const GODOT_4_7_CODE_SEED_LIVENESS: readonly GodotCodeClaimLiveness[] =
  GODOT_4_7_CODE_SEED_CLAIMS.map((entry) => ({
    claimId: entry.claimId,
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256: GODOT_4_7_CODE_SEED_INPUT_SHA256,
    implementationSha256: GODOT_4_7_CODE_SEED_IMPLEMENTATION_SHA256,
  }));
