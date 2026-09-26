/**
 * Baked GridMap placement — the InstancedMesh fill walk and the trimesh-collider builder a
 * physics-stepping level hangs on one fixed body.
 *
 * Distinct from `grid-map.ts`, which is the runtime `set_cell_item` / MeshLibrary API for
 * city-builder. Both index the SAME orientation table — `basis.ts`'s `GODOT_ORTHO_BASES`, Godot's
 * 24 `_ortho_bases` — and that is not a detail: `grid-map.ts` used to keep a private four-entry
 * Y-turn table, so the two files meant different things by orientation 1. This file is the bake
 * path a translated `GridMap` with authored `data.cells` emits — platformer-3d's Stage is the
 * measured consumer.
 *
 * World / body / collider are typed structurally (Rapier's own classes satisfy them; see
 * `kinematic-body-3d.ts`), but `ColliderDesc.trimesh` and `CoefficientCombineRule` are REAL VALUE
 * IMPORTS — the static factory is the one call this helper has to make (typed through
 * {@link GridMapColliderDescFactory}) so the call site can stay
 * `buildGridMapTrimeshColliders(this.ctx.world, …)`. Because a value import must RESOLVE,
 * `@dimforge/rapier3d-compat` is declared in this capability's `packageJson.dependencies`, at the
 * same `^0.14.0` `unity-compat` declares (one range in the wild is one installed copy: Rapier's
 * classes carry private fields, so two copies' types are mutually unassignable — the hazard
 * `character/rapier.ts` documents). A 2D-only port deletes the 3D files whole, the way this
 * folder is split; dropping the dependency line from its own `package.json` is that port's edit
 * to make, and it is cheaper than a copied file that does not resolve.
 *
 * **Owns:** nothing with a lifetime. {@link composeGridMapPlacements} returns matrices the
 * scene holds as a module constant; {@link fillGridMapInstances} writes one `InstancedMesh`
 * the caller already created; {@link buildGridMapTrimeshColliders} hands back Rapier's own
 * colliders it built on the caller's body. **Shares:** the placement table the scene composed
 * at module load. **Teardown:** the scene's `detachNodes` removes the body; this file holds
 * nothing.
 */

import { CoefficientCombineRule, ColliderDesc } from '@dimforge/rapier3d-compat';
import { markBuiltInternal } from '@volter/threejs-runtime/adapter/hierarchy-marks';
import { type InstancedMesh, Matrix4, type Object3D, Quaternion, Vector3 } from 'three';
import { basisAtOrthogonalIndex } from './basis';
import type { CollisionLayers, LayeredCollider } from './collision-layers';
import type { GodotColliderOwner, GodotMutableColliderRegistry } from './collider-registry';

/** The authored GridMap settings {@link composeGridMapPlacements} needs, as a data literal. */
export interface GridMapPlacementSpec {
  readonly cellSize: readonly [number, number, number];
  readonly cellScale: number;
  readonly offset: readonly [number, number, number];
}

/**
 * Compose one cell's placement the way Godot composes it (`GridMap::get_meshes`,
 * `modules/gridmap/grid_map.cpp`:1073–1085):
 *
 *     xform.basis.set_orthogonal_index(c.rot);
 *     xform.set_origin(cellpos * cell_size + ofs);
 *     xform.basis.scale(Vector3(cell_scale, cell_scale, cell_scale));
 *
 * THE ORDER IS LOAD-BEARING: the origin is set from the UNSCALED cell coordinate and
 * `cell_scale` scales only the basis, so the tiles overlap slightly rather than the grid
 * spreading apart. `cells` is five numbers per cell — x, y, z, item id, orientation into
 * `basis.ts`'s `GODOT_ORTHO_BASES` (reached through {@link basisAtOrthogonalIndex}, which is
 * `Basis.set_orthogonal_index`) — the document's own decoded `data.cells`.
 *
 * three's `Matrix4.set` takes ROWS, and a `Basis` is the images of the unit axes — which are the
 * COLUMNS. Reading one as the other transposes every rotation in the level.
 */
export function composeGridMapPlacements(
  cells: ArrayLike<number>,
  spec: GridMapPlacementSpec,
): { item: number; matrix: Matrix4 }[] {
  const out: { item: number; matrix: Matrix4 }[] = [];
  const [sizeX, sizeY, sizeZ] = spec.cellSize;
  const [offsetX, offsetY, offsetZ] = spec.offset;
  const s = spec.cellScale;
  for (let i = 0; i < cells.length; i += 5) {
    const [c0, c1, c2] = basisAtOrthogonalIndex(cells[i + 4] as number);
    const matrix = new Matrix4().set(
      c0.x * s,
      c1.x * s,
      c2.x * s,
      (cells[i] as number) * sizeX + offsetX,
      c0.y * s,
      c1.y * s,
      c2.y * s,
      (cells[i + 1] as number) * sizeY + offsetY,
      c0.z * s,
      c1.z * s,
      c2.z * s,
      (cells[i + 2] as number) * sizeZ + offsetZ,
      0,
      0,
      0,
      1,
    );
    out.push({ item: cells[i + 3] as number, matrix });
  }
  return out;
}

/**
 * Put every placement of one `MeshLibrary` item onto its `InstancedMesh`.
 *
 * The order is the placement table's, which is the `.tscn`'s own cell order. Nothing here
 * recomputes a transform: the table was composed once, at module load, by the transcription of
 * `GridMap::get_meshes`.
 *
 * This is also the ATTACH SEAM for one pool, so it is where the pool declares itself engine
 * machinery. A Godot `GridMap` is ONE node: its cells are data, and the render batches behind
 * them are not nodes at all — its remote tree shows the GridMap and its authored children, never
 * an octant. Ours draws one `InstancedMesh` per `MeshLibrary` item used, so without the mark
 * this level's hierarchy grew seventeen `GridMap:*` rows nobody wrote.
 */
export function fillGridMapInstances(
  mesh: InstancedMesh | null,
  placements: readonly { readonly item: number; readonly matrix: Matrix4 }[],
  item: number,
): void {
  if (mesh === null) return;
  markBuiltInternal(mesh);
  let index = 0;
  for (const placement of placements) {
    if (placement.item !== item) continue;
    mesh.setMatrixAt(index, placement.matrix);
    index += 1;
  }
  mesh.count = index;
  mesh.instanceMatrix.needsUpdate = true;
  // Instance transforms live in an attribute three never inspects on its own, so an
  // InstancedMesh whose bounds were left at the geometry's is culled the moment the camera
  // stops looking at cell zero.
  mesh.computeBoundingSphere();
}

/**
 * The half of a Rapier 3D `ColliderDesc` this helper builds. Rapier's own `ColliderDesc`
 * satisfies it.
 */
export interface GridMapColliderDesc {
  setTranslation(x: number, y: number, z: number): this;
  setRotation(rotation: { x: number; y: number; z: number; w: number }): this;
  setFriction(friction: number): this;
  setFrictionCombineRule(rule: number): this;
  setRestitution(restitution: number): this;
  setRestitutionCombineRule(rule: number): this;
}

/**
 * The static `ColliderDesc.trimesh` factory. Rapier's own class satisfies it.
 */
export interface GridMapColliderDescFactory {
  trimesh(vertices: Float32Array, indices: Uint32Array): GridMapColliderDesc;
}

/**
 * The half of a Rapier 3D `World` this helper touches. Rapier's own `World` satisfies it.
 * `desc` is Rapier's `ColliderDesc` (the one static factory this file imports) so a real
 * `RAPIER.World` is assignable without a second Rapier import at the call site.
 */
export interface GridMapPhysicsWorld<TCollider = object, TBody = object> {
  createCollider(desc: ColliderDesc, parent?: TBody): TCollider;
}

/** Rapier's own `CoefficientCombineRule.Min`. This file already imports
 *  `@dimforge/rapier3d-compat` as a VALUE (`ColliderDesc`, above) and the catalog entry declares
 *  that dependency, so the rule is read off the library rather than transcribed as a number. */
const FRICTION_COMBINE_MIN = CoefficientCombineRule.Min;

/** Rapier's own `CoefficientCombineRule.Max`, read the same way. See
 *  {@link GridMapColliderSurface.restitution} for why bounce takes Max. */
const RESTITUTION_COMBINE_MAX = CoefficientCombineRule.Max;

/** The surface and placement facts one `GridMap`'s cell colliders all share. */
export interface GridMapColliderSurface {
  /** The GridMap node's own `collision_layer` — Godot hangs every cell on the one static body. */
  readonly layer: number;
  /** The GridMap node's own `collision_mask`. */
  readonly mask: number;
  /**
   * `physics_material.friction`, or Godot's own static-body default of `1.0`.
   *
   * Carried with Rapier's `Min` rule, which is Godot's contact-pair rule EXACTLY: `ABS(MIN(A, B))`
   * (`servers/physics/body_pair_sw.cpp` `combine_friction`, 3.6-stable lines 196-198; identically
   * `servers/physics_3d/godot_body_pair_3d.cpp` 257-259 @ 4.3-stable). The `ABS` is what makes
   * Godot's `rough` flag win a pair (`PhysicsMaterial::computed_friction()` returns `-friction`
   * when set), and the reader refuses an authored `rough` on THIS path by name — Godot 3.6's
   * GridMap hands the server `get_friction()` (`grid_map.cpp:352`) where 4.3's hands it
   * `computed_friction()` (`grid_map.cpp:371`), so the two majors disagree about whether the flag
   * does anything at all and neither reading is measured. Every coefficient reaching this seat is
   * therefore non-negative and the `ABS` is a no-op. Unlike {@link
   * GridMapColliderSurface.restitution}, nothing about friction is an approximation.
   */
  readonly friction: number;
  /**
   * `physics_material.bounce`, when the level authors a non-zero one. Absent means Godot's own
   * default of `0`, which is Rapier's default too — the one case where leaving a collider alone
   * IS the authored surface, so nothing is written and no combine rule is named.
   *
   * The COMBINE RULE is where the two engines stop agreeing, and this carries the scalar rather
   * than pretending otherwise. Godot combines a contact pair's bounce as `CLAMP(A + B, 0, 1)`
   * (`servers/physics/body_pair_sw.cpp` `combine_bounce`, 3.6-stable lines 192-194; identically
   * `servers/physics_3d/godot_body_pair_3d.cpp` 253-255 @ 4.3-stable). Rapier's released rule set
   * is Average/Min/Multiply/Max and has no clamped sum, and it resolves a pair whose colliders
   * name different rules by taking the HIGHER-valued one — so naming `Max` here, on the only
   * collider that authors a bounce at all, reproduces Godot EXACTLY whenever at most one side of
   * the pair is bouncy (a clamped sum with a zero addend IS the max). Two bouncy bodies meeting
   * each other is the remainder, and the translation records it as a deviation note rather than
   * this file approximating it.
   */
  readonly restitution?: number;
  /**
   * The GridMap node's WORLD scale, read off the node by the caller (`Object3D.getWorldScale`).
   *
   * A Rapier body carries a translation and a unit quaternion and has NO scale slot, so a scaled
   * GridMap would otherwise collide at the size its own transform does not have. Godot's body IS
   * the GridMap's `global_transform`, scale included, so the scale is baked into the geometry
   * instead — see {@link buildGridMapTrimeshColliders} for the two cases and the arithmetic.
   */
  readonly scale: { readonly x: number; readonly y: number; readonly z: number };
}

/** Whether a world scale is the same on all three axes, which is the case a rotation-plus-scaled-
 *  vertices collider carries exactly (a uniform factor commutes with the cell's rotation). */
function isUniformScale(scale: { x: number; y: number; z: number }): boolean {
  const magnitude = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  if (magnitude === 0) return true;
  const tolerance = magnitude * 1e-6;
  return Math.abs(scale.x - scale.y) <= tolerance && Math.abs(scale.x - scale.z) <= tolerance;
}

/**
 * Build a `GridMap`'s static collision: one trimesh collider per cell, hung on the ONE fixed body
 * the scene seeds at the GridMap's world transform.
 *
 * Godot's `GridMap` adds every cell's `ConcavePolygonShape` to ONE static body per octant, at the
 * cell placement `xform * shape.local_transform` (`modules/gridmap/grid_map.cpp` `_octant_update`,
 * 541–551), and sets that body's transform to the GridMap's own `global_transform`. This mirrors it
 * exactly with ONE fixed body: the body IS the GridMap's world transform (seeded by the caller in
 * `attachNodes`), and each collider's LOCAL transform is the cell placement — Rapier composes
 * `body ∘ cell` the way Godot composes `global ∘ cell`.
 *
 * The cell placement's basis is `cell_scale · orthoRotation` (`GridMap::get_meshes`), and a Rapier
 * trimesh has no scale slot. The 24 orthogonal bases are signed permutations, so every placement
 * column has magnitude exactly `cell_scale` — a uniform scale, identical for every cell of every
 * item. The triangle soup keeps Godot's own storage: three vertices per triangle indexed
 * `0,1,2,…` with NO re-welding, because welding changes which triangles share an edge — a
 * different collider — exactly as `read/mesh-library.ts` decodes it.
 *
 * ## The GridMap node's own scale
 *
 * `surface.scale` is the node's WORLD scale, and it is part of the same problem: Godot's static
 * body IS the GridMap's `global_transform`, which a Rapier body (translation + unit quaternion)
 * cannot hold. Writing `world = T ∘ R ∘ S` for the node and `cell = (t, cellScale · R_ortho)` for
 * the placement, Godot's world-space collider is `T ∘ R ∘ S ∘ cell`; the caller seeds the body at
 * `(T, R)`, so what is left for this file to express is `S ∘ cell` — a translation of `S · t` and
 * a linear part of `S · R_ortho · cellScale`. Both cases below are that one identity:
 *
 *  - **Uniform `S`** (the overwhelmingly common case, and the only one a level authors by hand):
 *    a scalar commutes with the rotation, so the linear part collapses to
 *    `(s · cellScale) · R_ortho` — the rotation stays on the collider and ONE factor bakes into
 *    the item's vertices, shared by every cell that paints it. `s = 1` reproduces the unscaled
 *    build exactly.
 *  - **Non-uniform `S`**: `S · R_ortho` is a general linear map and no longer a rotation, so the
 *    WHOLE map bakes per vertex and the collider carries no rotation at all. The soup is then
 *    keyed by item AND placement basis, because two cells of the same item at different
 *    orientations no longer share one baked soup.
 *
 * A SHEARED node basis reaches neither case — `Object3D.getWorldScale` decomposes, and a
 * decomposition of a sheared matrix is silently wrong — and the translation refuses it by name
 * before this file is ever called.
 */
export function buildGridMapTrimeshColliders<TCollider extends object, TBody extends object>(
  world: GridMapPhysicsWorld<TCollider, TBody>,
  body: TBody,
  shape: {
    readonly trimeshes: Readonly<Record<number, Float32Array>>;
    readonly placements: readonly { readonly item: number; readonly matrix: Matrix4 }[];
  },
  layers: CollisionLayers,
  surface: GridMapColliderSurface,
  colliders: GodotMutableColliderRegistry<TCollider, GodotColliderOwner>,
  owner: GodotColliderOwner,
): TCollider[] {
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const node = surface.scale;
  const uniform = isUniformScale(node);
  // Per baked soup: the vertex buffer and its identity index buffer, built once and shared across
  // every cell it serves. A uniform node scale keys by item id alone (every cell of an item bakes
  // the same factor); a non-uniform one keys by item AND placement basis, since the basis is part
  // of what was baked.
  const baked = new Map<string, { vertices: Float32Array; indices: Uint32Array }>();
  const built: TCollider[] = [];
  for (const placement of shape.placements) {
    const soup = shape.trimeshes[placement.item];
    // An item with no collision shape is decoration — Godot adds nothing to the static body for it.
    if (soup === undefined) continue;
    placement.matrix.decompose(position, quaternion, scale);
    const e = placement.matrix.elements;
    const key = uniform
      ? `${placement.item}`
      : `${placement.item}|${e[0]},${e[1]},${e[2]},${e[4]},${e[5]},${e[6]},${e[8]},${e[9]},${e[10]}`;
    let mesh = baked.get(key);
    if (mesh === undefined) {
      const vertices = new Float32Array(soup.length);
      if (uniform) {
        // `cell_scale` is uniform (scale.x === scale.y === scale.z) and identical for every cell —
        // the orthogonal bases are signed permutations, so every placement column has magnitude
        // exactly `cell_scale`. Times the node's own uniform scale, that is the one factor the
        // vertices carry; the cell's rotation stays on the collider.
        const factor = scale.x * node.x;
        for (let i = 0; i < soup.length; i += 1) vertices[i] = (soup[i] as number) * factor;
      } else {
        // `Matrix4.elements` is COLUMN-major, so `e[0..2]` is the image of local X and so on; the
        // node's per-axis scale then multiplies the ROWS of that product.
        for (let i = 0; i < soup.length; i += 3) {
          const x = soup[i] as number;
          const y = soup[i + 1] as number;
          const z = soup[i + 2] as number;
          vertices[i] =
            node.x * ((e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z);
          vertices[i + 1] =
            node.y * ((e[1] as number) * x + (e[5] as number) * y + (e[9] as number) * z);
          vertices[i + 2] =
            node.z * ((e[2] as number) * x + (e[6] as number) * y + (e[10] as number) * z);
        }
      }
      const indices = new Uint32Array(vertices.length / 3);
      for (let i = 0; i < indices.length; i += 1) indices[i] = i;
      mesh = { vertices, indices };
      baked.set(key, mesh);
    }
    const desc = ColliderDesc.trimesh(mesh.vertices, mesh.indices)
      // The cell's own offset inside the GridMap, through the node's scale — the `S · t` half.
      .setTranslation(position.x * node.x, position.y * node.y, position.z * node.z)
      // The GridMap's own surface, on the SAME terms as every other collider the emitter builds:
      // Godot's static-body friction default is 1.0 against Rapier's 0.5, and Godot takes a
      // contact pair's MINIMUM where Rapier averages it. This is the level's floor, so leaving it
      // at Rapier's defaults made every body that walks on it read a different surface than
      // Godot's — and it made `enemy.tscn`'s deliberate friction = 0 average up to 0.25 instead of
      // taking the floor's coefficient down to 0.
      .setFriction(surface.friction)
      .setFrictionCombineRule(FRICTION_COMBINE_MIN);
    // A non-uniform node scale baked the cell's rotation into the vertices; there is nothing
    // orthonormal left to hand the collider.
    if (uniform) {
      desc.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
    }
    if (surface.restitution !== undefined) {
      desc.setRestitution(surface.restitution).setRestitutionCombineRule(RESTITUTION_COMBINE_MAX);
    }
    const collider = world.createCollider(desc, body);
    // This cell's `collision_layer`/`collision_mask` — the GridMap's own, since Godot hangs every
    // cell's shape on the one static body the GridMap node configures. The call also arms the
    // world's contact filter for the collider; see godot-compat's `collision-layers.ts`.
    layers.set(collider as LayeredCollider, surface.layer, surface.mask);
    // The scene→collider link Godot fuses and this engine keeps separate: a ray or shape query that
    // hits this cell resolves to the GridMap's own Object3D.
    colliders.set(collider, owner);
    built.push(collider);
  }
  return built;
}
