import * as THREE from 'three';
import { getUserData } from '../ecs/user-data';
import type { ResolvedRenderSettings } from './render-settings';
import { staticBatchSignature } from './structural-signature';

/**
 * Runtime STATIC render-batching (the framework-level transparent perf delivery).
 *
 * Scans a loaded scene graph for STATIC meshes sharing geometry+material and draws
 * each group through ONE InstancedMesh. The originals are DETACHED from the render
 * tree (so the renderer never walks them — zero per-frame cost), but retained here
 * as the logical handles: re-attached on teardown, and resolvable via raycast().
 * N logical objects → 1 draw call, ~0 CPU/frame. This is the classic "static
 * batching" technique (cf. Unity/PlayCanvas static batch groups).
 *
 * Strategy 1 (keep identity, don't merge). Moving entities (boids-style,
 * all-frame churn) are a separate concern, and the engine does not answer it:
 * a game's production answer is the `static-batch` capability's `<Frozen>`
 * (see the scope note below).
 *
 * Eligibility (anything failing stays an ordinary draw — degrade, don't break):
 *   - plain THREE.Mesh (not Instanced/Skinned/Batched)
 *   - single, opaque material (transparency needs per-object sorting)
 *   - group of ≥2 sharing (geometry, material, shadow flags)
 *   - (there is no per-entity opt-out setting: this docblock used to name
 *     `entity.render.autoBatch === false`, a render-feature field NO CODE HERE
 *     OR ANYWHERE EVER READ. The field was deleted with R-2's coverage fix;
 *     opting a subtree out is the `static-batch` capability's `<Frozen>`
 *     declaration, per the scope note below.)
 *   - STATIC members (no physics/components/animation) → detached; MOVING members →
 *     kept in-graph hidden + dirty-synced each frame. A bucket may split into both.
 *
 * Scope / limitations (v1):
 *   - NOT WIRED: nothing in the engine calls build(), and nothing constructs
 *     this class. The only remaining reference is the hosted editor's
 *     project-script module map (`editor/src/served-bundle-runtime-modules.ts`),
 *     which loads the module so a project script MAY drive it; the example
 *     that used to is gone. That is settled, not pending: a game's
 *     production answer is the `static-batch` capability's `<Frozen>`, a
 *     DECLARED mount-static subtree in the game's own TSX, and `dev/static-
 *     batch-advisor.ts` is what routes an author to it by measurement. Full-
 *     auto inference over a scene nobody declared static is what this class
 *     would need to become, and it was rejected (issue #1503).
 *   - build() is a one-shot scan of the scene handed to it. Entities spawned
 *     AFTER build do not join a batch; call build() again to re-scan. Removing a batched
 *     source leaves a stale instance until rebuild. (Static scenery is load-time stable.)
 *   - The batch culls as ONE unit (no per-instance frustum culling yet — Tier-2).
 */

interface Group {
  instanced: THREE.InstancedMesh;
  sources: THREE.Mesh[]; // instanceId → source (raycast mapping + restore on teardown)
  dynamic: boolean; // true = sources kept in the graph & re-synced each frame (movers)
  cache?: Float32Array; // dynamic only: last-synced matrixWorld elements (16/source)
}

// Structural signature — groups meshes that are VALUE-identical, not object-identical.
// The engine scene-loader instantiates a fresh geometry+material per entity (no dedup),
// so keying on .uuid would never batch a real scene; a TSX/R3F world writing inline
// `<meshStandardMaterial>` elements has exactly the same property. That key lives in
// `render/structural-signature.ts` — ONE owner, shared with the `static-batch`
// capability's `<Frozen>`, so the two cannot drift into disagreeing about what
// "the same draw" means. `staticBatchSignature` is this file's original key, moved.
const SIG = staticBatchSignature;

/** Match Three.js renderer visibility: a hidden ancestor hides the whole subtree. */
function isEffectivelyVisible(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}

function isBatchCandidate(object: THREE.Object3D, batchRoot: THREE.Group): object is THREE.Mesh {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return false;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) return false;
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if ((mesh as unknown as THREE.BatchedMesh).isBatchedMesh) return false;
  if (!isEffectivelyVisible(mesh)) return false;
  if (!mesh.geometry || !mesh.material || Array.isArray(mesh.material)) return false;
  if ((mesh.material as THREE.Material).transparent) return false;
  return batchRoot !== mesh.parent;
}

/**
 * Static-batching eligibility: only objects that won't move are safe to freeze
 * and instance. An object (or an ancestor) carrying its own animation mixer is
 * a likely mover → left as an ordinary draw. Plain scenery is eligible. This is
 * the safe, transparent default; a future dynamic-batch path (markMoved-driven)
 * can include movers.
 */
function isLikelyStatic(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (getUserData(cur, '_animMixer')) return false;
    cur = cur.parent;
  }
  return true;
}

export class RenderBatchSystem {
  private root = new THREE.Group();
  private groups: Group[] = [];
  private dynamicGroups: Group[] = []; // subset needing per-frame sync
  // Original parent of each detached (static) source, to re-attach on teardown.
  private parentOf = new WeakMap<THREE.Mesh, THREE.Object3D>();
  // instanceId mapping for raycast: which group + slot an InstancedMesh belongs to.
  private membersOf = new WeakMap<THREE.InstancedMesh, THREE.Mesh[]>();

  constructor(
    private scene: THREE.Scene,
    private settings: ResolvedRenderSettings,
  ) {
    this.root.name = 'RenderBatchSystem';
    this.root.matrixAutoUpdate = false; // instances carry world matrices directly
  }

  /** Scan the scene and build instanced groups. Idempotent (rebuilds). */
  build(): void {
    this.teardown();
    this.scene.add(this.root);
    this.scene.updateMatrixWorld(true);

    // collect eligible candidates, grouped by (geometry, material)
    const buckets = new Map<string, THREE.Mesh[]>();
    this.scene.traverse((obj) => {
      if (!isBatchCandidate(obj, this.root)) return;
      const key = SIG(obj);
      const arr = buckets.get(key) ?? [];
      arr.push(obj);
      buckets.set(key, arr);
    });

    // Each signature bucket is partitioned into STATIC (detached, zero-cost) and
    // DYNAMIC (kept in-place, dirty-synced) members, each ≥2 forming its own batch.
    for (const bucket of buckets.values()) {
      const staticMembers: THREE.Mesh[] = [];
      const dynamicMembers: THREE.Mesh[] = [];
      for (const m of bucket) (isLikelyStatic(m) ? staticMembers : dynamicMembers).push(m);
      if (staticMembers.length >= 2) this.makeGroup(staticMembers, false);
      if (dynamicMembers.length >= 2) this.makeGroup(dynamicMembers, true);
    }
  }

  private makeGroup(sources: THREE.Mesh[], dynamic: boolean): void {
    const frustum = this.settings['frustumCulling'] !== false;
    const tmp = new THREE.Matrix4();
    const proto = sources[0]!;
    const inst = new THREE.InstancedMesh(
      proto.geometry,
      proto.material as THREE.Material,
      sources.length,
    );
    inst.frustumCulled = frustum && !dynamic; // moving batches can leave the padded sphere
    // Inherit shadow flags from the prototype so batched objects still cast/receive
    // shadows (otherwise detaching the sources would silently drop them from shadows).
    inst.castShadow = proto.castShadow;
    inst.receiveShadow = proto.receiveShadow;
    const cache = dynamic ? new Float32Array(sources.length * 16) : undefined;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i]!;
      tmp.copy(s.matrixWorld);
      inst.setMatrixAt(i, tmp);
      if (dynamic) {
        // keep the source in the graph (physics/animation still updates its matrixWorld),
        // just hide its own draw; we copy its world matrix into the instance each frame.
        cache!.set(tmp.elements, i * 16);
        s.visible = false;
      } else if (s.parent) {
        // static: detach entirely so the renderer never walks it (zero per-frame cost)
        this.parentOf.set(s, s.parent);
        s.parent.remove(s);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    if (frustum && !dynamic) inst.computeBoundingSphere();
    this.membersOf.set(inst, sources);
    this.root.add(inst);
    const group: Group = cache
      ? { instanced: inst, sources, dynamic, cache }
      : { instanced: inst, sources, dynamic };
    this.groups.push(group);
    if (dynamic) this.dynamicGroups.push(group);
  }

  /**
   * Per-frame sync for DYNAMIC groups only (static are detached & immutable → free).
   * Called in the preRender phase. Refreshes world matrices once (the engine's movers
   * set matrixWorldNeedsUpdate via physics/animation), then re-writes only the instances
   * whose source moved (element-wise cache compare). No-op when there are no movers.
   */
  update(): void {
    if (this.dynamicGroups.length === 0) return;
    this.scene.updateMatrixWorld(false); // refresh moved subtrees (force=false → cheap)
    for (const g of this.dynamicGroups) {
      const cache = g.cache!;
      let dirty = false;
      for (let i = 0; i < g.sources.length; i++) {
        const el = g.sources[i]!.matrixWorld.elements;
        const off = i * 16;
        let changed = false;
        for (let k = 0; k < 16; k++) {
          if (el[k] !== cache[off + k]) {
            changed = true;
            break;
          }
        }
        if (!changed) continue;
        g.instanced.setMatrixAt(i, g.sources[i]!.matrixWorld);
        cache.set(el, off);
        dirty = true;
      }
      if (dirty) g.instanced.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Raycast against the batched instances, mapping a hit back to the logical source
   * Object3D (so editor/gameplay picking still resolves a detached entity).
   */
  raycast(raycaster: THREE.Raycaster): THREE.Mesh | null {
    const hits = raycaster.intersectObject(this.root, true);
    for (const h of hits) {
      const members = this.membersOf.get(h.object as THREE.InstancedMesh);
      if (members && h.instanceId != null) return members[h.instanceId] ?? null;
    }
    return null;
  }

  /** Number of draw calls the batcher contributes (1 per group). */
  get drawCalls(): number {
    return this.groups.length;
  }

  /** How many source meshes were collapsed into instances. */
  get batchedCount(): number {
    return this.groups.reduce((n, g) => n + g.sources.length, 0);
  }

  teardown(): void {
    for (const g of this.groups) {
      for (const s of g.sources) {
        if (g.dynamic)
          s.visible = true; // dynamic sources stayed in-graph, hidden
        else {
          const parent = this.parentOf.get(s); // static sources were detached — re-attach
          if (parent) parent.add(s);
        }
      }
      g.instanced.dispose();
      this.root.remove(g.instanced);
    }
    this.groups = [];
    this.dynamicGroups = [];
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}
