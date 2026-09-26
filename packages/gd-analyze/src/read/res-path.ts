/**
 * read/res-path.ts — `res://` resolution and the ONE statement of what S0 can open.
 *
 * Godot addresses everything through `res://<path-relative-to-project.godot>`. Resolution is
 * mechanical; the interesting decision here is the CLASSIFICATION, which is what keeps the reader
 * honest. Every referenced path falls into exactly one of four kinds:
 *
 *   `text`    — a Godot text-serialization file this reader parses (`.tscn`, `.escn`, `.tres`,
 *               `.gdns`, `.import`)
 *   `script`  — GDScript source (`.gd`), inventoried by S0 and PARSED by S1
 *   `binary`  — Godot's own BINARY serialization of the same resources (`.scn`, `.res`, and the
 *               type-specific `.mesh`/`.material` extensions), parsed by
 *               `binary-format.ts`/`binary-document.ts` into the same documents
 *   `opaque`  — everything else
 *
 * `binary` used to be folded into `opaque`, and the merge was defensible exactly as long as the
 * reader's relationship to the two was identical — it opened neither, so it reported the
 * reference and said nothing about the contents. It no longer is: a Godot 4 project's `.res`/
 * `.scn` half is READ (`platformer-3d-godot4` keeps 18 tile meshes, their collision shapes and a
 * GridMap scene there), so calling it "a format this reader does not open" would be a false
 * statement about the reader in its own diagnostic. `opaque` keeps its original meaning and its
 * original inhabitants — imported ASSETS (`.png`, `.wav`, `.ttf`, `.gdshader`), where a guess
 * about the contents would still be fabricated first-party data (the anti-shim rule).
 *
 * The classification is a property of the FORMAT, not of whether the file happens to be on disk,
 * so it gives the same answer against a full upstream checkout and against a vendored fixture.
 */
import * as path from 'node:path';

export type ResourceKind = 'text' | 'script' | 'binary' | 'model' | 'opaque';

/** `.escn` is Godot's exporter-facing text PackedScene extension. Its bytes are the same
 * `[gd_scene]` grammar as `.tscn`; the different suffix is import provenance, not a different
 * serialization or an opaque model. */
const TEXT_EXTENSIONS = new Set(['.tscn', '.escn', '.tres', '.gdns', '.godot', '.import']);
const SCRIPT_EXTENSIONS = new Set(['.gd']);
/** Godot's binary resource containers. The pair is Godot's own convention — a packed SCENE and a
 *  standalone RESOURCE — and not a format difference: both are the `RSRC`/`RSCC` container, and
 *  `binary-document.ts` picks the document shape from the resource's declared TYPE, never from
 *  the extension. */
const BINARY_EXTENSIONS = new Set(['.scn', '.res', '.mesh', '.material']);
/**
 * An imported 3D model. It is a SCENE in Godot — instancing a `.glb` mounts the node tree the
 * importer built from it — so calling it "a format this reader does not open" stopped being true
 * when `gltf-godot-scene.ts` arrived. It gets its own kind rather than joining `text` because
 * nothing about it is Godot's text serialization: the reader is a glTF reader plus the importer
 * transform, and a project's `.glb` diagnostics should be attributable to it.
 */
const MODEL_EXTENSIONS = new Set(['.glb', '.gltf']);
/**
 * Image files a Godot `Texture2D` / `Texture` ExtResource (or `preload`) may name, and that a
 * browser `<img>` can display as a URL. A `.tres` AtlasTexture / ImageTexture is a document,
 * not one of these — it has no file of its own for the overlay to fetch.
 */
const IMAGE_TEXTURE_EXTENSIONS = new Set([
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.svg',
]);

export function isResPath(value: string): boolean {
  return value.startsWith('res://');
}

/** Resolve a source-authored resource reference in the namespace of its declaring document.
 *
 * Text and binary Godot resources may retain a relative dependency spelling. ResourceLoader
 * resolves that spelling beside the declaring resource, not beside project.godot and not beside
 * whichever outer PackedScene later instances it. Keep UID references for the UID resolver and
 * reject every non-project namespace or path which escapes `res://`; callers must leave those
 * references loud rather than manufacturing a project file identity for them.
 */
export function resolveProjectResourcePath(
  declaringResPath: string,
  reference: string,
): string | undefined {
  if (reference.startsWith('uid://')) return reference;
  if (!isResPath(declaringResPath) || reference === '') return undefined;
  if (reference.startsWith('user://')) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(reference) && !reference.startsWith('res://')) {
    return undefined;
  }

  const absolute = reference.startsWith('res://');
  const relative = absolute ? reference.slice('res://'.length) : reference;
  if (relative.startsWith('/')) return undefined;
  const declaringRelative = declaringResPath.startsWith('res://')
    ? declaringResPath.slice('res://'.length)
    : declaringResPath;
  const base = absolute ? '' : path.posix.dirname(declaringRelative);
  const normalized = path.posix.normalize(path.posix.join(base, relative));
  if (
    normalized === '' ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    return undefined;
  }
  return `res://${normalized}`;
}

/** `res://src/actor/Player.gd` → `<projectDir>/src/actor/Player.gd`. */
export function resToFsPath(projectDir: string, resPath: string): string {
  return path.join(projectDir, resPath.slice('res://'.length));
}

/** `<projectDir>/src/actor/Player.gd` → `res://src/actor/Player.gd`. */
export function fsToResPath(projectDir: string, fsPath: string): string {
  return `res://${path.relative(projectDir, fsPath).split(path.sep).join('/')}`;
}

export function resourceKindOf(resPath: string): ResourceKind {
  const ext = path.extname(resPath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (SCRIPT_EXTENSIONS.has(ext)) return 'script';
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  if (MODEL_EXTENSIONS.has(ext)) return 'model';
  return 'opaque';
}

/** A `res://` path this translation can hand to `setTexture` / an overlay `<img>` as a URL. */
export function isImageTexturePath(resPath: string): boolean {
  return IMAGE_TEXTURE_EXTENSIONS.has(path.extname(resPath).toLowerCase());
}

/**
 * Source bytes the emitted browser project consumes directly.
 *
 * A Godot `.import` sidecar describes how the editor imported these files; neither that metadata
 * nor a checked-in engine cache payload can replace the source URL the browser fetches. This is
 * intentionally narrower than `opaque`: opaque importer-only formats may legitimately resolve to
 * a retained binary PackedScene, while these ecosystem-native assets must exist themselves.
 */
const BROWSER_SOURCE_ASSET_EXTENSIONS = new Set([
  ...IMAGE_TEXTURE_EXTENSIONS,
  '.glb', '.gltf', '.obj', '.mtl',
  '.wav', '.ogg', '.mp3', '.flac',
  '.ttf', '.otf', '.woff', '.woff2',
  '.mp4', '.webm', '.ogv',
]);

export function isBrowserSourceAssetPath(resPath: string): boolean {
  return BROWSER_SOURCE_ASSET_EXTENSIONS.has(path.extname(resPath).toLowerCase());
}

/** The `res://` path an autoload entry points at. A leading `*` marks the autoload as a singleton
 *  (Godot's own spelling); it is not part of the path. */
export function splitAutoloadTarget(raw: string): { singleton: boolean; resPath: string } {
  return raw.startsWith('*')
    ? { singleton: true, resPath: raw.slice(1) }
    : { singleton: false, resPath: raw };
}
