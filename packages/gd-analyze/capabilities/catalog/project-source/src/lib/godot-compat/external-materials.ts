/**
 * Godot's importer EXTRACTED a model's materials to standalone `.tres` files beside the source
 * and the game renders those, not the ones the file embeds. {@link withExternalMaterials} puts
 * them back on, matched by material NAME — the rule measured on Godot 3.6, and the only one
 * available to an emitter that never opens the binary.
 *
 * The class is part of the row rather than assumed, because Godot's `flags_unshaded` is not a
 * parameter in three: an unshaded surface is a `MeshBasicMaterial`, which has no roughness,
 * metalness or emissive at all. That is also why this walk REPLACES rather than patches — a
 * loader-built `MeshStandardMaterial` cannot be assigned into a basic one.
 *
 * It runs per INSTANCE: the port mints a fresh clone per call, and `Object3D.clone()` shares
 * materials by reference, so a fresh material per clone is also what keeps one instance's
 * material from being the whole cache's.
 *
 * **Owns:** nothing with a lifetime — the walk is pure over the clone it is handed.
 * **Shares:** the clone the caller already owns. **Teardown:** none.
 */

import { type Material, type Mesh, type Object3D } from 'three';
import { createSpatialMaterial, type GodotExternalMaterial } from './spatial-material';

export type { GodotExternalMaterial };

/**
 * Godot's importer EXTRACTED this model's materials to standalone `.tres` files beside the source
 * and the game renders those, not the ones the file embeds. This walk puts them back on, matched
 * by material NAME — the rule measured on Godot 3.6, and the only one available to an emitter that
 * never opens the binary. A material the model does not use simply never matches.
 */
export function withExternalMaterials(
  model: Object3D,
  extracted: Readonly<Record<string, GodotExternalMaterial>>,
): Object3D {
  model.traverse((child) => {
    const held = (child as Partial<Mesh>).material;
    if (held === undefined) return;
    const slots = Array.isArray(held) ? held : [held];
    const replaced = slots.map((slot) => {
      const authored = extracted[slot.name];
      if (authored === undefined) return slot;
      const material = createSpatialMaterial(authored);
      material.name = slot.name;
      return material;
    });
    (child as Mesh).material = Array.isArray(held) ? replaced : (replaced[0] as Material);
  });
  return model;
}
