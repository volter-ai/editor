/**
 * The module→Object3D step, shared by every tool that turns a project TS
 * module's exported builder into a live `THREE.Object3D`.
 *
 * EXTRACTED VERBATIM from `src/tools/bake-module.tool.ts` (the typed error
 * definitions, `resolveProjectModule`, `buildFromModule` and
 * `computeMeshStats` were private there) when `project.bake.preview` needed
 * the identical front half without the bake. Nothing about the behavior
 * changed: the same path-escape guard, the same import, the same typed error
 * codes. One copy, because "the same module, refused for a different reason
 * depending on which verb you called" is the failure this prevents.
 *
 * It lives beside the tools rather than under `src/lib/bake/` because it is
 * NODE-ONLY (`node:fs/promises`, `node:url`, a dynamic `import()` of project
 * source). A project's own `tsconfig.json` compiles `src` for the browser and
 * excludes `src/tools` precisely so tool code can reach for Node; a helper
 * this shape under `src/lib/` reds every shipped project's typecheck.
 */

import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ToolError, type ToolErrorDefinition } from '@vgai/sdk/tools';
import * as THREE from 'three';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Typed error codes — every real failure mode of `buildFromModule` /
// `resolveProjectModule`, mirroring the `ToolErrorDefinition` + `ToolError`
// pattern the SDK's own `project.*` operations use (e.g.
// `PATH_OUTSIDE_PROJECT_ERROR` in `@vgai/sdk`'s `project/shared.ts`).
// ---------------------------------------------------------------------------

export const MODULE_NOT_FOUND_ERROR: ToolErrorDefinition = {
  code: 'MODULE_NOT_FOUND',
  summary: 'The TypeScript module at modulePath does not exist, or failed to import.',
  data: z.object({ modulePath: z.string(), reason: z.string() }),
};

export const EXPORT_NOT_CALLABLE_ERROR: ToolErrorDefinition = {
  code: 'EXPORT_NOT_CALLABLE',
  summary: "The named export is missing from the module, or isn't a function.",
  data: z.object({
    modulePath: z.string(),
    exportName: z.string(),
    available: z.array(z.string()),
  }),
};

export const NOT_AN_OBJECT3D_ERROR: ToolErrorDefinition = {
  code: 'NOT_AN_OBJECT3D',
  summary: 'The export ran but did not return a THREE.Object3D or a THREE.BufferGeometry.',
  data: z.object({ modulePath: z.string(), exportName: z.string(), returnedType: z.string() }),
};

export const EMPTY_GEOMETRY_ERROR: ToolErrorDefinition = {
  code: 'EMPTY_GEOMETRY',
  summary: 'The built Object3D has zero vertices or triangles — nothing renderable to bake.',
  data: z.object({ modulePath: z.string(), exportName: z.string() }),
};

export const PATH_ESCAPES_PROJECT_ERROR: ToolErrorDefinition = {
  code: 'PATH_ESCAPES_PROJECT',
  summary: 'modulePath resolves outside the project root (e.g. via "..").',
  data: z.object({ projectRoot: z.string(), modulePath: z.string() }),
};

/** Resolve `modulePath` to an absolute path that stays inside the project root (no `..` escape). */
export async function resolveProjectModule(
  projectRoot: string,
  modulePath: string,
): Promise<string> {
  const relativePath = modulePath.replace(/^\//, '');
  const projectRootReal = await realpath(projectRoot);
  const lexicalCandidate = resolve(projectRootReal, relativePath);
  if (
    lexicalCandidate !== projectRootReal &&
    !lexicalCandidate.startsWith(`${projectRootReal}${sep}`)
  ) {
    throw new ToolError(
      PATH_ESCAPES_PROJECT_ERROR.code,
      `modulePath must resolve inside the project: ${modulePath}`,
      { projectRoot: projectRootReal, modulePath },
    );
  }
  let candidate: string;
  try {
    candidate = await realpath(lexicalCandidate);
  } catch (error) {
    throw new ToolError(
      MODULE_NOT_FOUND_ERROR.code,
      `module '${modulePath}' does not exist in the project.`,
      { modulePath, reason: error instanceof Error ? error.message : String(error) },
    );
  }
  if (candidate !== projectRootReal && !candidate.startsWith(`${projectRootReal}${sep}`)) {
    throw new ToolError(
      PATH_ESCAPES_PROJECT_ERROR.code,
      `modulePath must resolve inside the project: ${modulePath}`,
      { projectRoot: projectRootReal, modulePath },
    );
  }
  return candidate;
}

/**
 * THE TWO SHAPES A MODULE EXPORT MAY RETURN, normalized to one.
 *
 * 1. A bare `THREE.Object3D` — the original contract, and still the whole of
 *    it for a builder with nothing to tear down.
 * 2. A BUILD RESULT `{ root, animations?, dispose? }` — the shape every
 *    parametric lib in the kit already returns (`createBird`'s `BirdBuild`,
 *    `createHumanoid`'s, and the fox/cub/winter generators a cold agent wrote
 *    from them). It is not a new convention invented here: `bakeObject3DSource`
 *    has always taken exactly `{ root, animations, dispose }` from its `build`
 *    callback, so the bake lane consumed this shape while the MODULE lane —
 *    `project.bake.module`, `project.bake.preview`, `vgai screenshot <module>`
 *    — refused it. Measured (cold fox, 2026-08-29): `vgai screenshot
 *    src/lib/fox/generate.ts` died with "export 'createFox' must return a
 *    THREE.Object3D, got object", closing the fast look door to every
 *    parametric lib including the kit's own worked examples.
 *
 * ANIMATIONS RIDE ON `root.animations`, always. That is three's own carrier —
 * where `GLTFLoader` puts clips, what `Object3D.copy` carries across a clone,
 * what `useAnimations(scene.animations)` reads — so a build result's separate
 * `animations` list is written onto the root here and every downstream reader
 * (the GLB writer, the preview exporter, the Asset Lab's transport) keeps
 * working unchanged. A root that already carries clips is left alone.
 */
export interface ModuleBuild {
  readonly root: THREE.Object3D;
  /** The builder's OWN teardown, when it returned one. The caller runs it
   *  instead of a generic graph dispose: a rig holds mixers, actions and
   *  materials a `traverse` walk does not know about. */
  readonly dispose?: () => void;
}

/** Normalize any accepted shape, or `undefined` when it is none of them. */
function asModuleBuild(built: unknown): ModuleBuild | undefined {
  if (!built || typeof built !== 'object') return undefined;
  if ((built as THREE.Object3D).isObject3D === true) return { root: built as THREE.Object3D };
  // 3. A MODEL MODULE — `build(): THREE.BufferGeometry` (`lib/mesh/geometry`).
  //    Geometry has no material; the lane photographs and bakes it under a
  //    neutral standard material, named for the export.
  if ((built as THREE.BufferGeometry).isBufferGeometry === true) {
    return {
      root: new THREE.Mesh(built as THREE.BufferGeometry, new THREE.MeshStandardMaterial()),
    };
  }
  const result = built as { root?: unknown; animations?: unknown; dispose?: unknown };
  const root = result.root as THREE.Object3D | undefined;
  if (!root || typeof root !== 'object' || root.isObject3D !== true) return undefined;
  if (Array.isArray(result.animations) && root.animations.length === 0) {
    root.animations = result.animations as THREE.AnimationClip[];
  }
  return {
    root,
    ...(typeof result.dispose === 'function'
      ? { dispose: () => (result.dispose as () => void).call(built) }
      : {}),
  };
}

/**
 * Import the project module and call its named export, matching the turntable `?module=&export=` contract.
 *
 * `loadModule` is the HOST's loader (`ctx.loadProjectModule`: the editor
 * server's Vite SSR loader, which re-transforms a module — and everything it
 * imports — when any file in that graph changes). Prefer it whenever the
 * caller has one. The raw `import()` fallback is for a tool running outside an
 * editor server, and it is a ONE-SHOT door: Node's ESM cache keys on the URL
 * and never invalidates, so inside a long-lived server it returned the first
 * version of `src/models/barrel.ts` for every later look until the server was
 * restarted (the blind modeling bench measured three `vgai restart`s in one
 * barrel, 2026-09-05).
 */
export async function buildFromModule(
  projectRoot: string,
  modulePath: string,
  exportName: string,
  loadModule?: (absolutePath: string) => Promise<unknown>,
): Promise<ModuleBuild> {
  const absolute = await resolveProjectModule(projectRoot, modulePath);
  let mod: Record<string, unknown>;
  try {
    mod = (
      loadModule
        ? await loadModule(absolute)
        : await import(/* @vite-ignore */ pathToFileURL(absolute).href)
    ) as Record<string, unknown>;
  } catch (error) {
    throw new ToolError(
      MODULE_NOT_FOUND_ERROR.code,
      `module '${modulePath}' failed to import: ${error instanceof Error ? error.message : String(error)}`,
      { modulePath, reason: error instanceof Error ? error.message : String(error) },
    );
  }
  // A MODEL MODULE's builder is `build` (`lib/mesh/geometry`'s contract), so a
  // caller asking for the default export of a module that has none but has
  // `build` gets the model — `vgai screenshot src/models/cube.ts` needs no flag.
  const exp = mod[exportName] ?? (exportName === 'default' ? mod['build'] : undefined);
  if (exp === undefined) {
    throw new ToolError(
      EXPORT_NOT_CALLABLE_ERROR.code,
      `module '${modulePath}' has no export '${exportName}' (exports: ${Object.keys(mod).join(', ')})`,
      { modulePath, exportName, available: Object.keys(mod) },
    );
  }
  if (typeof exp !== 'function') {
    throw new ToolError(
      EXPORT_NOT_CALLABLE_ERROR.code,
      `module '${modulePath}' export '${exportName}' must be a function returning a THREE.Object3D or THREE.BufferGeometry.`,
      { modulePath, exportName, available: Object.keys(mod) },
    );
  }
  const built = (await exp()) as unknown;
  const build = asModuleBuild(built);
  if (!build) {
    throw new ToolError(
      NOT_AN_OBJECT3D_ERROR.code,
      `module '${modulePath}' export '${exportName}' must return a THREE.BufferGeometry (a model ` +
        'module), a THREE.Object3D, or a build result `{ root, animations?, dispose? }` whose ' +
        "`root` is one (the kit's parametric libs — createBird, createHumanoid — return that " +
        `shape). Got ${describeReturn(built)}.`,
      { modulePath, exportName, returnedType: typeof built },
    );
  }
  return build;
}

/** What the export actually returned, for the refusal above — `object` alone
 *  cannot tell a build result with a mistyped key from an unrelated value. */
function describeReturn(built: unknown): string {
  if (built === null) return 'null';
  if (typeof built !== 'object') return typeof built;
  if (Array.isArray(built)) return 'an array';
  const keys = Object.keys(built);
  return keys.length > 0
    ? `an object with keys ${keys.slice(0, 8).join(', ')}`
    : 'an object with no own keys';
}

export function computeMeshStats(root: THREE.Object3D): {
  vertexCount: number;
  triangleCount: number;
  /** See {@link countInvertedTriangles}. */
  invertedTriangleCount: number;
  /** Edges with exactly one triangle on them after welding by position —
   *  a hole, an unclosed cap, or a part that was never joined. See
   *  {@link countInvertedTriangles}, which measures both in one pass. */
  boundaryEdgeCount: number;
  /** World-space midpoints of up to six of those edges. */
  boundaryEdgeSamples: [number, number, number][];
  /** Vertices whose position is NaN or infinite. Three.js reports these as
   *  "computeBoundingBox(): Computed min/max have NaN values" on the console,
   *  naming no op and no line — a blind session spent five minutes with its
   *  own probe script finding where (2026-09-06). The look names the count. */
  nonFiniteVertexCount: number;
} {
  let vertexCount = 0;
  let triangleCount = 0;
  let invertedTriangleCount = 0;
  let boundaryEdgeCount = 0;
  let nonFiniteVertexCount = 0;
  const boundaryEdgeSamples: [number, number, number][] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    vertexCount += position?.count ?? 0;
    if (position) {
      for (let i = 0; i < position.count; i += 1) {
        if (
          !Number.isFinite(position.getX(i)) ||
          !Number.isFinite(position.getY(i)) ||
          !Number.isFinite(position.getZ(i))
        ) {
          nonFiniteVertexCount += 1;
        }
      }
    }
    triangleCount += index ? index.count / 3 : (position?.count ?? 0) / 3;
    const winding = countInvertedTriangles(mesh.geometry);
    invertedTriangleCount += winding.inverted;
    boundaryEdgeCount += winding.boundaryEdges;
    // World space, as the brief's numbers are: the mesh's own transform applied.
    mesh.updateWorldMatrix(true, false);
    for (const [x, y, z] of winding.boundaryEdgeSamples) {
      if (boundaryEdgeSamples.length >= 6) break;
      const p = new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld);
      boundaryEdgeSamples.push([p.x, p.y, p.z]);
    }
  });
  return {
    vertexCount,
    triangleCount,
    invertedTriangleCount,
    boundaryEdgeCount,
    boundaryEdgeSamples,
    nonFiniteVertexCount,
  };
}

/**
 * Triangles that FACE INWARD — the two ways a mesh gets there, counted the way
 * Blender's Face Orientation overlay would paint them red:
 *
 * 1. an inside-out CLOSED SHELL (every edge shared by exactly two triangles)
 *    — its signed volume is negative, so every triangle in it is inverted.
 *    A shell that is consistently wound the wrong way has no local tell at
 *    all: every neighbour agrees with it, and only its volume says which side
 *    is out (`bmesh.ops.recalc_face_normals` decides the same way);
 * 2. NON-CONTIGUOUS pairs — two triangles traversing a shared edge in the
 *    same direction, so their normals disagree (what the kit's `validate()`
 *    reports as `inconsistentWinding`). Both are counted; the count is a
 *    "how much is wrong" number, not a repair plan.
 *
 * Why the look verb needs this: the editor's model stage lights both sides,
 * so a shell that is 60 % inverted photographs as a clean solid — the blind
 * modeling bench shipped exactly that (a barrel whose 12 staves were built
 * inside out, 432 of 720 triangles, reported "all features verified") while
 * Blender rendered the same GLB dark. A picture that cannot show the defect
 * has to SAY it.
 *
 * Vertices are welded by position (1e-5) first, so the flat-shaded, per-face
 * vertex layout the mesh kit exports still resolves to shared edges.
 */
export function countInvertedTriangles(geometry: THREE.BufferGeometry): {
  inverted: number;
  boundaryEdges: number;
  /** Midpoints of the first few open edges, so a count becomes a place —
   *  four blind sessions accepted "2 open edges" because nothing said where. */
  boundaryEdgeSamples: [number, number, number][];
} {
  const position = geometry.getAttribute('position');
  if (!position) return { inverted: 0, boundaryEdges: 0, boundaryEdgeSamples: [] };
  const index = geometry.getIndex();
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  if (triCount === 0) return { inverted: 0, boundaryEdges: 0, boundaryEdgeSamples: [] };
  const keyOf = new Map<string, number>();
  const welded = new Int32Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    // Integer keys: `(-0).toFixed(5)` is "-0.00000" and never welds with
    // "0.00000", which split every seam that landed on an axis and reported
    // it as open edges (a barrel's head cylinders, blind bench 2026-09-06).
    const key = `${Math.round(position.getX(i) * 1e5) || 0},${Math.round(position.getY(i) * 1e5) || 0},${Math.round(position.getZ(i) * 1e5) || 0}`;
    let id = keyOf.get(key);
    if (id === undefined) {
      id = keyOf.size;
      keyOf.set(key, id);
    }
    welded[i] = id;
  }
  const corner = (tri: number, k: number): number => {
    const raw = index ? index.getX(tri * 3 + k) : tri * 3 + k;
    return welded[raw] ?? 0;
  };
  // Union-find over welded vertices → connected shells.
  const parent = new Int32Array(keyOf.size);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[a] !== r) {
      const next = parent[a] as number;
      parent[a] = r;
      a = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const directed = new Map<string, number>();
  const undirected = new Map<string, number>();
  const tris: Array<[number, number, number]> = [];
  for (let t = 0; t < triCount; t += 1) {
    const a = corner(t, 0);
    const b = corner(t, 1);
    const c = corner(t, 2);
    if (a === b || b === c || c === a) continue; // degenerate: no edge to disagree over
    tris.push([a, b, c]);
    union(a, b);
    union(b, c);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const d = `${u}>${v}`;
      directed.set(d, (directed.get(d) ?? 0) + 1);
      const un = u < v ? `${u}-${v}` : `${v}-${u}`;
      undirected.set(un, (undirected.get(un) ?? 0) + 1);
    }
  }
  // Per shell: closed? signed volume.
  const closed = new Map<number, boolean>();
  const volume = new Map<number, number>();
  for (const [a, b, c] of tris) {
    const shell = find(a);
    if (!closed.has(shell)) closed.set(shell, true);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const un = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (undirected.get(un) !== 2) closed.set(shell, false);
    }
  }
  // Signed volume needs coordinates: read one representative position per welded id.
  const rep = new Float64Array(keyOf.size * 3);
  const seen = new Uint8Array(keyOf.size);
  for (let i = 0; i < position.count; i += 1) {
    const id = welded[i] as number;
    if (seen[id]) continue;
    seen[id] = 1;
    rep[id * 3] = position.getX(i);
    rep[id * 3 + 1] = position.getY(i);
    rep[id * 3 + 2] = position.getZ(i);
  }
  for (const [a, b, c] of tris) {
    const shell = find(a);
    const ax = rep[a * 3] as number;
    const ay = rep[a * 3 + 1] as number;
    const az = rep[a * 3 + 2] as number;
    const bx = rep[b * 3] as number;
    const by = rep[b * 3 + 1] as number;
    const bz = rep[b * 3 + 2] as number;
    const cx = rep[c * 3] as number;
    const cy = rep[c * 3 + 1] as number;
    const cz = rep[c * 3 + 2] as number;
    // a · (b × c) / 6
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    volume.set(shell, (volume.get(shell) ?? 0) + v);
  }
  let boundaryEdges = 0;
  const boundaryEdgeSamples: [number, number, number][] = [];
  for (const [edge, count] of undirected) {
    if (count !== 1) continue;
    boundaryEdges += 1;
    if (boundaryEdgeSamples.length >= 6) continue;
    const [u, v] = edge.split('-').map(Number) as [number, number];
    boundaryEdgeSamples.push([
      ((rep[u * 3] as number) + (rep[v * 3] as number)) / 2,
      ((rep[u * 3 + 1] as number) + (rep[v * 3 + 1] as number)) / 2,
      ((rep[u * 3 + 2] as number) + (rep[v * 3 + 2] as number)) / 2,
    ]);
  }
  let inverted = 0;
  for (const [a, b, c] of tris) {
    const shell = find(a);
    if (closed.get(shell) && (volume.get(shell) ?? 0) < 0) {
      inverted += 1;
      continue;
    }
    // Non-contiguous only means something on a MANIFOLD edge (exactly two
    // triangles). Two separate closed solids that touch along a knife edge
    // — a barrel's staves at the groove apex, a lantern's collar on its roof
    // — share that edge four ways after welding, every direction twice, and
    // both solids are wound perfectly well. Two blind-bench sessions each
    // spent several looks chasing that report before this line existed.
    const manifold = (u: number, v: number) =>
      undirected.get(u < v ? `${u}-${v}` : `${v}-${u}`) === 2;
    if (
      (manifold(a, b) && (directed.get(`${a}>${b}`) ?? 0) > 1) ||
      (manifold(b, c) && (directed.get(`${b}>${c}`) ?? 0) > 1) ||
      (manifold(c, a) && (directed.get(`${c}>${a}`) ?? 0) > 1)
    ) {
      inverted += 1;
    }
  }
  return { inverted, boundaryEdges, boundaryEdgeSamples };
}

/** Every mesh in the built graph, for the mesh-count facts both verbs report. */
export function countMeshes(root: THREE.Object3D): number {
  let meshCount = 0;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshCount += 1;
  });
  return meshCount;
}

/** The shared "did the builder produce anything renderable?" gate. */
export function assertRenderableGeometry(
  stats: { vertexCount: number; triangleCount: number },
  modulePath: string,
  exportName: string,
): void {
  if (stats.vertexCount > 0 && stats.triangleCount > 0) return;
  throw new ToolError(
    EMPTY_GEOMETRY_ERROR.code,
    `module '${modulePath}' export '${exportName}' produced an Object3D with no ` +
      'renderable geometry.',
    { modulePath, exportName },
  );
}
