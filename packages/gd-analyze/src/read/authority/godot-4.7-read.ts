import type { SemanticClaimRecord } from '../../godot-frontend/semantic-claims';
import { type GodotReadClaimLiveness, type GodotReadRule, godotReadRuleKey } from '../authority';

const SOURCE_REVISION = '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88' as const;
const API_DUMP_SHA256 = '53d37f85be32b6d10fb2266ca51f6ef0c3a55728acdb7c8301b1458a93c00943' as const;
const NATIVE_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f' as const;

// These exact pins are refreshed only by scripts/prove-read-authority.ts. A changed reader is a
// stale authority until the official 4.7 executable produces the same observation again.
export const GODOT_4_7_READ_INPUT_SHA256 =
  'e985c1c90d96810aec031ce311cbb6f3fda48a5badbede0037aebaa334150482' as const;
export const GODOT_4_7_READ_IMPLEMENTATION_SHA256 =
  '5a1c6251e2cc5277b314c055d42b73c52cc70a3961ff3f3590aae8b7afb07d73' as const;
export const GODOT_4_7_READ_OBSERVED_OUTPUT_SHA256 =
  '1f3e05ab579d7aca6e57482fa53967b8df6c659fbadd558915ee0b62938cc4bf' as const;
export const GODOT_4_7_READ_COMPARISON_SHA256 =
  '94ef8325da5585ee675cca989005a7a8a748651edcc847171c047374be73a09c' as const;

export const GODOT_4_7_READ_RULES: readonly GodotReadRule[] = [
  {
    id: 'project-settings',
    sourceRevision: SOURCE_REVISION,
    evidenceClaimId: 'godot-4.7-read-project-settings',
  },
  {
    id: 'text-resource',
    sourceRevision: SOURCE_REVISION,
    evidenceClaimId: 'godot-4.7-read-text-resource',
  },
  {
    id: 'obj-import-options',
    sourceRevision: SOURCE_REVISION,
    evidenceClaimId: 'godot-4.7-read-obj-import-options',
  },
  {
    id: 'cubemap-import-options',
    sourceRevision: SOURCE_REVISION,
    evidenceClaimId: 'godot-4.7-read-cubemap-import-options',
  },
];

const reproductionCommand = [
  'npm',
  'run',
  'godot-read-proof',
  '-w',
  '@volter/gd-analyze',
  '--',
  '--official-binary',
  '.vgai/tmp/godot-4.7-stable/Godot.app/Contents/MacOS/Godot',
] as const;

const sources: Readonly<
  Record<GodotReadRule['id'], Readonly<{ file: string; symbol: string; line: number }>>
> = {
  'project-settings': {
    file: 'servers/physics_3d/physics_server_3d.cpp',
    symbol: 'PhysicsServer3D::PhysicsServer3D',
    line: 1142,
  },
  'text-resource': {
    file: 'scene/resources/resource_format_text.cpp',
    symbol: 'ResourceLoaderText::_parse_node_tag',
    line: 184,
  },
  'obj-import-options': {
    file: 'editor/import/3d/resource_importer_obj.cpp',
    symbol: 'ResourceImporterOBJ::get_import_options',
    line: 642,
  },
  'cubemap-import-options': {
    file: 'editor/import/resource_importer_layered_texture.cpp',
    symbol: 'ResourceImporterLayeredTexture::get_import_options',
    line: 162,
  },
};

function claim(rule: GodotReadRule): SemanticClaimRecord {
  const source = sources[rule.id];
  return {
    registryVersion: 1,
    claimId: rule.evidenceClaimId,
    layer: 'read',
    canonicalIdentity: godotReadRuleKey(SOURCE_REVISION, rule.id),
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
      inputSha256: GODOT_4_7_READ_INPUT_SHA256,
      callsite: 'res://read_probe.gd:3 _ready()',
      observedOutputSha256: GODOT_4_7_READ_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_READ_IMPLEMENTATION_SHA256,
      callsite: 'readGodotProjectSnapshot(snapshot, authority)',
      observedOutputSha256: GODOT_4_7_READ_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'canonical JSON exact equality',
      tolerance: 'exact',
      resultSha256: GODOT_4_7_READ_COMPARISON_SHA256,
    },
    reproductionCommand,
  };
}

export const GODOT_4_7_READ_CLAIMS: readonly SemanticClaimRecord[] =
  GODOT_4_7_READ_RULES.map(claim);

export const GODOT_4_7_READ_LIVENESS: readonly GodotReadClaimLiveness[] = GODOT_4_7_READ_CLAIMS.map(
  (entry) => ({
    claimId: entry.claimId,
    sourceRevision: SOURCE_REVISION,
    apiDumpSha256: API_DUMP_SHA256,
    executableSha256: NATIVE_EXECUTABLE_SHA256,
    inputSha256: GODOT_4_7_READ_INPUT_SHA256,
    implementationSha256: GODOT_4_7_READ_IMPLEMENTATION_SHA256,
  }),
);
