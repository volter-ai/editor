import {
  packageImplementationDigest,
  withLiveImplementation,
} from '../godot-frontend/implementation-liveness';
import type { GodotSourceAuthority } from '../godot-frontend/source-authority';
import { GODOT_ANALYSIS_AUTHORITY_VERSION, type GodotAnalysisAuthority } from './authority';
import {
  GODOT_4_7_ANALYSIS_CLAIMS,
  GODOT_4_7_ANALYSIS_LIVENESS,
  GODOT_4_7_ANALYSIS_RULES,
} from './authority/godot-4.7-analysis';

export const GODOT_ANALYSIS_IMPLEMENTATION_FILES = [
  'src/analyze/api-dump.ts',
  'src/analyze/bound-project.ts',
  'src/read/scene-attachment-index.ts',
] as const;

/** Checked-in exact-proof authority for source/frontend relationship analysis. */
export function godotAnalysisAuthority(source: GodotSourceAuthority): GodotAnalysisAuthority {
  const supported =
    source.revision === '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88' &&
    source.apiDumpSha256 === '53d37f85be32b6d10fb2266ca51f6ef0c3a55728acdb7c8301b1458a93c00943';
  return {
    version: GODOT_ANALYSIS_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    rules: supported ? GODOT_4_7_ANALYSIS_RULES : [],
    claims: supported ? GODOT_4_7_ANALYSIS_CLAIMS : [],
    liveness: supported
      ? withLiveImplementation(
          GODOT_4_7_ANALYSIS_LIVENESS,
          packageImplementationDigest(GODOT_ANALYSIS_IMPLEMENTATION_FILES),
        )
      : [],
  };
}
