import {
  monorepoImplementationDigest,
  packageImplementationDigest,
  withLiveImplementation,
} from '../../godot-frontend/implementation-liveness';
import type { GodotSourceAuthority } from '../../godot-frontend/source-authority';
import {
  GODOT_CODE_TRANSLATION_AUTHORITY_VERSION,
  type GodotCodeTranslationAuthority,
} from './authority';
import {
  GODOT_4_7_AUTOLOAD_REFERENCE_CLAIMS,
  GODOT_4_7_AUTOLOAD_REFERENCE_LIVENESS,
  GODOT_4_7_AUTOLOAD_REFERENCE_RULES,
} from './authority/godot-4.7-autoload-reference';
import {
  GODOT_4_7_LANGUAGE_CLAIMS,
  GODOT_4_7_LANGUAGE_DATATYPES,
  GODOT_4_7_LANGUAGE_LIVENESS,
  GODOT_4_7_LANGUAGE_RULES,
} from './authority/godot-4.7-language-semantics';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_CLAIMS,
  GODOT_4_7_CODE_SEED_DATATYPES,
  GODOT_4_7_CODE_SEED_LIVENESS,
  GODOT_4_7_CODE_SEED_RULES,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from './authority/godot-4.7-seed';
import { GODOT_BINDING_TABLE_VERSION } from './bindings';
import { GODOT_CODE_RULE_TABLE_VERSION } from './lowering-rules';

export const GODOT_CODE_IMPLEMENTATION_FILES = [
  'src/translate/code/bindings.ts',
  'src/translate/code/lower-official-bound.ts',
  'src/translate/code/lower-official-statement.ts',
  'src/translate/code/lower-official-expression.ts',
  'src/translate/code/official-bound-lowering-context.ts',
  'src/translate/code/lowering-rules.ts',
  'src/translate/code/target-ts-syntax.ts',
  'src/translate/emit/target-ts-printer.ts',
] as const;

export const GODOT_AUTOLOAD_REFERENCE_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/analyze/bound-autoload-references.ts',
  'packages/gd-analyze/src/analyze/bound-project.ts',
  'packages/gd-analyze/src/translate/code/bindings.ts',
  'packages/gd-analyze/src/translate/code/lower-official-bound.ts',
  'packages/gd-analyze/src/translate/code/lower-official-expression.ts',
  'packages/gd-analyze/src/translate/code/lower-official-statement.ts',
  'packages/gd-analyze/src/translate/code/official-bound-lowering-context.ts',
  'packages/gd-analyze/src/translate/code/lowering-rules.ts',
  'packages/gd-analyze/src/translate/code/target-ts-syntax.ts',
  'packages/gd-analyze/src/translate/data/direct-project-composition-plan.ts',
  'packages/gd-analyze/src/translate/data/direct-scene-module-plan.ts',
  'packages/gd-analyze/src/translate/emit/direct-project-world-syntax.ts',
  'packages/gd-analyze/src/translate/emit/direct-autoload-syntax.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-lifecycle-syntax.ts',
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  'packages/gd-analyze/src/translate/emit/target-ts-printer.ts',
  'packages/editor/catalog/project-source/src/lib/godot-compat/react-lifecycle.tsx',
] as const;

/**
 * The checked-in translation authority selected with the official frontend.
 *
 * Rows land here only after their exact-pin native/target differential claim exists. An absent row
 * is deliberately a lowering refusal; it is never inferred from the handwritten translator.
 */
export function godotCodeTranslationAuthority(
  source: GodotSourceAuthority,
): GodotCodeTranslationAuthority {
  const seeded =
    source.revision === GODOT_4_7_CODE_SEED_SOURCE_REVISION &&
    source.apiDumpSha256 === GODOT_4_7_CODE_SEED_API_DUMP_SHA256;
  return {
    version: GODOT_CODE_TRANSLATION_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    bindings: {
      version: GODOT_BINDING_TABLE_VERSION,
      sourceRevision: source.revision,
      entries: [],
    },
    rules: {
      version: GODOT_CODE_RULE_TABLE_VERSION,
      sourceRevision: source.revision,
      entries: seeded
        ? [
            ...GODOT_4_7_CODE_SEED_RULES,
            ...GODOT_4_7_LANGUAGE_RULES,
            ...GODOT_4_7_AUTOLOAD_REFERENCE_RULES,
          ]
        : [],
      datatypes: seeded ? [...GODOT_4_7_CODE_SEED_DATATYPES, ...GODOT_4_7_LANGUAGE_DATATYPES] : [],
    },
    claims: seeded
      ? [
          ...GODOT_4_7_CODE_SEED_CLAIMS,
          ...GODOT_4_7_LANGUAGE_CLAIMS,
          ...GODOT_4_7_AUTOLOAD_REFERENCE_CLAIMS,
        ]
      : [],
    liveness: seeded
      ? [
          ...withLiveImplementation(
            [...GODOT_4_7_CODE_SEED_LIVENESS, ...GODOT_4_7_LANGUAGE_LIVENESS],
            packageImplementationDigest(GODOT_CODE_IMPLEMENTATION_FILES),
          ),
          ...withLiveImplementation(
            GODOT_4_7_AUTOLOAD_REFERENCE_LIVENESS,
            monorepoImplementationDigest(GODOT_AUTOLOAD_REFERENCE_IMPLEMENTATION_FILES),
          ),
        ]
      : [],
  };
}
