/**
 * THE FREEZE — the whole batching mechanism, as plain functions over a
 * `THREE.Object3D`. `Frozen.tsx` is a twelve-line React wrapper around it, and
 * everything worth testing is here, provable headlessly with no renderer and
 * no React.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 * A game authored as TSX draws one mesh per JSX element. That is the right
 * authoring model and the wrong SUBMISSION model: a hall built from a thousand
 * named panels is a thousand draw calls, and at ~2.75 µs of CPU each, a
 * four-thousand-mesh scene spends ~11 ms per frame doing nothing but telling
 * the GPU what to draw. {@link freezeSubtree} collapses that mechanically:
 *
 *   1. walk the subtree, keeping the meshes that are safe to collapse
 *      (`staticBatchSkipReason`, in the engine — see ELIGIBILITY below);
 *   2. group them by STRUCTURAL material identity plus the shadow flags —
 *      by what the draw LOOKS like, never by `material.uuid` (see THE UUID
 *      TRAP below, which is the whole reason this is not a ten-line helper);
 *   3. inside a group, members whose geometry is also structurally identical
 *      become ONE `InstancedMesh`; the rest — same material, different shapes
 *      — become ONE merged mesh;
 *   4. the originals are HIDDEN, not removed. React still owns them, their
 *      names still resolve for `render.census` and the editor hierarchy, and
 *      {@link restoreFrozen} puts everything back exactly as it was.
 *
 * ── THE UUID TRAP ───────────────────────────────────────────────────────────
 * The obvious grouping key is `material.uuid`. It is also the key that batches
 * NOTHING in a freshly scaffolded world, because inline JSX materials —
 * `<meshStandardMaterial color="#8a6a44" />` inside a `.map()` — construct one
 * material object PER MESH. Five hundred identical crates are five hundred
 * uuids. A uuid-keyed freeze reports "no groups found", renders correctly, and
 * is indistinguishable from a correct freeze over an unbatchable scene. The
 * key here is `materialMergeSignature` from `@volter/threejs-runtime/render/structural-
 * signature` — the SAME module the engine's own batcher and the draw-call
 * advisor use, so all three agree about what "the same draw" means.
 *
 * ── ELIGIBILITY: DEGRADE, NEVER BREAK ───────────────────────────────────────
 * Anything the engine's `staticBatchSkipReason` refuses — instanced, batched,
 * skinned, morph-target, transparent, or explicitly opted out — stays exactly
 * as it was. Multi-material meshes are the one capability-owned refinement:
 * every geometry group becomes a material-specific candidate, so batching
 * preserves the renderer's ordered slot assignment instead of flattening it.
 * A malformed group, missing slot, or transparent slot refuses the WHOLE mesh
 * before any original is hidden. A wrapper placed over a subtree that turns
 * out to be mostly ineligible loses nothing and says so on the console
 * ({@link freezeSubtree}'s `skipped` tally). It never leaves the graph
 * half-collapsed.
 *
 * ── THE CONTRACT, WHICH IS THE PART A COMPILER CANNOT CHECK ─────────────────
 * Children must be MOUNT-STATIC. Nothing under a freeze may move, re-colour,
 * unmount or conditionally appear afterwards: the visible pixels come from the
 * batched products, so a change to a hidden original simply never shows.
 * Reactive scenery belongs outside the wrapper. That contract used to live
 * only in a docblock, which is where contracts go to be broken silently —
 * `mutation-watch.ts` is the tripwire that now says so out loud.
 *
 * ── RESOURCE OWNERSHIP, STATED ONCE ─────────────────────────────────────────
 * OWNER: the {@link FrozenBatch} handle {@link freezeSubtree} returns. It owns
 * exactly the objects it CREATED — the merged geometries and the product
 * meshes — and nothing else. It does NOT own the source geometries or the
 * materials: those belong to the game's own component tree, are only borrowed
 * by the products, and disposing them here would tear the originals apart.
 * SHARERS: `Frozen.tsx` (one handle per mounted wrapper) and
 * `mutation-watch.ts` (reads the hidden originals). TEARDOWN:
 * {@link restoreFrozen}, the ONE path that ends a freeze — it un-hides every
 * original, removes every product, and disposes only the merged geometries it
 * created. Idempotent.
 */

import { markBuiltInternal } from '@volter/threejs-runtime/adapter/hierarchy-marks';
import {
  geometryLayoutSignature,
  geometrySignature,
  materialMergeSignature,
  type StaticBatchSkipReason,
  staticBatchSkipReason,
} from '@volter/threejs-runtime/render/structural-signature';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Marks a mesh this module CREATED, so a nested or repeated freeze walks past
 *  its own output instead of batching a batch. */
export const FROZEN_PRODUCT_KEY = 'staticBatchProduct';

/** One original, and the state a freeze changed on it. */
export interface FrozenSource {
  readonly mesh: THREE.Mesh;
  /** `visible` as the game set it, restored verbatim — a freeze must not
   *  un-hide something the game had deliberately hidden. */
  readonly wasVisible: boolean;
}

/** What one freeze produced and what it needs to undo itself. */
export interface FrozenBatch {
  /** The wrapper's name, for every message about this freeze. */
  readonly name: string;
  /** The node the products were added to. */
  readonly root: THREE.Object3D;
  /** The meshes this freeze created — instanced and merged products. */
  readonly products: readonly THREE.Mesh[];
  /** Product geometries this freeze created. Instanced products usually
   *  borrow source geometry, but a material-group instance owns its extracted
   *  group geometry too. Every entry is disposed exactly once on restore. */
  readonly ownedGeometries: readonly THREE.BufferGeometry[];
  /** The originals it hid, in walk order. */
  readonly sources: readonly FrozenSource[];
  /** Draws submitted by the members BEFORE (one per source) and AFTER (one per
   *  product). The reduction this freeze actually achieved, measured rather
   *  than assumed. */
  readonly drawsBefore: number;
  readonly drawsAfter: number;
  /** Eligible meshes the freeze refused, by reason. `not-a-mesh` is never
   *  counted: a `<group>` is not a refusal. */
  readonly skipped: Readonly<Partial<Record<FrozenSkipReason, number>>>;
  /** A representative refused node per reason, so a warning can name one. */
  readonly skippedExample: Readonly<Partial<Record<FrozenSkipReason, string>>>;
}

/** Capability-specific refusals extend the engine's node-level answer with
 *  the one invalid shape only group extraction can see. */
export type FrozenSkipReason = StaticBatchSkipReason | 'invalid-material-groups';

const activeBatches = new Set<FrozenBatch>();

/**
 * Publish a mounted freeze to render-side consumers. `freezeSubtree` stays a pure mechanical
 * operation: its React owners activate the handle only for the interval in which the declaration
 * is mounted, and the returned cleanup is the one path that retires it.
 */
export function activateFrozenBatch(batch: FrozenBatch): () => void {
  activeBatches.add(batch);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    activeBatches.delete(batch);
  };
}

/** Live mount-static regions. The wrapper itself remains mobile, so consumers must observe it. */
export function activeFrozenBatches(): readonly FrozenBatch[] {
  return [...activeBatches];
}

const UNNAMED = '(unnamed)';

function address(node: THREE.Object3D): string {
  return `${node.parent?.name || UNNAMED}/${node.name || UNNAMED}`;
}

/**
 * Collapse every batchable mesh under `root` into as few draws as the
 * structure allows, and answer the handle that undoes it.
 *
 * The products are added to `root` itself and baked into ROOT-LOCAL space, so
 * moving the wrapper still moves the whole frozen assembly as one — a freeze
 * takes away per-child mobility, not the wrapper's own.
 */
export function freezeSubtree(root: THREE.Object3D, name = 'Frozen'): FrozenBatch {
  root.updateWorldMatrix(true, true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();

  interface Candidate {
    mesh: THREE.Mesh;
    material: THREE.Material;
    /** Full source geometry for ordinary meshes; one physically extracted
     *  renderable group for a material-array mesh. */
    geometry: THREE.BufferGeometry;
    /** Extracted group geometries belong to this freeze until transferred to
     *  a product or disposed after a merge. */
    ownsGeometry: boolean;
    /** A material-array source must be replaced even when this candidate is a
     *  singleton; otherwise hiding the source drops that group's pixels. */
    requiresReplacement: boolean;
    /** Same shape, instanceable as one geometry. */
    geometryKey: string;
    /** Which vertex attributes it carries — `mergeGeometries` refuses a batch
     *  whose members disagree, so this is what the merge path groups by. */
    layoutKey: string;
  }
  const groups = new Map<string, Candidate[]>();
  const skipped: Partial<Record<FrozenSkipReason, number>> = {};
  const skippedExample: Partial<Record<FrozenSkipReason, string>> = {};
  const temporaryGeometries = new Set<THREE.BufferGeometry>();

  interface GeometryGroup {
    readonly start: number;
    readonly count: number;
    readonly materialIndex?: number | undefined;
  }

  const groupRange = (
    geometry: THREE.BufferGeometry,
    group: GeometryGroup,
  ): { start: number; count: number } | null => {
    const elements = geometry.getIndex()?.count ?? geometry.getAttribute('position')?.count ?? 0;
    if (
      !Number.isInteger(group.start) ||
      !Number.isInteger(group.count) ||
      group.start < 0 ||
      group.count < 0 ||
      group.start + group.count > elements
    ) {
      return null;
    }
    const drawStart = geometry.drawRange.start;
    const drawCount = geometry.drawRange.count;
    const drawEnd = drawCount === Number.POSITIVE_INFINITY ? elements : drawStart + drawCount;
    if (
      !Number.isInteger(drawStart) ||
      drawStart < 0 ||
      (drawCount !== Number.POSITIVE_INFINITY && (!Number.isInteger(drawCount) || drawCount < 0)) ||
      (!Number.isInteger(drawEnd) && drawEnd !== Number.POSITIVE_INFINITY)
    ) {
      return null;
    }
    const start = Math.max(group.start, drawStart);
    const end = Math.min(group.start + group.count, drawEnd, elements);
    return end <= start ? { start, count: 0 } : { start, count: end - start };
  };

  const extractGroup = (
    geometry: THREE.BufferGeometry,
    range: { start: number; count: number },
  ): THREE.BufferGeometry | null => {
    const extracted = geometry.clone();
    extracted.clearGroups();
    extracted.setDrawRange(0, Number.POSITIVE_INFINITY);
    const index = geometry.getIndex();
    if (index) {
      const values = index.array.slice(range.start, range.start + range.count);
      extracted.setIndex(new THREE.BufferAttribute(values, index.itemSize, index.normalized));
      return extracted;
    }
    for (const [attributeName, attribute] of Object.entries(geometry.attributes)) {
      if (
        'isInterleavedBufferAttribute' in attribute &&
        attribute.isInterleavedBufferAttribute === true
      ) {
        extracted.dispose();
        return null;
      }
      if (attribute.count < range.start + range.count) {
        extracted.dispose();
        return null;
      }
      const values = attribute.array.slice(
        range.start * attribute.itemSize,
        (range.start + range.count) * attribute.itemSize,
      );
      extracted.setAttribute(
        attributeName,
        new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized),
      );
    }
    return extracted;
  };

  const addCandidate = (candidate: Candidate): void => {
    const key = `${materialMergeSignature(candidate.material)}|${candidate.mesh.castShadow ? 1 : 0}${candidate.mesh.receiveShadow ? 1 : 0}|layers:${candidate.mesh.layers.mask}`;
    const existing = groups.get(key);
    if (existing) existing.push(candidate);
    else groups.set(key, [candidate]);
  };

  const multiMaterialCandidates = (mesh: THREE.Mesh): Candidate[] | null => {
    const materials = mesh.material as THREE.Material[];
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (
      materials.length === 0 ||
      materials.some((material) => !material?.isMaterial || material.transparent) ||
      geometry.groups.length === 0
    ) {
      return null;
    }
    const candidates: Candidate[] = [];
    const refuse = (): null => {
      for (const candidate of candidates) {
        temporaryGeometries.delete(candidate.geometry);
        candidate.geometry.dispose();
      }
      return null;
    };
    for (const group of geometry.groups) {
      const materialIndex = group.materialIndex ?? 0;
      const range = groupRange(geometry, group);
      if (
        !Number.isInteger(materialIndex) ||
        materialIndex < 0 ||
        materialIndex >= materials.length
      ) {
        return refuse();
      }
      if (range === null) {
        return refuse();
      }
      if (range.count === 0) continue;
      const extracted = extractGroup(geometry, range);
      if (!extracted) {
        return refuse();
      }
      temporaryGeometries.add(extracted);
      const layoutKey = geometryLayoutSignature(extracted);
      candidates.push({
        mesh,
        material: materials[materialIndex] as THREE.Material,
        geometry: extracted,
        ownsGeometry: true,
        requiresReplacement: true,
        geometryKey: `${geometrySignature(geometry)}|group:${range.start}:${range.count}|${layoutKey}`,
        layoutKey,
      });
    }
    if (candidates.length === 0) return null;
    return candidates;
  };

  const walk = (node: THREE.Object3D): void => {
    if (node.userData[FROZEN_PRODUCT_KEY] === true) return;
    // Hierarchical visibility: a hidden parent hides its subtree, and a freeze
    // that swallowed the children of a hidden group would make them appear.
    if (!node.visible) return;
    const reason = staticBatchSkipReason(node);
    if (reason === 'opted-out') {
      skipped['opted-out'] = (skipped['opted-out'] ?? 0) + 1;
      skippedExample['opted-out'] ??= address(node);
      return; // the opt-out covers the whole subtree
    }
    if (reason === null) {
      const mesh = node as THREE.Mesh;
      const material = mesh.material as THREE.Material;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const layoutKey = geometryLayoutSignature(geometry);
      const candidate: Candidate = {
        mesh,
        material,
        geometry,
        ownsGeometry: false,
        requiresReplacement: false,
        // The layout rides in the instancing key too: two geometries can be
        // structurally identical primitives and still disagree about, say, a
        // second UV set added downstream.
        geometryKey: `${geometrySignature(geometry)}|${layoutKey}`,
        layoutKey,
      };
      addCandidate(candidate);
    } else if (reason === 'multi-material') {
      const mesh = node as THREE.Mesh;
      const candidates = multiMaterialCandidates(mesh);
      if (candidates) {
        for (const candidate of candidates) addCandidate(candidate);
      } else {
        const invalidReason: FrozenSkipReason =
          Array.isArray(mesh.material) && mesh.material.some((material) => material?.transparent)
            ? 'transparent'
            : 'invalid-material-groups';
        skipped[invalidReason] = (skipped[invalidReason] ?? 0) + 1;
        skippedExample[invalidReason] ??= address(node);
      }
    } else if (reason !== 'not-a-mesh') {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
      skippedExample[reason] ??= address(node);
    }
    for (const child of node.children) walk(child);
  };
  for (const child of root.children) walk(child);

  const products: THREE.Mesh[] = [];
  const sources: FrozenSource[] = [];
  const sourceRecords = new Map<THREE.Mesh, FrozenSource>();
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const relative = new THREE.Matrix4();
  let drawsBefore = 0;

  const adopt = (product: THREE.Mesh, members: Candidate[], label: string): void => {
    product.name = `${name} · ${label}`;
    product.castShadow = members[0]?.mesh.castShadow ?? false;
    product.receiveShadow = members[0]?.mesh.receiveShadow ?? false;
    product.layers.mask = members[0]?.mesh.layers.mask ?? 1;
    product.matrixAutoUpdate = false;
    product.userData[FROZEN_PRODUCT_KEY] = true;
    // A product is MACHINERY, not content: the hierarchy's job is to show the scenery the author
    // wrote, and the originals are still there under their own names to be selected and inspected.
    // Without this mark a freeze that collapsed 800 panels into two draws would ADD two rows to the
    // panel it was supposed to make cheaper — `hierarchy-marks` names this exact case ("the
    // instanced-mesh pools behind a tile field").
    markBuiltInternal(product);
    root.add(product);
    products.push(product);
    for (const member of members) {
      drawsBefore += 1;
      if (!sourceRecords.has(member.mesh)) {
        const source = { mesh: member.mesh, wasVisible: member.mesh.visible };
        sourceRecords.set(member.mesh, source);
        sources.push(source);
      }
      member.mesh.visible = false;
    }
  };

  const transferGeometry = (geometry: THREE.BufferGeometry): void => {
    temporaryGeometries.delete(geometry);
    ownedGeometries.add(geometry);
  };

  const disposeCandidateGeometry = (candidate: Candidate): void => {
    if (!candidate.ownsGeometry || !temporaryGeometries.delete(candidate.geometry)) return;
    candidate.geometry.dispose();
  };

  const adoptSingleton = (member: Candidate): void => {
    const geometry = member.geometry;
    relative.multiplyMatrices(toLocal, member.mesh.matrixWorld);
    geometry.applyMatrix4(relative);
    geometry.computeBoundingSphere();
    transferGeometry(geometry);
    adopt(new THREE.Mesh(geometry, member.material), [member], `group ${productNo++}`);
  };

  let productNo = 0;
  for (const members of groups.values()) {
    if (members.length < 2) {
      const member = members[0];
      if (member?.requiresReplacement) adoptSingleton(member);
      continue; // one ordinary mesh is already one draw
    }

    // Same material AND same geometry → instancing, which keeps ONE copy of
    // the vertices on the GPU. Different geometries under the same material
    // have nothing to share but the shader, so they merge.
    const byGeometry = new Map<string, Candidate[]>();
    for (const member of members) {
      const bucket = byGeometry.get(member.geometryKey);
      if (bucket) bucket.push(member);
      else byGeometry.set(member.geometryKey, [member]);
    }

    const heterogeneous: Candidate[] = [];
    for (const bucket of byGeometry.values()) {
      if (bucket.length < 2) {
        heterogeneous.push(...bucket);
        continue;
      }
      const prototype = bucket[0] as Candidate;
      const instanced = new THREE.InstancedMesh(
        prototype.geometry,
        prototype.material,
        bucket.length,
      );
      bucket.forEach((member, index) => {
        relative.multiplyMatrices(toLocal, member.mesh.matrixWorld);
        instanced.setMatrixAt(index, relative);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingSphere();
      if (prototype.ownsGeometry) transferGeometry(prototype.geometry);
      for (const member of bucket.slice(1)) disposeCandidateGeometry(member);
      adopt(instanced, bucket, `instanced ${productNo++}`);
    }

    // The leftovers merge, but only WITHIN one attribute layout.
    // `mergeGeometries` answers `null` for a batch whose members disagree
    // about attributes, and one such member in the pile would take the whole
    // merge down with it — a wrapper that batched nothing because one panel
    // carried a second UV set is the silent failure this splits apart.
    const byLayout = new Map<string, Candidate[]>();
    for (const member of heterogeneous) {
      const bucket = byLayout.get(member.layoutKey);
      if (bucket) bucket.push(member);
      else byLayout.set(member.layoutKey, [member]);
    }

    for (const bucket of byLayout.values()) {
      if (bucket.length < 2) {
        const member = bucket[0];
        if (member?.requiresReplacement) adoptSingleton(member);
        continue; // an ordinary lone leftover is already one draw
      }
      const parts = bucket.map((member) => {
        const geometry = member.geometry.clone();
        relative.multiplyMatrices(toLocal, member.mesh.matrixWorld);
        geometry.applyMatrix4(relative);
        return geometry;
      });
      const merged = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      // Still `null`? Then they were incompatible for a reason the layout
      // signature does not see. Ordinary sources stay untouched; group
      // candidates fall back to one replacement apiece so hiding their source
      // can never make pixels disappear.
      if (!merged) {
        for (const member of bucket) {
          if (member.requiresReplacement) adoptSingleton(member);
        }
        continue;
      }
      merged.computeBoundingSphere();
      ownedGeometries.add(merged);
      for (const member of bucket) disposeCandidateGeometry(member);
      adopt(
        new THREE.Mesh(merged, (bucket[0] as Candidate).material),
        bucket,
        `merged ${productNo++}`,
      );
    }
  }

  // Defensive ownership closure: every extracted group is either a product's
  // geometry, consumed by a merge, or disposed here. No refused/failed path
  // may strand GPU buffers.
  for (const geometry of temporaryGeometries) geometry.dispose();
  temporaryGeometries.clear();

  return {
    name,
    root,
    products,
    ownedGeometries: [...ownedGeometries],
    sources,
    drawsBefore,
    drawsAfter: products.length,
    skipped,
    skippedExample,
  };
}

/** Idempotency without mutating the handle: the batch is a record of what
 *  happened, and a record that empties itself cannot be inspected afterwards. */
const alreadyRestored = new WeakSet<FrozenBatch>();

/**
 * Undo a freeze: every original visible again exactly as the game left it,
 * every product removed and its merged geometry disposed. Idempotent — the
 * second call finds nothing to do.
 *
 * Only geometries this freeze CREATED are disposed. An ordinary instanced
 * product borrows the prototype's source geometry; a group-instanced product
 * owns its extracted geometry and lists it in `ownedGeometries`. Every product
 * borrows its material from the live component tree.
 */
export function restoreFrozen(batch: FrozenBatch): void {
  if (alreadyRestored.has(batch)) return;
  alreadyRestored.add(batch);
  for (const source of batch.sources) source.mesh.visible = source.wasVisible;
  for (const product of batch.products) {
    batch.root.remove(product);
    const instanced = product as THREE.InstancedMesh;
    // `InstancedMesh.dispose()` releases the instance buffers only. Geometry
    // ownership is handled uniformly by the batch record below.
    if (instanced.isInstancedMesh) instanced.dispose();
  }
  for (const geometry of batch.ownedGeometries) geometry.dispose();
}

/**
 * The console line for a freeze that had to refuse members, or `null` when it
 * refused nothing.
 *
 * Refusals are aggregated into ONE line per wrapper rather than one per mesh:
 * a subtree of 800 transparent panels would otherwise produce 800 warnings and
 * teach the reader to mute the channel. An OPTED-OUT member is never in the
 * count — it is a declaration, not a surprise, and warning about it would
 * punish exactly the discipline this asks for.
 */
export function describeFrozenSkips(batch: FrozenBatch): string | null {
  const reasons = (Object.keys(batch.skipped) as FrozenSkipReason[])
    .filter((reason) => reason !== 'opted-out')
    .sort((a, b) => (batch.skipped[b] ?? 0) - (batch.skipped[a] ?? 0));
  if (reasons.length === 0) return null;
  const total = reasons.reduce((sum, reason) => sum + (batch.skipped[reason] ?? 0), 0);
  const detail = reasons
    .map((reason) => `${batch.skipped[reason]} ${reason} (e.g. ${batch.skippedExample[reason]})`)
    .join(', ');
  return (
    `[static-batch] <Frozen name="${batch.name}"> left ${total} mesh(es) unbatched: ${detail}. ` +
    'They still render — each is simply its own draw. Move them out of the wrapper, or declare ' +
    'the exclusion where it is deliberate: userData={{ staticBatch: false }}.'
  );
}
