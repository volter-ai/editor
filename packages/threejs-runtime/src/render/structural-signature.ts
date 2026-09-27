/**
 * STRUCTURAL IDENTITY AND ELIGIBILITY for static render batching — the one
 * place that answers "may this draw be collapsed at all?" and "are these two
 * meshes the same thing drawn twice?".
 *
 * Two consumers, which is the whole reason it is a module rather than private
 * helpers: `dev/render-census.ts`'s structural scan (what the advisor and
 * `render.families` measure) and the `static-batch` capability's `<Frozen>`
 * (what a game actually installs). A batcher and the advisor that routes
 * people to it MUST agree about what is batchable, or the advisor promises a
 * win the wrapper then declines to take.
 *
 * ── THE UUID TRAP, WHICH IS WHY THIS MODULE EXISTS ──────────────────────────
 * The obvious key for "can these two meshes be drawn as one" is object
 * identity: same `geometry.uuid`, same `material.uuid`. It is also the key
 * that silently batches NOTHING in the shape that matters most. A freshly
 * scaffolded TSX/R3F world writes its materials INLINE —
 *
 *     {crates.map((c) => (
 *       <mesh key={c.id} position={c.at}>
 *         <boxGeometry args={[1, 1, 1]} />
 *         <meshStandardMaterial color="#8a6a44" />
 *       </mesh>
 *     ))}
 *
 * — and every one of those `<meshStandardMaterial>` elements constructs its
 * OWN `THREE.MeshStandardMaterial`. Five hundred crates are five hundred
 * distinct uuids describing one identical appearance. A uuid-keyed grouper
 * reports five hundred families of one, finds nothing to do, and is indistin-
 * guishable from a correct batcher over an unbatchable scene.
 *
 * So the key here is the STRUCTURE: geometry `type` + its construction
 * `parameters`, material `type` + the props that decide what the draw looks
 * like. Two independently constructed `BoxGeometry(1,1,1)` +
 * `MeshStandardMaterial({color:'#8a6a44'})` pairs are the same draw, and this
 * module says so.
 *
 * ── WHERE VALUE CANNOT ANSWER, IDENTITY IS THE SAFE FALLBACK ────────────────
 * Twice below, a structural comparison would be a guess, and the answer is
 * `uuid:` — a key nothing else can equal, so the members simply do not group.
 * Not grouping costs a draw call; grouping two things that only LOOK alike
 * renders the wrong picture.
 *   - geometry with no `.parameters` (a loaded GLTF mesh, a hand-built
 *     `BufferGeometry`): its vertices are its identity and comparing them is
 *     not a signature, it is a diff.
 *   - a shader material ({@link materialMergeSignature} only): its appearance
 *     lives in shader source and uniforms that no fixed prop list can read.
 *
 * ── THE KEY ─────────────────────────────────────────────────────────────────
 * {@link materialMergeSignature} is what `<Frozen>` groups by: that path hands
 * ONE material instance to a merged/instanced product, so its members must be
 * interchangeable, not merely similar.
 */

import type * as THREE from 'three';

/**
 * The `userData` key a node opts OUT of static batching with — the one
 * declaration that beats every measurement:
 *
 *     <group name="Beacons" userData={{ staticBatch: false }}>
 *
 * Set on a node, it covers that node's whole subtree (a walker stops there).
 * It is deliberately `userData` and not a component prop: the thing being
 * excluded is a three node, and every authoring lane — TSX, a loaded GLTF, a
 * hand-built graph — can set `userData` on one.
 */
export const STATIC_BATCH_OPT_OUT_KEY = 'staticBatch';

/**
 * Why one node may not be collapsed into a batch. `null` from
 * {@link staticBatchSkipReason} means it may.
 *
 * Each of these is a case where a batched draw would render something DIFFERENT
 * from the originals, not merely a case that is awkward to implement:
 *  - `instanced` / `batched` — already one draw; swallowing it would flatten
 *    per-instance transforms the batch does not carry.
 *  - `skinned` — its vertices are posed by a bone matrix palette every frame;
 *    baking one pose freezes the character mid-stride.
 *  - `morph-targets` — same, driven by influences instead of bones.
 *  - `multi-material` — the geometry's `groups` select a material per range;
 *    a batch carries one material.
 *  - `transparent` — blending is order-dependent and three sorts TRANSPARENT
 *    OBJECTS, not triangles. Collapsing them fixes their relative order to
 *    whatever the merge happened to write.
 *  - `opted-out` — see {@link STATIC_BATCH_OPT_OUT_KEY}.
 */
export type StaticBatchSkipReason =
  | 'not-a-mesh'
  | 'instanced'
  | 'batched'
  | 'skinned'
  | 'no-geometry'
  | 'multi-material'
  | 'morph-targets'
  | 'transparent'
  | 'opted-out';

interface MeshKinds {
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  isSkinnedMesh?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
}

/**
 * Why `node` may not join a static batch, or `null` when it may. Pure, cheap,
 * and the SINGLE owner of that answer — see the module note for why the
 * batcher and the advisor cannot each keep their own copy.
 *
 * Checks the node itself only. Subtree exclusion (an opted-out ancestor) is
 * the caller's walk, because the walkers that need this already prune.
 */
export function staticBatchSkipReason(node: THREE.Object3D): StaticBatchSkipReason | null {
  if (node.userData?.[STATIC_BATCH_OPT_OUT_KEY] === false) return 'opted-out';
  const mesh = node as THREE.Object3D & MeshKinds;
  if (mesh.isInstancedMesh) return 'instanced';
  if (mesh.isBatchedMesh) return 'batched';
  if (mesh.isSkinnedMesh) return 'skinned';
  if (!mesh.isMesh) return 'not-a-mesh';
  if (!mesh.geometry || !mesh.material) return 'no-geometry';
  if (Array.isArray(mesh.material)) return 'multi-material';
  if (Object.keys(mesh.geometry.morphAttributes).length > 0) return 'morph-targets';
  if (mesh.material.transparent) return 'transparent';
  return null;
}

/**
 * Geometry identity: construction `type` + `parameters` for the parametric
 * primitives, object identity for everything else. See the module note.
 */
export function geometrySignature(geometry: THREE.BufferGeometry): string {
  const params = (geometry as unknown as { parameters?: object }).parameters;
  return params ? `${geometry.type}:${JSON.stringify(params)}` : `uuid:${geometry.uuid}`;
}

/**
 * The standard-material props that change the draw: type, colour, roughness,
 * metalness, colour map, side, transparency and vertex colours. The base of
 * {@link materialMergeSignature}, which adds everything else that decides the
 * picture.
 */
export function materialSignature(material: THREE.Material): string {
  const standard = material as THREE.MeshStandardMaterial;
  const color = standard.color?.getHexString?.() ?? '';
  const map = standard.map?.uuid ?? '';
  return `${material.type}:${color}:${standard.roughness ?? ''}:${standard.metalness ?? ''}:${map}:${material.side}:${material.transparent}:${material.vertexColors}`;
}

/**
 * Which vertex attributes a geometry carries, and whether it is indexed —
 * the compatibility precondition for `mergeGeometries`, which refuses a batch
 * whose members disagree.
 *
 * Item size is in the key too: two geometries can both have `uv` and disagree
 * about whether it is 2- or 3-component, which merges into silent garbage
 * rather than a refusal.
 */
export function geometryLayoutSignature(geometry: THREE.BufferGeometry): string {
  const attributes = Object.keys(geometry.attributes)
    .sort()
    .map((name) => `${name}:${geometry.attributes[name]?.itemSize ?? '?'}`)
    .join(',');
  return `${attributes}${geometry.getIndex() ? '|i' : ''}`;
}

/**
 * Material identity for a path that will SHARE one material instance between
 * every member it collapses.
 *
 * Everything {@link materialSignature} reads, plus the props that decide the picture
 * without touching colour/roughness/metalness: opacity and the depth/blend
 * state, emissive, the remaining standard maps, and the flags that change the
 * compiled program. A shader material answers with its uuid instead (see the
 * module note): its appearance is source and uniforms, and there is no honest
 * fixed-prop reading of it.
 */
export function materialMergeSignature(material: THREE.Material): string {
  const shader = material as THREE.ShaderMaterial & { isRawShaderMaterial?: boolean };
  if (shader.isShaderMaterial || shader.isRawShaderMaterial) return `uuid:${material.uuid}`;

  const rich = material as THREE.MeshPhysicalMaterial;
  const maps = [rich.normalMap, rich.aoMap, rich.emissiveMap, rich.roughnessMap, rich.metalnessMap]
    .map((map) => map?.uuid ?? '')
    .join(',');
  // A material with a patched `onBeforeCompile` declares its variant through
  // this hook (that is what three itself keys its program cache on), so a
  // non-empty value discriminates here too.
  const program = material.customProgramCacheKey?.() ?? '';
  return [
    materialSignature(material),
    material.opacity,
    material.depthWrite,
    material.depthTest,
    material.alphaTest,
    material.blending,
    material.toneMapped,
    material.visible,
    rich.emissive?.getHexString?.() ?? '',
    rich.flatShading ?? '',
    rich.wireframe ?? '',
    maps,
    program,
  ].join('|');
}
