/**
 * read/uid-index.ts — `uid://…` is Godot 4's OTHER spelling of a resource reference, and this is
 * the table that turns one back into the `res://` path the rest of the lane speaks.
 *
 * Godot 4 gives every saved resource a stable id and writes it into the file's own header
 * (`[gd_scene … uid="uid://b8cjd5xlk3m1p"]`, and the binary container's UID word — see
 * `binary-format.ts`'s `uidToText`). Most references then carry BOTH spellings: an
 * `[ext_resource]` line writes `uid=` *and* `path=`, so a reader that only knows paths never
 * notices. **`project.godot` is where that stops.** `[application] run/main_scene` is a single
 * scalar, and Godot 4.4+ writes it as the uid alone:
 *
 *     run/main_scene="uid://b8cjd5xlk3m1p"     # starter-kit-match-3/project.godot:19
 *
 * There is no path beside it. Without this table that string is compared against `res://` keys,
 * matches nothing, and the project reads as *having no entry point* — which is how a project whose
 * every member is covered still refuses at translate with "`run/main_scene` names no scene this
 * project translated". Resolution is a LOOKUP over documents this reader already opened, never a
 * derivation: a uid is opaque (`ResourceUID::id_to_text` base-34 of a random 64-bit id) and
 * nothing about it can be computed from a file name. Runtime closure reuses the same source-backed
 * table for resource loads, project roots, and `MultiplayerSpawner._spawnable_scenes`; all may
 * carry a bare UID with no path beside it.
 */
import type { Diagnostic, ResourceDocument, SceneDocument } from './godot-types';
import type { ImportSidecar } from './import-sidecar';

const UID_PREFIX = 'uid://';

/** Is this reference written as a uid rather than a `res://` path? */
export function isUidRef(value: string): boolean {
  return value.startsWith(UID_PREFIX);
}

/** `uid://…` → the exact source-backed `res://` path whose document/import fact declares it. */
export type UidIndex = ReadonlyMap<string, string>;

/**
 * Build the table from every source-backed UID fact the project walk opened: scene/resource
 * headers, external-resource rows that carry both UID and path, checked-in import sidecars that
 * carry both UID and source_file, and Godot 4's checked-in `<resource>.uid` companions. No cache
 * path or filename is derived: the project resource resolver supplies those sidecar pairs after
 * reading their authored contents.
 *
 * A DUPLICATE uid is a broken project (Godot mints one per file; two files sharing one means a
 * `.tscn` was copied outside the editor). It is reported and removed from the resolvable map:
 * choosing either source would make runtime closure depend on directory order. A use of that UID
 * therefore remains unresolved and loud.
 */
export function buildUidIndex(
  scenes: readonly SceneDocument[],
  diagnostics: Diagnostic[],
  resources: readonly ResourceDocument[] = [],
  imports: readonly ImportSidecar[] = [],
  sourceBackedPaths: readonly Readonly<{ uid: string; path: string }>[] = [],
): UidIndex {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  const add = (uid: string | undefined, resPath: string | undefined, at: string): void => {
    if (uid === undefined || resPath === undefined || !resPath.startsWith('res://')) return;
    if (ambiguous.has(uid)) return;
    const existing = index.get(uid);
    if (existing !== undefined && existing !== resPath) {
      diagnostics.push({
        severity: 'warning',
        code: 'uid-duplicate',
        message: `${uid} is declared by both ${existing} and ${resPath}; a uid names one file, so references to it remain unresolved`,
        at,
      });
      index.delete(uid);
      ambiguous.add(uid);
      return;
    }
    index.set(uid, resPath);
  };
  for (const scene of scenes) {
    add(scene.uid, scene.resPath, scene.resPath);
    for (const external of scene.extResources) {
      add(external.uid, external.resPath, scene.resPath);
    }
  }
  for (const resource of resources) {
    add(resource.uid, resource.resPath, resource.resPath);
    for (const external of resource.extResources) {
      add(external.uid, external.resPath, resource.resPath);
    }
  }
  for (const imported of imports) {
    add(imported.uid, imported.sourceFile, imported.resPath);
  }
  for (const entry of sourceBackedPaths) {
    add(entry.uid, entry.path, entry.path);
  }
  return index;
}

/**
 * A reference as written → the `res://` path, or `undefined` when it is a uid this project
 * declares nowhere. A `res://` reference passes through untouched, so callers hand over whatever
 * the file said without first asking which spelling it used.
 */
export function resolveResourceRef(ref: string, index: UidIndex): string | undefined {
  return isUidRef(ref) ? index.get(ref) : ref;
}
