import {
  GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  godotProofIdentities,
} from '../../godot-frontend/proof-identities';
import type { SemanticClaimRecord } from '../../godot-frontend/semantic-claims';
import { type GodotReadClaimLiveness, type GodotReadRule, godotReadRuleKey } from '../authority';

const SOURCE_REVISION = '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88' as const;
const API_DUMP_SHA256 = '53d37f85be32b6d10fb2266ca51f6ef0c3a55728acdb7c8301b1458a93c00943' as const;
const NATIVE_EXECUTABLE_SHA256 =
  '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f' as const;

// These exact pins are refreshed only by `gd-analyze evidence --refresh`. A changed reader is a
// stale authority until the official 4.7 executable produces the same observation again.
const READ_IDENTITIES = godotProofIdentities('read');
export const GODOT_4_7_READ_INPUT_SHA256 = READ_IDENTITIES.input;
export const GODOT_4_7_READ_IMPLEMENTATION_SHA256 = READ_IDENTITIES.implementation;
export const GODOT_4_7_READ_OBSERVED_OUTPUT_SHA256 = READ_IDENTITIES.observed;
export const GODOT_4_7_READ_COMPARISON_SHA256 = READ_IDENTITIES.comparison;

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

const reproductionCommand = GODOT_4_7_PROOF_REPRODUCTION_COMMAND;

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
