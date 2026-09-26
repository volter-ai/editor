/**
 * read/mesh-surfaces.ts — one door onto an `ArrayMesh`'s surfaces, whichever serialization the
 * document wrote.
 *
 * Godot 3 writes numbered `surfaces/N` properties (an interleaved `array_data` buffer);
 * Godot 4 writes a single `_surfaces` array whose vertex buffer is laid out differently in every
 * respect (`read/godot4-surfaces.ts`). The discriminator is the document's own key rather than
 * the project's engine version, because a `.tres`/`.res` carries the serialization it was written
 * with.
 *
 * This used to live in the 3D emitter (`surfacesOf`). Decode is `read/`'s job; the emitter
 * consumed the same `ArrayMeshSurface` either way and does not need to know a second format
 * exists.
 */

import {
  type ArrayMeshSurface,
  type DecodeArrayMeshOptions,
  readArrayMeshSurfaces,
} from './array-mesh';
import type { GodotValue } from './godot-value';
import { readGodot4Surfaces } from './godot4-surfaces';

/**
 * Every surface an `ArrayMesh` document declares, decoded, in surface order.
 *
 * `properties` is a `sub_resource type="ArrayMesh"`'s properties, or a `.tres`/`.res` whose
 * `[resource]` IS the mesh. Empty when the document declares neither `surfaces/N` nor
 * `_surfaces` — the caller decides whether that is a refusal.
 */
export function readMeshSurfaces(
  properties: Readonly<Record<string, GodotValue>>,
  at: string,
  options: DecodeArrayMeshOptions = {},
): readonly ArrayMeshSurface[] {
  return properties['_surfaces'] === undefined
    ? readArrayMeshSurfaces(properties, at, options)
    : readGodot4Surfaces(properties, at);
}
