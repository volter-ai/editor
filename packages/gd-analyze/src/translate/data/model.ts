/**
 * translate/data/model.ts — the shapes S3 passes between its emitters, and the text helpers all of them
 * need.
 *
 * Nothing here decides anything: the decisions live in `scene.ts` (`.tscn` → a Pixi scene class),
 * `translate/code/` (GDScript → that class's members), `world.ts` (the `@pixi/react` canvas world) and
 * `project.ts` (the whole project). This module exists so those four do not import each other just
 * to agree on a file name. It is a deliberate copy of `rbx-analyze/src/translate/model.ts`'s SHAPE
 * onto different data — the two lanes share a spine, never an artifact.
 *
 * **Determinism is a property of these helpers as much as of the emitters.** Every collection that
 * reaches output is walked in DOCUMENT ORDER (the `.tscn`'s own node order, the script's own
 * declaration order) or sorted explicitly; nothing iterates a `Set` built from a filesystem read,
 * and nothing stamps a date or a version read from another package. Regenerated fixture diffs are
 * the byte-level guard.
 */

/**
 * The module specifier every emitted module imports the capability by — the path
 * `vgai add godot-compat` copies its source to, relative to any of `src/scenes/`, `src/prefabs/`, `src/components/` (one directory under `src/`, whichever the layout chose) and `src/` itself.
 *
 * A CONSTANT rather than a literal spelled at each emission site, and that is not a style choice.
 * The repo's compat-import guard scans every NATIVE package's source text for an import of a compat
 * capability and fails on a hit — correctly, because a native package importing
 * one would break the single rule that keeps compat the licensed exception to the no-wrappers rule
 * ("compat imports native; nothing native imports compat"). This package does not import it; it
 * EMITS code that does. Interpolating the specifier keeps the emitter honest to that scan instead
 * of making the guard grow an allowlist entry, which is the direction that rots.
 */
export const COMPAT_DIR = 'lib/godot-compat';

/**
 * The ENGINE module carrying the editor's hierarchy-presentation convention —
 * `markComponentRoot` / `markBuiltInternal`.
 *
 * Deliberately not a compat module: these two marks are the HOST's, spoken by
 * every kind of project (the starter template's own prefab marks its root the
 * same way), and the editor consumes them without ever learning which importer
 * or library produced the node. A ported scene is a component instance in the
 * editor for the same reason a hand-written one is, not because it is a port.
 */
export const HIERARCHY_MARKS_MODULE = '@volter/threejs-runtime/adapter/hierarchy-marks';

/**
 * The HOST's transform-authority convention (`@engine/adapter/body-marks`),
 * spoken by an emitted scene for exactly the same reason it speaks the
 * hierarchy marks: it is not a Godot idea and not a compat module.
 *
 * A translated scene builds its own Rapier body and writes its node from that
 * body every step. The mark is how it says so, and it is what lets the editor's
 * gizmo move the BODY — without which a transform edit is a value the next step
 * discards.
 */
export const BODY_MARKS_MODULE = '@volter/threejs-runtime/adapter/body-marks';

/** One emitted file: a project-relative POSIX path and its complete text. */
export interface EmittedFile {
  /** Project-relative, POSIX separators, e.g. `src/world.tsx`. */
  readonly path: string;
  readonly text: string;
}

/** One emitted source module whose identity is exactly one analyzed Godot source document. */
export interface SourceOwnedEmittedFile extends EmittedFile {
  /** Canonical `res://` document analyzed to produce this module. */
  readonly sourcePath: string;
}

/** Why one translator-produced file exists. Shared runtime is never a translator artifact. */
export type ArtifactOrigin =
  | {
      readonly kind: 'source-translation';
      /** Godot documents whose authored structure or code this file translates. */
      readonly sourcePaths: readonly string[];
    }
  | {
      readonly kind: 'project-data';
      /** Godot documents from which this project-specific data or composition was derived. */
      readonly sourcePaths: readonly string[];
    };

/** An emitted file after the production partition has assigned its one pre-write origin. */
export interface PartitionedEmittedFile extends EmittedFile {
  readonly origin: ArtifactOrigin;
}

/** Translator-produced browser asset bytes owned by the exact source documents that generated them. */
export interface GeneratedAsset {
  /** Project-relative public path, e.g. `public/godot-array-mesh/Main/mesh.glb`. */
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly origin: ArtifactOrigin;
  readonly converter: {
    readonly id: 'godot-array-mesh-glb';
    readonly version: 1;
    readonly options: {
      readonly meshName: string;
      readonly payloadThresholdBytes: number;
    };
  };
}

/**
 * Something the translator could not carry over exactly, recorded rather than hidden.
 *
 * A note is NOT a failure — a failure THROWS ({@link TranslateError}), because a translator that
 * silently emits plausible-looking wrong code is the one outcome worse than not emitting. A note is
 * a lossy-but-defensible mapping (Godot's `Particles2D` standing in as an empty Pixi `Container`)
 * or a piece of wiring this rung deliberately leaves to the port (which object fires an `Area2D`'s
 * `body_entered`).
 */
export interface TranslationNote {
  /** Where in the SOURCE project: `res://Player.tscn#Trail`, `res://Main.gd:31`. */
  readonly at: string;
  readonly message: string;
}

/** A construct or member the translator refuses to guess at. Thrown, never swallowed. */
export class TranslateError extends Error {
  readonly at: string;
  /** The refusal WITHOUT the `at:` prefix — what a caller that already cites the location quotes
   *  when it downgrades a refusal to a note (a mixed AnimationPlayer's dropped sibling clip). */
  readonly detail: string;
  constructor(at: string, message: string) {
    super(`${at}: ${message}`);
    this.name = 'TranslateError';
    this.at = at;
    this.detail = message;
  }
}

/**
 * One `res://` file the EMITTED code fetches at runtime, and where its copy has to land.
 *
 * The emitted project is source; a running game is source PLUS bytes. Every emitter that writes a
 * runtime URL string records the `res://` path it came from through the one door
 * ({@link assetUrl}), and those recordings union into {@link TranslatedProject.requiredAssets}.
 * That is the difference between a translation that declares what it needs and one whose `public/`
 * completeness is whatever a human remembered to copy: `/enemy/shine.png` was referenced by two
 * particle effects and shipped by nobody, so both 404'd at runtime with nothing in the output
 * saying so.
 */
export interface RequiredAsset {
  /** The Godot project's own path — `res://enemy/shine.png`. */
  readonly res: string;
  /** Project-relative destination in the emitted project — `public/enemy/shine.png`. */
  readonly public: string;
  /** Assets are the source ecosystem's bytes copied verbatim, never synthesized by translation. */
  readonly origin: { readonly kind: 'asset-copy'; readonly sourcePath: string };
}

/** The whole emitted project. Byte-identical for byte-identical fixture input. */
export interface TranslatedProject {
  /** `[application] config/name`, or the directory name when the project declares none. */
  readonly projectName: string;
  /** Files in emission order — deterministic, and the order a golden is written in. */
  readonly files: readonly PartitionedEmittedFile[];
  readonly notes: readonly TranslationNote[];
  /** Every non-source byte the emitted code FETCHES, sorted by `res` — see {@link RequiredAsset}. */
  readonly requiredAssets: readonly RequiredAsset[];
  /** Native binary assets derived from source data too large to embed safely in generated TS. */
  readonly generatedAssets?: readonly GeneratedAsset[];
}

/**
 * The ONE spelling of `res://path` → the browser URL the emitted code fetches it by.
 *
 * Godot addresses a file relative to `project.godot`; a vgai project serves `public/` at the site
 * root, so the mapping is the scheme stripped to a leading `/` and nothing else. It is a function
 * rather than an inline `.replace` at each site because {@link RequiredAsset} is derived from the
 * same paths: an emitter that spells the mapping itself is an emitter whose demand nothing recorded.
 */
export function assetUrl(resPath: string): string {
  if (!resPath.startsWith('res://')) {
    throw new TranslateError(
      resPath,
      'is not a `res://` path, so there is no URL the emitted project could fetch it by. Only a ' +
        "Godot project-relative resource has a place under the emitted project's `public/`.",
    );
  }
  return `/${resPath.slice('res://'.length)}`;
}

/** Recorded `res://` demands → the sorted, de-duplicated asset manifest a project declares. */
export function requiredAssetsOf(resPaths: Iterable<string>): RequiredAsset[] {
  return [...new Set(resPaths)]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((res) => ({
      res,
      public: `public${assetUrl(res)}`,
      origin: { kind: 'asset-copy' as const, sourcePath: res },
    }));
}

function assertGodotSourcePath(sourcePath: string, label: string): void {
  const relative = sourcePath === 'project.godot' ? sourcePath : sourcePath.slice('res://'.length);
  if (
    relative.length === 0 ||
    (sourcePath !== 'project.godot' && !sourcePath.startsWith('res://')) ||
    relative.includes('\\') ||
    relative.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TranslateError(label, `must name project.godot or a normalized res:// source path`);
  }
}

function assertArtifactPath(file: PartitionedEmittedFile, paths: Set<string>): void {
  if (
    file.path.length === 0 ||
    file.path.startsWith('/') ||
    file.path.includes('\\') ||
    file.path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TranslateError(file.path, 'emitted path must be normalized project-relative POSIX');
  }
  if (paths.has(file.path)) throw new TranslateError(file.path, 'emitted more than once');
  paths.add(file.path);
  if (file.path.startsWith('src/lib/godot-compat/')) {
    throw new TranslateError(
      file.path,
      'translator output cannot enter an importer-owned Godot capability',
    );
  }
}

function assertSourceOrigin(file: PartitionedEmittedFile): void {
  if (file.origin.sourcePaths.length === 0) {
    throw new TranslateError(file.path, `${file.origin.kind} must name its source document`);
  }
  const sources = new Set<string>();
  for (const sourcePath of file.origin.sourcePaths) {
    assertGodotSourcePath(sourcePath, `${file.path} origin`);
    if (sources.has(sourcePath))
      throw new TranslateError(file.path, `origin repeats ${sourcePath}`);
    sources.add(sourcePath);
  }
}

/** Production invariant over the complete pre-write translation result. */
export function assertTranslatedProject(project: TranslatedProject): void {
  if (project.files.length === 0) {
    throw new TranslateError(project.projectName, 'translation emitted no files to partition');
  }
  const paths = new Set<string>();
  for (const file of project.files) {
    assertArtifactPath(file, paths);
    const runtimeOrigin = (file as unknown as { origin?: { kind?: unknown } }).origin;
    if (
      typeof runtimeOrigin !== 'object' ||
      runtimeOrigin === null ||
      runtimeOrigin.kind === undefined
    ) {
      throw new TranslateError(file.path, 'emitted file has no declared artifact origin');
    }
    if (runtimeOrigin.kind !== 'source-translation' && runtimeOrigin.kind !== 'project-data') {
      throw new TranslateError(
        file.path,
        `has unknown artifact origin ${String(runtimeOrigin.kind)}`,
      );
    }
    assertSourceOrigin(file);
  }
  for (const asset of project.generatedAssets ?? []) {
    assertArtifactPath({ path: asset.path, text: '', origin: asset.origin }, paths);
    assertSourceOrigin({ path: asset.path, text: '', origin: asset.origin });
    if (!asset.path.startsWith('public/') || asset.bytes.byteLength === 0) {
      throw new TranslateError(
        asset.path,
        'generated asset must be non-empty and live under public/',
      );
    }
  }
  for (const asset of project.requiredAssets) {
    assertGodotSourcePath(asset.res, `${asset.public} asset origin`);
    if (paths.has(asset.public)) {
      throw new TranslateError(asset.public, 'asset destination is emitted more than once');
    }
    paths.add(asset.public);
    if (asset.origin.kind !== 'asset-copy' || asset.origin.sourcePath !== asset.res) {
      throw new TranslateError(asset.public, 'asset copy origin does not match its res:// source');
    }
  }
}

/** Machine-readable account used by the CLI and migration burn-down work. */
export function emissionPartitionAccount(
  project: TranslatedProject,
  capabilityCopies: readonly { readonly path: string }[] = [],
): {
  readonly counts: Readonly<
    Record<ArtifactOrigin['kind'] | 'asset-copy' | 'capability-copy', number>
  >;
  readonly capabilityCopies: readonly string[];
} {
  assertTranslatedProject(project);
  const counts = {
    'source-translation': 0,
    'project-data': 0,
    'asset-copy': project.requiredAssets.length,
    'capability-copy': capabilityCopies.length,
  };
  for (const file of project.files) {
    counts[file.origin.kind] += 1;
  }
  for (const asset of project.generatedAssets ?? []) {
    counts[asset.origin.kind] += 1;
  }
  return {
    counts,
    capabilityCopies: capabilityCopies.map((copy) => copy.path),
  };
}

// ------------------------------------------------------------------------------------------
// Text helpers
// ------------------------------------------------------------------------------------------

/** A string as a single-quoted TS literal. Deliberately not `JSON.stringify` (double quotes) so
 *  the output matches the repo's Biome style and needs no formatter pass to be stable. */
export function quote(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}'`;
}

/**
 * A number as TS source.
 *
 * `-0` prints as `0`, and a non-finite value THROWS rather than emitting `Infinity`/`NaN` into a
 * scene: both are authorable in principle and neither has ever appeared, so emitting one would be
 * a guess about intent.
 */
export function num(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TranslateError('<number>', `cannot emit the non-finite value ${String(value)}`);
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  // `Number.prototype.toString` is already the shortest round-tripping decimal form, and it is
  // locale-independent — the two properties a golden needs.
  return String(normalized);
}

/**
 * A number as a GLSL **float** literal — the formatter every number interpolated into an emitted
 * shader must go through.
 *
 * GLSL ES has no implicit int→float conversion, and `num()` prints the shortest round-tripping
 * decimal form: a weight of exactly 6 comes out as `6`, which is an INT the moment it lands in a
 * shader, so `glow += texture2D(tLevel4, vUv).rgb * 6;` fails to COMPILE (a real WebGL error, not
 * a wrong pixel). `num()` itself is deliberately untouched — it formats every number in every
 * emitted port, where `position={[0, 0, 0]}` must not become `[0.0, 0.0, 0.0]` — so the split is
 * by DESTINATION: TS source takes `num`, shader source takes this.
 *
 * The value is identical; only the spelling changes. A form that is already unambiguously float
 * (it carries a decimal point or an exponent, both of which GLSL accepts) is passed through.
 */
export function glslFloat(value: number): string {
  const text = num(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/** Indent every non-empty line of `text` by `depth` two-space levels. */
export function indent(text: string, depth: number): string {
  const pad = '  '.repeat(depth);
  return text
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join('\n');
}

/** A deterministic import line: named bindings sorted, one module per line. */
export function importLine(names: readonly string[], from: string, typeOnly = false): string {
  const sorted = [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `import ${typeOnly ? 'type ' : ''}{ ${sorted.join(', ')} } from ${quote(from)};`;
}
