import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { GODOT_4_7_AUTOLOAD_REFERENCE_RULES } from './authority/godot-4.7-autoload-reference';
import { GODOT_4_7_LANGUAGE_DATATYPES, GODOT_4_7_LANGUAGE_RULES } from './authority/godot-4.7-language-semantics';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_DATATYPES,
  GODOT_4_7_CODE_SEED_RULES,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from './authority/godot-4.7-seed';
import { GODOT_4_7_SCENE_SPAWN_RULES } from './authority/godot-4.7-scene-spawn';
import { GODOT_BINDING_TABLE_VERSION } from './bindings';
import { godotCompatBindings, godotCompatDatatypes } from './compat-bindings';
import LANGUAGE_RULES from './language-rules.json' with { type: 'json' };
import { GODOT_CODE_RULE_TABLE_VERSION, type GodotCodeRuleEntry, type GodotDatatypeRuleEntry } from './lowering-rules';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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
  'packages/gd-analyze/src/translate/emit/direct-scene-syntax.ts',
  'packages/gd-analyze/src/translate/data/scene-families.ts',
  'packages/gd-analyze/src/translate/emit/scene-family-elements.ts',
  'packages/gd-analyze/src/translate/emit/idiomatic-scene-syntax.ts',
  'packages/gd-analyze/src/translate/artifacts/plan.ts',
  'packages/gd-analyze/src/translate/emit/target-ts-printer.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/react-lifecycle.tsx',
] as const;

/** What the scene-spawn proof runs: preload lowering, the spawn host, and the lifecycle and physics it drives. */
export const GODOT_SCENE_SPAWN_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/src/translate/code/lower-official-bound.ts',
  'packages/gd-analyze/src/translate/code/lower-official-expression.ts',
  'packages/gd-analyze/src/translate/code/official-bound-lowering-context.ts',
  'packages/gd-analyze/src/translate/emit/direct-project-world-syntax.ts',
  'packages/gd-analyze/src/translate/emit/idiomatic-scene-syntax.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/packed-scene-instance.tsx',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/main.tsx',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/node.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/react-lifecycle.tsx',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/scene-tree.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/world-3d.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/collision-object-3d.ts',
] as const;

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
            ...(LANGUAGE_RULES.rules as readonly GodotCodeRuleEntry[]),
          ]
        : [],
      datatypes: apiDump === undefined
        ? []
        : [
            ...GODOT_4_7_CODE_SEED_DATATYPES,
            ...GODOT_4_7_LANGUAGE_DATATYPES,
            ...(LANGUAGE_RULES.datatypes as readonly GodotDatatypeRuleEntry[]),
            ...godotCompatDatatypes(source.revision, apiDump),
          ],
    },
    claims: [],
    liveness: [],
  };
}
