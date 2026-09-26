/**
 * The exact Godot implementations that define this lane's meaning.
 *
 * Fixtures decide priority and prove integration. They do not define semantics. A parser rule,
 * API binding, lifecycle rule, renderer mapping or physics behavior is implemented against one
 * of these immutable engine revisions and then checked against the matching native editor.
 */
export type SupportedGodotMajor = 3 | 4;

export interface GodotSourceAuthority {
  readonly major: SupportedGodotMajor;
  readonly version: string;
  readonly repository: 'https://github.com/godotengine/godot';
  readonly revision: string;
  readonly apiDumpFile: string;
  readonly apiDumpSha256: string;
  /** The official frontend units a bound-program exporter is compiled from. */
  readonly frontendFiles: readonly string[];
  /** Engine source estates consulted when implementing observable runtime protocol. */
  readonly runtimeRoots: readonly string[];
}

const REPOSITORY = 'https://github.com/godotengine/godot' as const;

export const GODOT_SOURCE_AUTHORITIES: Readonly<
  Record<SupportedGodotMajor, GodotSourceAuthority>
> = {
  3: {
    major: 3,
    version: '3.6.2-stable',
    repository: REPOSITORY,
    revision: '3cd3caab6779a7f3ec3bbeb9f200db50c735cfc8',
    apiDumpFile: 'godot-3.6.2-api.json',
    apiDumpSha256: '8219cab2bf15c89b0a8ada568dae0b587b1032d4853e240b0d0389cfba3b6c02',
    frontendFiles: [
      'modules/gdscript/gdscript_tokenizer.h',
      'modules/gdscript/gdscript_tokenizer.cpp',
      'modules/gdscript/gdscript_parser.h',
      'modules/gdscript/gdscript_parser.cpp',
      'modules/gdscript/gdscript_compiler.h',
      'modules/gdscript/gdscript_compiler.cpp',
    ],
    runtimeRoots: ['core/', 'scene/', 'servers/', 'modules/gdscript/'],
  },
  4: {
    major: 4,
    version: '4.7-stable',
    repository: REPOSITORY,
    revision: '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88',
    apiDumpFile: 'godot-4.7-extension_api.json',
    apiDumpSha256: '53d37f85be32b6d10fb2266ca51f6ef0c3a55728acdb7c8301b1458a93c00943',
    frontendFiles: [
      'modules/gdscript/gdscript_tokenizer.h',
      'modules/gdscript/gdscript_tokenizer.cpp',
      'modules/gdscript/gdscript_parser.h',
      'modules/gdscript/gdscript_parser.cpp',
      'modules/gdscript/gdscript_analyzer.h',
      'modules/gdscript/gdscript_analyzer.cpp',
      'modules/gdscript/gdscript_compiler.h',
      'modules/gdscript/gdscript_compiler.cpp',
    ],
    runtimeRoots: ['core/', 'scene/', 'servers/', 'modules/gdscript/'],
  },
};

export function godotSourceAuthority(major: number): GodotSourceAuthority {
  if (major !== 3 && major !== 4) {
    throw new Error(
      `Godot source authority supports engine major 3 or 4, received ${String(major)}.`,
    );
  }
  return GODOT_SOURCE_AUTHORITIES[major];
}
