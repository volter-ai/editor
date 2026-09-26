import {
  packageImplementationDigest,
  withLiveImplementation,
} from '../godot-frontend/implementation-liveness';
import type { GodotSourceAuthority } from '../godot-frontend/source-authority';
import { GODOT_READ_AUTHORITY_VERSION, type GodotReadAuthority } from './authority';
import {
  GODOT_4_7_READ_CLAIMS,
  GODOT_4_7_READ_LIVENESS,
  GODOT_4_7_READ_RULES,
} from './authority/godot-4.7-read';

export const GODOT_READ_IMPLEMENTATION_FILES = [
  'src/read/godot-value.ts',
  'src/read/text-format.ts',
  'src/read/known-settings.ts',
  'src/read/project-settings.ts',
  'src/read/scene.ts',
  'src/read/import-sidecar.ts',
  'src/read/godot-project.ts',
  'src/read/resource-program.ts',
] as const;

/** Checked-in, exact-proof read authority for the selected immutable Godot source revision. */
export function godotReadAuthority(source: GodotSourceAuthority): GodotReadAuthority {
  const supported =
    source.revision === '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88' &&
    source.apiDumpSha256 === '53d37f85be32b6d10fb2266ca51f6ef0c3a55728acdb7c8301b1458a93c00943';
  return {
    version: GODOT_READ_AUTHORITY_VERSION,
    sourceRevision: source.revision,
    apiDumpSha256: source.apiDumpSha256,
    rules: supported ? GODOT_4_7_READ_RULES : [],
    claims: supported ? GODOT_4_7_READ_CLAIMS : [],
    liveness: supported
      ? withLiveImplementation(
          GODOT_4_7_READ_LIVENESS,
          packageImplementationDigest(GODOT_READ_IMPLEMENTATION_FILES),
        )
      : [],
  };
}
