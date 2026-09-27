import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Where `gd-analyze evidence --refresh` keeps each proof's measured identities. */
export const GODOT_4_7_PROOF_IDENTITY_DIR = path.join(
  PACKAGE_ROOT,
  'src/translate/code/authority/godot-4.7',
);

/**
 * The Godot releases evidence is measured against: 4.7, whose records the authority loads, and
 * 4.6, the same cases and proofs run on the official 4.6 binary against the same compat
 * (`gd-analyze evidence --godot 4.6`), recorded in `authority/godot-4.6/`.
 */
export type GodotEvidenceVersion = '4.6' | '4.7';

/** Where one release's measured evidence and proof identities are kept. */
export function godotEvidenceDir(version: GodotEvidenceVersion): string {
  return path.join(PACKAGE_ROOT, 'src/translate/code/authority', `godot-${version}`);
}

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
  'scene-textures',
  'scene-meshes',
  'scene-audio',
  'scene-gridmap',
  'scene-particles',
  'scene-environment',
  'shader-lowering',
  'post-effects',
  'scene-animation',
  'scene-imported',
  'scene-physics',
  'scene-spawn',
  'scene-idiomatic',
  'lifecycle',
  'project-startup',
  'project-world',
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

export function godotProofIdentityFile(name: GodotProofName, version: GodotEvidenceVersion = '4.7'): string {
  return path.join(godotEvidenceDir(version), `proof-${name}.json`);
}

/** The identities the last agreeing run of this proof recorded. Written only by the refresh. */
export function godotProofIdentities(name: GodotProofName, version: GodotEvidenceVersion = '4.7'): GodotProofIdentities {
  const value = JSON.parse(readFileSync(godotProofIdentityFile(name, version), 'utf8')) as Record<
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
  version: GodotEvidenceVersion = '4.7',
): void {
  const ordered: GodotProofIdentities = {
    input: identities.input,
    implementation: identities.implementation,
    observed: identities.observed,
    comparison: identities.comparison,
  };
  mkdirSync(godotEvidenceDir(version), { recursive: true });
  writeFileSync(godotProofIdentityFile(name, version), `${JSON.stringify(ordered, null, 2)}\n`);
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
