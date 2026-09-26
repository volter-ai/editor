import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Where `gd-analyze evidence --refresh` keeps each proof's measured identities. */
export const GODOT_4_7_PROOF_IDENTITY_DIR = path.join(
  PACKAGE_ROOT,
  'src/translate/code/authority/godot-4.7',
);

/** Each native/target proof whose identities an authority's claims carry. */
export const GODOT_4_7_PROOF_NAMES = [
  'read',
  'analysis',
  'receivers',
  'project-settings',
  'field-values',
  'scene-nodes',
  'scene-structure',
  'scene-render',
  'scene-ui',
  'scene-imported',
  'scene-physics',
  'lifecycle',
  'project-startup',
  'code-seed',
  'language',
  'autoload-reference',
] as const;

export type GodotProofName = (typeof GODOT_4_7_PROOF_NAMES)[number];

/** What one proof run measured: its probe input, the implementation it ran, and the verdict. */
export interface GodotProofIdentities {
  readonly input: string;
  readonly implementation: string;
  readonly observed: string;
  readonly comparison: string;
}

export function godotProofIdentityFile(name: GodotProofName): string {
  return path.join(GODOT_4_7_PROOF_IDENTITY_DIR, `proof-${name}.json`);
}

/** The identities the last agreeing run of this proof recorded. Written only by the refresh. */
export function godotProofIdentities(name: GodotProofName): GodotProofIdentities {
  const value = JSON.parse(readFileSync(godotProofIdentityFile(name), 'utf8')) as Record<
    string,
    unknown
  >;
  const keys = ['input', 'implementation', 'observed', 'comparison'] as const;
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`proof-${name}.json must hold exactly ${keys.join(', ')}`);
  }
  for (const key of keys) {
    const digest = value[key];
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`proof-${name}.json ${key} is not a sha256`);
    }
  }
  return value as unknown as GodotProofIdentities;
}

export function writeGodotProofIdentities(
  name: GodotProofName,
  identities: GodotProofIdentities,
): void {
  const ordered: GodotProofIdentities = {
    input: identities.input,
    implementation: identities.implementation,
    observed: identities.observed,
    comparison: identities.comparison,
  };
  writeFileSync(godotProofIdentityFile(name), `${JSON.stringify(ordered, null, 2)}\n`);
}

/** The one command that re-measures every proof and rewrites the identities of those that agree. */
export const GODOT_4_7_PROOF_REPRODUCTION_COMMAND = [
  'npx',
  'tsx',
  'packages/gd-analyze/src/cli.ts',
  'evidence',
  '--refresh',
  '--official-binary',
  '/Volumes/PeakSSD/volter-work/tools/godot-4.7-stable-official/Godot.app/Contents/MacOS/Godot',
  '--bound-exporter-binary',
  '/Volumes/PeakSSD/volter-work/tools/godot-4.7-bound-exporter-seal/godot-4.7-bound-exporter-arm64',
] as const;
