import type { GodotSourceAuthority } from '../../godot-frontend/source-authority';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../code/authority/godot-4.7-seed';
import {
  GODOT_4_7_FIELD_VALUE_RULES,
  GODOT_4_7_NODE_REFERENCE_RULES,
} from './authority/godot-4.7-field-values';
import {
  GODOT_FIELD_VALUE_AUTHORITY_VERSION,
  type GodotFieldValueAuthority,
} from './field-value-authority';

/** The field-value conversion rules for the selected official frontend. */
export function godotFieldValueAuthority(source: GodotSourceAuthority): GodotFieldValueAuthority {
  const supported =
    source.revision === GODOT_4_7_CODE_SEED_SOURCE_REVISION &&
    source.apiDumpSha256 === GODOT_4_7_CODE_SEED_API_DUMP_SHA256;
  return {
    version: GODOT_FIELD_VALUE_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    rules: supported ? [...GODOT_4_7_FIELD_VALUE_RULES, ...GODOT_4_7_NODE_REFERENCE_RULES] : [],
  };
}
