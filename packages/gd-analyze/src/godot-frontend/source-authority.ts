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
  /**
   * The one bound-program exporter build this pin accepts: the official source at `revision`
   * with this repository's exporter module and patch compiled in, every engine module enabled
   * (a game's scripts name module classes such as GridMap and CSG). Its build writes
   * `identity.json` beside the executable; these are that file's digests. Absent means no
   * exporter is pinned, and import refuses.
   */
  readonly boundExporter?: {
    readonly executableSha256: string;
    readonly exporterSourceSha256: string;
    readonly sourceTreeSha256: string;
    readonly buildOptions: string;
  };
  /**
   * The official release editor of this revision: the native oracle evidence records cite, and
   * the importer. Before the exporter runs, it performs Godot's own `--headless --import` on the
   * snapshot copy, so a `preload` of a scene holding imported assets resolves as it does in
   * Godot's editor. It is optimized, where a dev-build exporter imports too slowly to use.
   */
  readonly officialEditor?: {
    readonly executableSha256: string;
    readonly reportedVersion: string;
  };
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
    officialEditor: {
      executableSha256: '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f',
      reportedVersion: '4.7.stable.official.5b4e0cb0f',
    },
    boundExporter: {
      executableSha256: 'b73109b21332762219075f657bd457a57dbc9ea9068080ea77db66d3d6f56f83',
      exporterSourceSha256: 'd8052e0e7efed6480f0da1941b4578ab1dd40dbf9d1b842fa3479b7bd56e888b',
      sourceTreeSha256: 'b25d23ca60d7a9e99c2cccda9a5a1b2e736e6d0f79a8411d6647dafd4693cbec',
      buildOptions:
        'platform=macos target=template_debug arch=arm64 dev_build=yes debug_symbols=no lto=none vulkan=no opengl3=no metal=no angle=no accesskit=no sdl=no disable_path_overrides=no modules_enabled_by_default=yes module_gdscript_enabled=yes module_gdscript_frontend_exporter_enabled=yes',
    },
  },
};

/**
 * Every pinned Godot 4 release, keyed by the source-version feature a project declares
 * (`config/features`). `GODOT_SOURCE_AUTHORITIES[4]` is the 4.7 row of this table.
 * 4.6 has no `boundExporter` pin until its exporter is built, so a 4.6 import refuses by name.
 */
export const GODOT_4_SOURCE_AUTHORITIES: Readonly<Record<'4.6' | '4.7', GodotSourceAuthority>> = {
  '4.6': {
    major: 4,
    version: '4.6-stable',
    repository: REPOSITORY,
    revision: '89cea143987d564363e15d207438530651d943ac',
    apiDumpFile: 'godot-4.6-extension_api.json',
    apiDumpSha256: '7ec77145b30d238e7212e5e888d601b98a413377c156c19bd28e82fe452f8df2',
    officialEditor: {
      executableSha256: '974197a7e6663dba803ae97c3b2d987b77a37b6e70088400ecf0ccc591cbdfbc',
      reportedVersion: '4.6.stable.official.89cea1439',
    },
    frontendFiles: GODOT_SOURCE_AUTHORITIES[4].frontendFiles,
    runtimeRoots: GODOT_SOURCE_AUTHORITIES[4].runtimeRoots,
  },
  '4.7': GODOT_SOURCE_AUTHORITIES[4],
};

export function godotSourceAuthority(major: number): GodotSourceAuthority {
  if (major !== 3 && major !== 4) {
    throw new Error(
      `Godot source authority supports engine major 3 or 4, received ${String(major)}.`,
    );
  }
  return GODOT_SOURCE_AUTHORITIES[major];
}
