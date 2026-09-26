/**
 * THE ADDRESS BOOK behind the render vitals (`dev/render-vitals.ts`): which
 * subtree owns the draw calls, and which meshes are identical enough to
 * instance. A draw-call count with no address is a symptom you cannot act on.
 *
 * Pure functions over a live `THREE.Object3D` — no renderer, no profiler, no
 * game. They are what the `render.census` / `render.families` debug commands
 * run; keeping them here (rather than inline in the adapter) is what lets a
 * headless test build a scene by hand and check the arithmetic.
 *
 * ── WHAT "VISIBLE" MEANS HERE, AND WHY IT IS A WALK ─────────────────────────
 * Visibility in three is HIERARCHICAL: a hidden parent hides its whole
 * subtree, and `Object3D.traverse` cannot prune. So these walk manually and
 * stop descending at an invisible node. That is not a detail — `render.toggle`
 * works by hiding a PARENT, and a census that kept counting the children under
 * it would report that nothing changed.
 *
 * ── TWO FAMILY SCANS, AND WHY BOTH ──────────────────────────────────────────
 * {@link meshFamilies} keys on object IDENTITY: meshes sharing one geometry
 * instance and one material instance (`uuid`) — exactly the precondition for
 * collapsing them into a bare `InstancedMesh` as they stand. It deliberately
 * does not compare material PARAMETERS.
 *
 * {@link structuralBatchScan} keys on STRUCTURE (`render/structural-
 * signature.ts`): meshes that are the same DRAW, however many distinct
 * material objects describe it. A project that writes a material per mesh —
 * which is what inline `<meshStandardMaterial>` in a TSX world does, i.e. what
 * every fresh scaffold does — reads as all families-of-one under the first
 * scan and as one big collapsible family under the second. Both readings are
 * true; they answer different questions, and only the second one routes an
 * author to the fix (`dev/static-batch-advisor.ts`).
 *
 * Nothing here assumes a project interns its materials or that its world is
 * static — the STATIC half is a claim only the author can make, which is why
 * the advisory asks rather than acts.
 */

import {
  materialMergeSignature,
  staticBatchSkipReason,
} from '@volter/threejs-runtime/render/structural-signature';
import type * as THREE from 'three';

/** How many rows a census/family report carries. A shortlist is actionable;
 *  a full dump through a JSON relay is a wall of text nobody reads. */
export const CENSUS_ROW_LIMIT = 40;
export const FAMILY_ROW_LIMIT = 30;

interface MeshLike {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  count?: number;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
}

function asMesh(node: THREE.Object3D): (MeshLike & THREE.Object3D) | null {
  const mesh = node as THREE.Object3D & MeshLike;
  return mesh.isMesh || mesh.isSkinnedMesh ? mesh : null;
}

/** Triangles one mesh submits: its geometry's own count times its instance
 *  count. Non-indexed geometry falls back to the position attribute; a
 *  geometry with neither contributes 0 rather than a guess. */
function triangleCount(mesh: MeshLike): number {
  const geometry = mesh.geometry;
  if (!geometry) return 0;
  const index = geometry.getIndex?.() ?? null;
  const position = geometry.getAttribute?.('position') ?? null;
  const vertices = index ? index.count : (position?.count ?? 0);
  const instances = mesh.isInstancedMesh ? (mesh.count ?? 1) : 1;
  return Math.round(vertices / 3) * instances;
}

/** Walk `node` and its visible descendants, calling `visit` for every visible
 *  mesh. Stops at an invisible node — see the module note. */
function walkVisibleMeshes(
  node: THREE.Object3D,
  visit: (mesh: MeshLike & THREE.Object3D) => void,
): void {
  if (!node.visible) return;
  const mesh = asMesh(node);
  if (mesh) visit(mesh);
  for (const child of node.children) walkVisibleMeshes(child, visit);
}

/** One addressable subtree's share of the frame. */
export interface CensusRow {
  /** The node's own name, or a stable placeholder — this is the string
   *  `render.census`/`render.toggle` take as their drill-down argument, so an
   *  unnamed node is honestly reported as unaddressable rather than given an
   *  invented name that would not resolve. */
  readonly name: string;
  readonly meshes: number;
  readonly triangles: number;
}

export interface CensusReport {
  /** The subtree this census covers (`'(scene)'` for the whole world). */
  readonly root: string;
  readonly totalMeshes: number;
  readonly totalTriangles: number;
  /** How many rows exist in total, so a truncated report says so out loud
   *  instead of reading as complete. */
  readonly subtreeCount: number;
  /** Heaviest first, capped at {@link CENSUS_ROW_LIMIT}. */
  readonly subtrees: readonly CensusRow[];
}

const UNNAMED = '(unnamed)';

/**
 * Tally visible meshes and triangles per direct child of `root`. Pure.
 *
 * One level, deliberately: the report is a set of addresses to drill into
 * with the same command, and a recursive dump is not something you can act on
 * one step at a time. `root` itself contributes its own meshes under its own
 * name when it has any.
 */
export function sceneCensus(root: THREE.Object3D, rootLabel = '(scene)'): CensusReport {
  const rows = new Map<string, { meshes: number; triangles: number }>();
  let totalMeshes = 0;
  let totalTriangles = 0;

  if (!root.visible) {
    return { root: rootLabel, totalMeshes: 0, totalTriangles: 0, subtreeCount: 0, subtrees: [] };
  }

  const tally = (key: string, node: THREE.Object3D): void => {
    walkVisibleMeshes(node, (mesh) => {
      const triangles = triangleCount(mesh);
      const row = rows.get(key) ?? { meshes: 0, triangles: 0 };
      row.meshes += 1;
      row.triangles += triangles;
      rows.set(key, row);
      totalMeshes += 1;
      totalTriangles += triangles;
    });
  };

  // `root`'s own mesh, if it is one, is charged to `root` — not silently
  // dropped because the grouping key is "direct child".
  const selfMesh = asMesh(root);
  if (selfMesh) {
    const triangles = triangleCount(selfMesh);
    rows.set(root.name || rootLabel, { meshes: 1, triangles });
    totalMeshes += 1;
    totalTriangles += triangles;
  }
  for (const child of root.children) tally(child.name || UNNAMED, child);

  const sorted = [...rows.entries()]
    .map(([name, row]) => ({ name, meshes: row.meshes, triangles: row.triangles }))
    .sort((a, b) => b.triangles - a.triangles || b.meshes - a.meshes);

  return {
    root: rootLabel,
    totalMeshes,
    totalTriangles,
    subtreeCount: sorted.length,
    subtrees: sorted.slice(0, CENSUS_ROW_LIMIT),
  };
}

/** First node named `name` in `root`'s subtree, or `null`. Depth-first, so the
 *  shallowest match under an ordinary hierarchy wins. */
export function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  if (root.name === name) return root;
  for (const child of root.children) {
    const hit = findByName(child, name);
    if (hit) return hit;
  }
  return null;
}

/** One (geometry, material) identity and how many meshes share it. */
export interface FamilyRow {
  /** How many meshes share this identity — the instancing win, minus one. */
  readonly meshes: number;
  /** Triangles ONE member submits. */
  readonly triangles: number;
  /** A representative address (`parent/child`), so the row is findable. */
  readonly example: string;
}

export interface FamilyReport {
  /** Visible, non-instanced meshes considered. `InstancedMesh`es are excluded:
   *  they are already the thing this report recommends becoming. */
  readonly plainMeshes: number;
  readonly familyCount: number;
  /** Largest first, capped at {@link FAMILY_ROW_LIMIT}. */
  readonly top: readonly FamilyRow[];
  /** How many of {@link plainMeshes} the reported rows cover — the honest
   *  headroom figure, so a long tail is not mistaken for a short one. */
  readonly meshesInTop: number;
}

/** Group visible non-instanced meshes by (geometry, material) identity. Pure.
 *  See the module note for what identity does and does not assume. */
export function meshFamilies(root: THREE.Object3D): FamilyReport {
  const families = new Map<string, { meshes: number; triangles: number; example: string }>();
  let plainMeshes = 0;

  walkVisibleMeshes(root, (mesh) => {
    if (mesh.isInstancedMesh) return;
    const geometry = mesh.geometry;
    if (!geometry) return;
    const material = mesh.material;
    const materialKey = Array.isArray(material)
      ? material.map((entry) => entry.uuid).join('+')
      : (material?.uuid ?? 'none');
    const key = `${geometry.uuid}/${materialKey}`;
    plainMeshes += 1;
    const existing = families.get(key);
    if (existing) {
      existing.meshes += 1;
      return;
    }
    families.set(key, {
      meshes: 1,
      triangles: triangleCount(mesh),
      example: `${mesh.parent?.name || UNNAMED}/${mesh.name || UNNAMED}`,
    });
  });

  const sorted = [...families.values()].sort((a, b) => b.meshes - a.meshes);
  const top = sorted.slice(0, FAMILY_ROW_LIMIT);
  return {
    plainMeshes,
    familyCount: sorted.length,
    top,
    meshesInTop: top.reduce((total, row) => total + row.meshes, 0),
  };
}

/** One top-level subtree's share of the collapsible meshes — the ADDRESS the
 *  advisory names, so the fix is a wrapper someone can actually place. */
export interface StructuralSubtreeRow {
  readonly name: string;
  readonly collapsible: number;
}

/** What {@link structuralBatchScan} answers with. A {@link FamilyReport} whose
 *  families are keyed by STRUCTURE, plus the two figures the advisory needs. */
export interface StructuralBatchReport extends FamilyReport {
  /** Meshes sitting in a family of two or more — what would collapse. The
   *  saving is a little less than this (each family leaves one product
   *  behind), which is why the advisory says "~". */
  readonly collapsible: number;
  /** Meshes the batcher would REFUSE, by reason — the honest other half. A
   *  scene of 4,000 transparent quads has no draw-call diet available, and a
   *  scan that reported only the upside would send an author to a wrapper
   *  that declines every member. */
  readonly skipped: Readonly<Record<string, number>>;
  /** Collapsible meshes per direct child of the scanned root, largest first. */
  readonly bySubtree: readonly StructuralSubtreeRow[];
}

/**
 * Group visible meshes by STRUCTURAL identity — the same key the batchers use
 * (`render/structural-signature.ts`), so this measures what `<Frozen>` would
 * actually do rather than what a uuid comparison can see.
 *
 * This is the companion to {@link meshFamilies}, not a replacement, and the
 * difference between the two is the finding: `meshFamilies` asks "which meshes
 * SHARE a geometry and material object", which is what a bare `InstancedMesh`
 * needs; this asks "which meshes are the same draw", which is what a merging
 * batcher needs. On a freshly scaffolded world writing inline materials the
 * first reports families of one and the second reports the win — see the uuid
 * trap in `render/structural-signature.ts`.
 *
 * Pure. One walk, plus a tally.
 */
export function structuralBatchScan(root: THREE.Object3D): StructuralBatchReport {
  interface Family {
    meshes: number;
    triangles: number;
    example: string;
  }
  const families = new Map<string, Family>();
  const skipped: Record<string, number> = {};
  // Which subtree each candidate sits under, kept per mesh so attribution can
  // wait until the families are known (a family of one is not collapsible, and
  // charging its member to a subtree would inflate that subtree's row).
  const members: { key: string; subtree: string }[] = [];
  let plainMeshes = 0;

  /** One node, no recursion. Answers `false` when its subtree must be pruned. */
  const visit = (node: THREE.Object3D, subtree: string): boolean => {
    if (!node.visible) return false;
    const reason = staticBatchSkipReason(node);
    if (reason === 'opted-out') {
      skipped['opted-out'] = (skipped['opted-out'] ?? 0) + 1;
      return false; // an opt-out covers its whole subtree
    }
    if (reason === null) {
      const mesh = node as THREE.Object3D & MeshLike;
      const material = mesh.material as THREE.Material;
      const key = `${materialMergeSignature(material)}|${node.castShadow ? 1 : 0}${node.receiveShadow ? 1 : 0}`;
      plainMeshes += 1;
      members.push({ key, subtree });
      const existing = families.get(key);
      if (existing) existing.meshes += 1;
      else {
        families.set(key, {
          meshes: 1,
          triangles: triangleCount(mesh),
          example: `${node.parent?.name || UNNAMED}/${node.name || UNNAMED}`,
        });
      }
    } else if (reason !== 'not-a-mesh') {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
    }
    return true;
  };

  const scan = (node: THREE.Object3D, subtree: string): void => {
    if (!visit(node, subtree)) return;
    for (const child of node.children) scan(child, subtree);
  };

  // `root`'s own mesh, if it is one, is charged to `root` — the same rule
  // `sceneCensus` uses, so the two reports address the same graph.
  if (visit(root, root.name || UNNAMED)) {
    for (const child of root.children) scan(child, child.name || UNNAMED);
  }

  const collapsibleKeys = new Set(
    [...families.entries()].filter(([, family]) => family.meshes >= 2).map(([key]) => key),
  );
  const perSubtree = new Map<string, number>();
  let collapsible = 0;
  for (const member of members) {
    if (!collapsibleKeys.has(member.key)) continue;
    collapsible += 1;
    perSubtree.set(member.subtree, (perSubtree.get(member.subtree) ?? 0) + 1);
  }

  const sorted = [...families.values()].sort((a, b) => b.meshes - a.meshes);
  const top = sorted.slice(0, FAMILY_ROW_LIMIT);
  return {
    plainMeshes,
    familyCount: sorted.length,
    top,
    meshesInTop: top.reduce((total, row) => total + row.meshes, 0),
    collapsible,
    skipped,
    bySubtree: [...perSubtree.entries()]
      .map(([name, count]) => ({ name, collapsible: count }))
      .sort((a, b) => b.collapsible - a.collapsible)
      .slice(0, CENSUS_ROW_LIMIT),
  };
}
