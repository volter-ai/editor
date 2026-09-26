import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { withLiveImplementation } from '../../../godot-frontend/implementation-liveness';
import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import type { GodotCodeClaimLiveness } from '../authority';
import type { GodotBindingEntry } from '../bindings';
import type { GodotCodeRuleEntry, GodotDatatypeRuleEntry } from '../lowering-rules';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

/** Where a `compat-binding` module specifier (`lib/godot-compat/vector3`) lives in this package. */
export const COMPAT_SOURCE_ROOT = path.join(PACKAGE_ROOT, 'capabilities/catalog/project-source/src');

/** The files `gd-analyze evidence <name>` writes: one per compat module, one per language file. */
export const GODOT_4_7_EVIDENCE_DIR = path.join(PACKAGE_ROOT, 'src/translate/code/authority/godot-4.7');

/**
 * What a file's claims ran on the target side: one compat module's bytes, or production code
 * lowering together with the compat modules its lowered cases import.
 */
export type GodotEvidenceImplementation =
  | { readonly kind: 'compat-module'; readonly module: string }
  | { readonly kind: 'code-lowering'; readonly compatModules: readonly string[] };

export interface GodotEvidenceFile {
  readonly implementation: GodotEvidenceImplementation;
  readonly bindings: readonly GodotBindingEntry[];
  readonly rules: readonly GodotCodeRuleEntry[];
  readonly datatypes: readonly GodotDatatypeRuleEntry[];
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly GodotCodeClaimLiveness[];
}

export function compatModuleFile(module: string): string {
  return path.join(COMPAT_SOURCE_ROOT, `${module}.ts`);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Every compat module `module` imports, transitively, by relative specifier, sorted. */
function compatImports(module: string): readonly string[] {
  const found = new Set<string>();
  const visit = (current: string): void => {
    const source = readFileSync(compatModuleFile(current), 'utf8');
    for (const match of source.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
      const next = path.posix.join(path.posix.dirname(current), match[1] as string);
      if (next === module || found.has(next)) continue;
      found.add(next);
      visit(next);
    }
  };
  visit(module);
  return [...found].sort();
}

/**
 * The live identity of an implementation. `loweringDigest` is the digest of the code-lowering
 * files (authority-data's GODOT_CODE_IMPLEMENTATION_FILES), passed in to keep this module below it.
 */
export function godotEvidenceImplementationDigest(
  implementation: GodotEvidenceImplementation,
  loweringDigest: string,
): string {
  if (implementation.kind === 'compat-module') {
    const imported = compatImports(implementation.module);
    const own = readFileSync(compatModuleFile(implementation.module));
    // A module with no compat imports is its own bytes; one that imports others also runs theirs.
    if (imported.length === 0) return sha256(own);
    return sha256(
      JSON.stringify([
        [implementation.module, sha256(own)],
        ...imported.map((module) => [module, sha256(readFileSync(compatModuleFile(module)))]),
      ]),
    );
  }
  return sha256(
    JSON.stringify([
      loweringDigest,
      ...[...implementation.compatModules]
        .sort()
        .map((module) => [module, sha256(readFileSync(compatModuleFile(module)))]),
    ]),
  );
}

/**
 * Every instrument-written evidence file, with each liveness row's implementation digest replaced
 * by the digest of what it ran as that code is now: an edited module or lowering goes non-live.
 */
export function godot47EvidenceFiles(loweringDigest: string): readonly GodotEvidenceFile[] {
  return readdirSync(GODOT_4_7_EVIDENCE_DIR)
    .filter((name) => name.endsWith('.json') && !name.startsWith('proof-'))
    .sort()
    .map((name) => {
      const file = JSON.parse(
        readFileSync(path.join(GODOT_4_7_EVIDENCE_DIR, name), 'utf8'),
      ) as GodotEvidenceFile;
      return {
        ...file,
        liveness: withLiveImplementation(
          file.liveness,
          godotEvidenceImplementationDigest(file.implementation, loweringDigest),
        ),
      };
    });
}
