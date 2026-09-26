import {
  packageImplementationDigest,
  withLiveImplementation,
} from '../../godot-frontend/implementation-liveness';
import type { GodotSourceAuthority } from '../../godot-frontend/source-authority';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../code/authority/godot-4.7-seed';
import {
  GODOT_4_7_FIELD_VALUE_CLAIMS,
  GODOT_4_7_FIELD_VALUE_LIVENESS,
  GODOT_4_7_FIELD_VALUE_RULES,
} from './authority/godot-4.7-field-values';
import {
  GODOT_FIELD_VALUE_AUTHORITY_VERSION,
  type GodotFieldValueAuthority,
} from './field-value-authority';

export const GODOT_FIELD_VALUE_IMPLEMENTATION_FILES = [
  'src/analyze/bound-project.ts',
  'src/translate/data/field-value-authority.ts',
  'src/translate/data/script-field-initialization-plan.ts',
] as const;

/** Checked-in, exact-pin field-value conversion authority for the selected official frontend. */
export function godotFieldValueAuthority(source: GodotSourceAuthority): GodotFieldValueAuthority {
  const supported =
    source.revision === GODOT_4_7_CODE_SEED_SOURCE_REVISION &&
    source.apiDumpSha256 === GODOT_4_7_CODE_SEED_API_DUMP_SHA256;
  return {
    version: GODOT_FIELD_VALUE_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    rules: supported ? GODOT_4_7_FIELD_VALUE_RULES : [],
    claims: supported ? GODOT_4_7_FIELD_VALUE_CLAIMS : [],
    liveness: supported
      ? withLiveImplementation(
          GODOT_4_7_FIELD_VALUE_LIVENESS,
          packageImplementationDigest(GODOT_FIELD_VALUE_IMPLEMENTATION_FILES),
        )
      : [],
  };
}
