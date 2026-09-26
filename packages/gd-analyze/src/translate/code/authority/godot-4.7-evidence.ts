import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import type { GodotCodeClaimLiveness } from '../authority';
import type { GodotBindingEntry } from '../bindings';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

/** Where a `compat-binding` module specifier (`lib/godot-compat/vector3`) lives in this package. */
export const COMPAT_SOURCE_ROOT = path.join(PACKAGE_ROOT, 'capabilities/catalog/project-source/src');

/** The files `gd-analyze evidence <class>` writes, one per compat module. */
export const GODOT_4_7_EVIDENCE_DIR = path.join(PACKAGE_ROOT, 'src/translate/code/authority/godot-4.7');

export interface GodotEvidenceFile {
  readonly bindings: readonly GodotBindingEntry[];
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly GodotCodeClaimLiveness[];
}

export function compatModuleFile(module: string): string {
  return path.join(COMPAT_SOURCE_ROOT, `${module}.ts`);
}

/**
 * Every instrument-written evidence file, with each liveness row's implementation digest replaced
 * by the digest of its compat module's bytes as they are now: an edited module goes non-live.
 */
export function godot47EvidenceFiles(): readonly GodotEvidenceFile[] {
  return readdirSync(GODOT_4_7_EVIDENCE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = JSON.parse(
        readFileSync(path.join(GODOT_4_7_EVIDENCE_DIR, name), 'utf8'),
      ) as GodotEvidenceFile;
      const moduleByClaim = new Map<string, string>();
      for (const entry of file.bindings) {
        if (entry.target.kind === 'compat-binding') {
          moduleByClaim.set(entry.target.evidenceClaimId, entry.target.module);
        }
      }
      return {
        bindings: file.bindings,
        claims: file.claims,
        liveness: file.liveness.map((row) => {
          const module = moduleByClaim.get(row.claimId);
          if (module === undefined) {
            throw new Error(`${name}: liveness ${row.claimId} has no compat binding`);
          }
          const implementationSha256 = createHash('sha256')
            .update(readFileSync(compatModuleFile(module)))
            .digest('hex');
          return { ...row, implementationSha256 };
        }),
      };
    });
}
