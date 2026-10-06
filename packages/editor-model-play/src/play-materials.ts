/**
 * RECOLOURING THE DETACHED COPY — `play.tint` and `play.setOpacity` (`play-script.ts`).
 *
 * Changing a presented mesh's colour the three.js way does not work on the copy, for reasons
 * the presenter has and a script cannot see:
 *
 * - A Blender mesh's `material` is an ARRAY, one entry per material slot (a lone material only
 *   for an object with no slots, which wears the presenter's grey fallback), so
 *   `mesh.material.color` is `undefined`.
 * - The entries are SHARED: one material per Blender material, worn by every object with it
 *   in a slot. Recolouring one in place recolours them all.
 * - The presenter OWNS `mesh.material`: whenever it re-applies shading it assigns every mesh's
 *   slots again from its own table, so materials a script assigned are put back.
 * - `clone()` drops the presenter's draw hooks (its shader, private uniforms and node graph).
 * - A material whose Base Color or Alpha a node graph drives never reads `color` or `opacity`:
 *   the graph's output replaces them in the shader.
 *
 * So an override is per OBJECT: the object's slots are swapped for copies of their own (the
 * document's `ownMaterial`, which keeps its hooks and draws the material's constants, its
 * image texture included), the copies carry the tint and opacity, and the authored slots are
 * remembered. Each frame, an object whose slots the presenter has put back is given copies of
 * the slots it now has. Clearing both returns the authored slots.
 */
import type * as THREE from 'three';

type Slots = THREE.Material | THREE.Material[];
type Colored = THREE.Material & { color?: THREE.Color; emissive?: THREE.Color };

interface Override {
  readonly mesh: THREE.Mesh;
  authored: Slots;
  shown: Slots;
  copies: Colored[];
  color: THREE.ColorRepresentation | null;
  opacity: number | null;
}

const slotsOf = (slots: Slots): THREE.Material[] => Array.isArray(slots) ? slots : [slots];
const isColor = (value: unknown): value is THREE.Color =>
  typeof value === 'object' && value !== null && (value as THREE.Color).isColor === true;

export interface MaterialOverrides {
  tint(target: THREE.Object3D, color: THREE.ColorRepresentation | null): void;
  setOpacity(target: THREE.Object3D, opacity: number | null): void;
  /** After the script's update: re-wear the copies on any object the presenter re-dressed. */
  frame(): void;
  /** Return every object its authored slots and release the copies. */
  dispose(): void;
}

/** `ownMaterial` answers the document's copy of one of its materials, or null for one that is
 *  not the document's (a material the script made), which is cloned. */
export function materialOverrides(ownMaterial: ((material: THREE.Material) => THREE.Material | null) | undefined): MaterialOverrides {
  const overrides = new Map<THREE.Mesh, Override>();
  const release = (override: Override): void => {
    for (const copy of override.copies) copy.dispose();
    override.copies = [];
  };
  const dress = (override: Override): void => {
    release(override);
    override.copies = slotsOf(override.authored).map((material) => (ownMaterial?.(material) ?? material.clone()) as Colored);
    override.shown = Array.isArray(override.authored) ? override.copies : override.copies[0]!;
    override.mesh.material = override.shown;
  };
  // Values only: the copies were made from the authored slots, so each starts from its own.
  const paint = (override: Override): void => {
    const authored = slotsOf(override.authored) as Colored[];
    override.copies.forEach((copy, index) => {
      const source = authored[index]!;
      if (isColor(copy.color) && isColor(source.color)) {
        if (override.color === null) copy.color.copy(source.color);
        else copy.color.set(override.color);
      }
      // An emitting surface glows in its tint; one that does not stays unlit by it.
      if (isColor(copy.emissive) && isColor(source.emissive)) {
        const emits = source.emissive.r + source.emissive.g + source.emissive.b > 0;
        if (override.color === null || !emits) copy.emissive.copy(source.emissive);
        else copy.emissive.set(override.color);
      }
      copy.opacity = override.opacity ?? source.opacity;
      const transparent = source.transparent || copy.opacity < 1;
      if (copy.transparent !== transparent) {
        copy.transparent = transparent;
        copy.needsUpdate = true;
      }
    });
  };
  const change = (target: THREE.Object3D, edit: (override: Override) => void): void => {
    target.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh !== true || !mesh.material) return;
      let override = overrides.get(mesh);
      if (!override) {
        override = { mesh, authored: mesh.material, shown: mesh.material, copies: [], color: null, opacity: null };
        edit(override);
        if (override.color === null && override.opacity === null) return;
        overrides.set(mesh, override);
        dress(override);
      } else edit(override);
      if (override.color === null && override.opacity === null) {
        mesh.material = override.authored;
        release(override);
        overrides.delete(mesh);
        return;
      }
      paint(override);
    });
  };
  return {
    tint(target, color) { change(target, (override) => { override.color = color; }); },
    setOpacity(target, opacity) {
      if (opacity !== null && !Number.isFinite(opacity)) throw new Error(`setOpacity takes a number from 0 to 1, or null; it was given ${String(opacity)}.`);
      const value = opacity === null ? null : Math.min(1, Math.max(0, opacity));
      change(target, (override) => { override.opacity = value; });
    },
    frame() {
      for (const override of overrides.values()) {
        if (override.mesh.material === override.shown) continue;
        override.authored = override.mesh.material;
        dress(override);
        paint(override);
      }
    },
    dispose() {
      for (const override of overrides.values()) {
        if (override.mesh.material === override.shown) override.mesh.material = override.authored;
        release(override);
      }
      overrides.clear();
    },
  };
}
