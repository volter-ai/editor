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

/**
 * The live identity of an implementation. `loweringDigest` is the digest of the code-lowering
 * files (authority-data's GODOT_CODE_IMPLEMENTATION_FILES), passed in to keep this module below it.
 */
export function godotEvidenceImplementationDigest(
  implementation: GodotEvidenceImplementation,
  loweringDigest: string,
): string {
  if (implementation.kind === 'compat-module') {
    return sha256(readFileSync(compatModuleFile(implementation.module)));
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
