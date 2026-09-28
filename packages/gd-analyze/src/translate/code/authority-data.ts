import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GodotSourceAuthority } from '../../godot-frontend/source-authority';
import {
  GODOT_CODE_TRANSLATION_AUTHORITY_VERSION,
  type GodotCodeTranslationAuthority,
} from './authority';
import { GODOT_4_7_AUTOLOAD_REFERENCE_RULES } from './authority/godot-4.7-autoload-reference';
import { GODOT_4_7_LANGUAGE_DATATYPES, GODOT_4_7_LANGUAGE_RULES } from './authority/godot-4.7-language-semantics';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_DATATYPES,
  GODOT_4_7_CODE_SEED_RULES,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from './authority/godot-4.7-seed';
import { GODOT_4_7_SCENE_SPAWN_RULES } from './authority/godot-4.7-scene-spawn';
import { GODOT_4_7_VARIANT_CONTAINER_DATATYPES, GODOT_4_7_VARIANT_CONTAINER_RULES } from './authority/godot-4.7-variant-containers';
import { GODOT_BINDING_TABLE_VERSION } from './bindings';
import { godotCompatBindings, godotCompatDatatypes } from './compat-bindings';
import LANGUAGE_RULES from './language-rules.json' with { type: 'json' };
import { GODOT_CODE_RULE_TABLE_VERSION, type GodotCodeRuleEntry, type GodotDatatypeRuleEntry } from './lowering-rules';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The code translation authority for the pinned frontend: the bindings compat's own exports give
 * (`compat-bindings.ts`), the GDScript language rules (`language-rules.json` and the seed rules),
 * and the datatype rules. There is no evidence gate (docs/GODOT.md §The lane's law, ruling 2): an
 * absent row is a lowering refusal because compat or the rules do not cover the construct.
 */
export function godotCodeTranslationAuthority(
  source: GodotSourceAuthority,
): GodotCodeTranslationAuthority {
  const seeded =
    source.revision === GODOT_4_7_CODE_SEED_SOURCE_REVISION &&
    source.apiDumpSha256 === GODOT_4_7_CODE_SEED_API_DUMP_SHA256;
  const apiDump = seeded
    ? (JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'vendor/extension-api', source.apiDumpFile), 'utf8')) as Parameters<typeof godotCompatBindings>[1])
    : undefined;
  return {
    version: GODOT_CODE_TRANSLATION_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    bindings: {
      version: GODOT_BINDING_TABLE_VERSION,
      sourceRevision: source.revision,
      entries: apiDump === undefined ? [] : godotCompatBindings(source.revision, apiDump).entries,
    },
    rules: {
      version: GODOT_CODE_RULE_TABLE_VERSION,
      sourceRevision: source.revision,
      entries: seeded
        ? [
            ...GODOT_4_7_CODE_SEED_RULES,
            ...GODOT_4_7_LANGUAGE_RULES,
            ...GODOT_4_7_AUTOLOAD_REFERENCE_RULES,
            ...GODOT_4_7_SCENE_SPAWN_RULES,
            ...GODOT_4_7_VARIANT_CONTAINER_RULES,
            ...(LANGUAGE_RULES.rules as readonly GodotCodeRuleEntry[]),
          ]
        : [],
      datatypes: apiDump === undefined
        ? []
        : [
            ...GODOT_4_7_CODE_SEED_DATATYPES,
            ...GODOT_4_7_LANGUAGE_DATATYPES,
            ...GODOT_4_7_VARIANT_CONTAINER_DATATYPES,
            ...(LANGUAGE_RULES.datatypes as readonly GodotDatatypeRuleEntry[]),
            ...godotCompatDatatypes(source.revision, apiDump),
          ],
    },
  };
}
