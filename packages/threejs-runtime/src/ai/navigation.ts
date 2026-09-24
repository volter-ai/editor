/**
 * NavMeshManager — wraps recast-navigation for navmesh generation + crowd pathfinding.
 *
 * Usage:
 *   await init();  // WASM init (call once per app)
 *   const nav = new NavMeshManager();
 *   await nav.buildFromMeshes(meshes);
 *   const path = nav.findPath(start, end);
 *   const crowd = nav.createCrowd(10);
 *   // In game loop: nav.updateCrowd(dt);
 */

import { NavMeshHelper, threeToSoloNavMesh, threeToTiledNavMesh } from '@recast-navigation/three';
import type { CrowdAgent, NavMesh } from 'recast-navigation';
import { Crowd, exportNavMesh, importNavMesh, init, NavMeshQuery } from 'recast-navigation';
import type { BufferGeometry, Scene } from 'three';
import { InstancedMesh, Matrix4, Mesh } from 'three';
import { DEFAULTS } from '../defaults';

export type { CrowdAgent };

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/** One crowd agent's live state — a plain-data snapshot safe to hand across
 *  the adapter seam (no WASM handles), for editor debug draw. */
export interface CrowdAgentSnapshot {
  position: Vector3Like;
  velocity: Vector3Like;
  radius: number;
  height: number;
  /** Detour's own agent state. `invalid` is the crowd's expressible FAILURE —
   * the agent is not on the navmesh (a bad spawn or teleport) and will not
   * move until re-placed; `offmesh` is an off-mesh connection traversal. */
  state: 'invalid' | 'walking' | 'offmesh';
  /** The agent's current move target — detour's own answer, reported as the
   * fact it is. Whether a request is ACTIVE is what {@link corners} says. */
  target: Vector3Like;
  /** The local path-corridor corners toward the target — the REQUESTED PATH
   * the crowd is steering along right now (detour keeps a local corridor, not
   * the whole route). Empty when the agent has nowhere to go. */
  corners: Vector3Like[];
}

/** Detour `CrowdAgentState` values, named. */
const AGENT_STATES = ['invalid', 'walking', 'offmesh'] as const;

export interface NavMeshBuildParams {
  /** Force bounded tiled generation for imported large-world scenes whose instanced render
   * census cannot be inferred from the source BufferGeometry counts alone. */
  tiled?: boolean | undefined;
  /** Recast tile width/height in voxels. Unity's NavMeshSurface default is 256; keeping tiles at
   * that scale also avoids thousands of empty-tile allocations across sparse imported worlds. */
  tileSize?: number | undefined;
  cellSize?: number | undefined;
  cellHeight?: number | undefined;
  walkableSlopeAngle?: number | undefined;
  walkableHeight?: number | undefined;
  walkableClimb?: number | undefined;
  walkableRadius?: number | undefined;
  maxEdgeLen?: number | undefined;
  maxSimplificationError?: number | undefined;
  minRegionArea?: number | undefined;
  mergeRegionArea?: number | undefined;
}

/** One authored Detour polygon. Vertex order is clockwise in the engine's XZ world basis. */
export interface NavMeshPolygon {
  readonly vertices: readonly number[];
  readonly flags?: number | undefined;
  readonly area?: number | undefined;
}

/** Detail-row offsets/counts for the polygon at the same index. */
export interface NavMeshDetailMesh {
  readonly vertexBase: number;
  readonly triangleBase: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/**
 * An already-authored polygon mesh, before Detour's ABI-specific tile serialization.
 *
 * This is the direct-data sibling of {@link buildFromMeshes}: use it when a source ecosystem has
 * already baked navigation. Re-rasterizing an editor bake is lossy—the polygon borders and detail
 * heights are the output, not another input mesh.
 */
export interface NavMeshPolygonData {
  readonly vertices: readonly (readonly [number, number, number])[];
  readonly polygons: readonly NavMeshPolygon[];
  readonly detailMeshes: readonly NavMeshDetailMesh[];
  readonly detailVertices: readonly (readonly [number, number, number])[];
  /** Three local vertex indices plus Detour edge flags; all four values are uint8. */
  readonly detailTriangles: readonly (readonly [number, number, number, number])[];
}

let wasmInitialized = false;

export async function initNavigation(): Promise<void> {
  if (wasmInitialized) return;
  await init();
  wasmInitialized = true;
}

/**
 * `@recast-navigation/three` applies each mesh's world matrix to its positions but copies the
 * source indices unchanged. A mirrored world matrix therefore reverses every triangle and can
 * make a visibly upward floor entirely unwalkable. Seat a winding-corrected geometry on an
 * equivalent root mesh for the bake; the game keeps its own native mesh untouched.
 */
function reverseTriangleWinding(geometry: BufferGeometry): void {
  const index = geometry.getIndex();
  if (index === null) {
    const position = geometry.getAttribute('position').clone();
    for (let vertex = 0; vertex + 2 < position.count; vertex += 3) {
      for (let component = 0; component < position.itemSize; component += 1) {
        const middle = position.getComponent(vertex + 1, component);
        position.setComponent(vertex + 1, component, position.getComponent(vertex + 2, component));
        position.setComponent(vertex + 2, component, middle);
      }
    }
    geometry.setAttribute('position', position);
    return;
  }
  for (let triangle = 0; triangle + 2 < index.count; triangle += 3) {
    const middle = index.getX(triangle + 1);
    index.setX(triangle + 1, index.getX(triangle + 2));
    index.setX(triangle + 2, middle);
  }
  index.needsUpdate = true;
}

/** Signed world-up area across a geometry's triangles. Closed obstacle meshes cancel to zero;
 * broad walkable surfaces retain the winding Recast uses for its slope test. */
function upwardTriangleArea(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const vertexAt = (offset: number): number => index?.getX(offset) ?? offset;
  let area = 0;
  const count = index?.count ?? position.count;
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    const a = vertexAt(triangle);
    const b = vertexAt(triangle + 1);
    const c = vertexAt(triangle + 2);
    const ux = position.getX(b) - position.getX(a);
    const uz = position.getZ(b) - position.getZ(a);
    const vx = position.getX(c) - position.getX(a);
    const vz = position.getZ(c) - position.getZ(a);
    area += uz * vx - ux * vz;
  }
  return area;
}

function recastInputMeshes(meshes: Mesh[]): {
  readonly meshes: Mesh[];
  readonly temporaryGeometries: BufferGeometry[];
} {
  const temporaryGeometries: BufferGeometry[] = [];
  const proxyAt = (geometry: BufferGeometry, matrix: Matrix4): Mesh => {
    if (matrix.determinant() < 0) {
      // Bake the complete mirrored transform into this clone. Passing a negative-determinant
      // matrix through `@recast-navigation/three` after reversing the source indices still lets
      // its geometry merge recalculate the triangle orientation from that matrix. An identity
      // proxy over already-world-space vertices has exactly one winding decision.
      const transformed = geometry.clone().applyMatrix4(matrix);
      // A negative determinant alone is insufficient: reflecting across a plane's normal axis
      // leaves every vertex in place, while reflecting an in-plane axis reverses its triangles.
      // Inspect the transformed walkable area instead of guessing from the 3D transform.
      if (upwardTriangleArea(transformed) < 0) reverseTriangleWinding(transformed);
      temporaryGeometries.push(transformed);
      return new Mesh(transformed);
    }
    const proxy = new Mesh(geometry);
    // The proxy has no parent, so its local matrix is the source mesh's complete world matrix.
    // The recast bridge calls updateMatrixWorld() itself; disabling auto-update preserves it.
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(matrix);
    proxy.matrixWorldNeedsUpdate = true;
    return proxy;
  };
  const corrected: Mesh[] = [];
  const instanceMatrix = new Matrix4();
  const worldMatrix = new Matrix4();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    if (mesh instanceof InstancedMesh) {
      for (let instance = 0; instance < mesh.count; instance += 1) {
        mesh.getMatrixAt(instance, instanceMatrix);
        worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
        corrected.push(proxyAt(mesh.geometry, worldMatrix));
      }
      continue;
    }
    corrected.push(
      mesh.matrixWorld.determinant() >= 0 ? mesh : proxyAt(mesh.geometry, mesh.matrixWorld),
    );
  }
  return { meshes: corrected, temporaryGeometries };
}

const NAV_MESH_SET_MAGIC = 0x4d53_4554;
const NAV_MESH_SET_VERSION = 1;
const DETOUR_NAV_MESH_MAGIC = 0x444e_4156;
const DETOUR_NAV_MESH_VERSION = 7;

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

/** Serialize portable polygon/detail arrays as one ordinary Detour tile. */
function polygonNavMeshData(data: NavMeshPolygonData, params?: NavMeshBuildParams): Uint8Array {
  const vertexCount = data.vertices.length;
  const polygonCount = data.polygons.length;
  if (vertexCount === 0 || polygonCount === 0) {
    throw new Error('NavMeshManager.buildFromPolygons: vertices and polygons must be non-empty');
  }
  if (vertexCount > 0xffff) {
    throw new Error(
      `NavMeshManager.buildFromPolygons: ${vertexCount} vertices exceed Detour's uint16 tile index`,
    );
  }
  if (data.detailMeshes.length !== polygonCount) {
    throw new Error(
      `NavMeshManager.buildFromPolygons: ${polygonCount} polygons require the same number of detail rows`,
    );
  }

  const neighbours = data.polygons.map((polygon) => polygon.vertices.map(() => 0));
  const edges = new Map<string, readonly [number, number]>();
  let maxLinkCount = 0;
  for (let polygonIndex = 0; polygonIndex < polygonCount; polygonIndex += 1) {
    const polygon = data.polygons[polygonIndex] as NavMeshPolygon;
    if (polygon.vertices.length < 3 || polygon.vertices.length > 6) {
      throw new Error(
        `NavMeshManager.buildFromPolygons: polygon ${polygonIndex} has ` +
          `${polygon.vertices.length} vertices; Detour permits 3..6`,
      );
    }
    maxLinkCount += polygon.vertices.length;
    for (let edgeIndex = 0; edgeIndex < polygon.vertices.length; edgeIndex += 1) {
      const from = polygon.vertices[edgeIndex] as number;
      const to = polygon.vertices[(edgeIndex + 1) % polygon.vertices.length] as number;
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to < 0 ||
        from >= vertexCount ||
        to >= vertexCount
      ) {
        throw new Error(
          `NavMeshManager.buildFromPolygons: polygon ${polygonIndex} references an invalid vertex`,
        );
      }
      const directed = `${from},${to}`;
      if (edges.has(directed)) {
        throw new Error(
          `NavMeshManager.buildFromPolygons: directed edge ${directed} occurs more than once`,
        );
      }
      const reverse = edges.get(`${to},${from}`);
      if (reverse === undefined) {
        edges.set(directed, [polygonIndex, edgeIndex]);
      } else {
        const [otherPolygon, otherEdge] = reverse;
        neighbours[polygonIndex]![edgeIndex] = otherPolygon + 1;
        neighbours[otherPolygon]![otherEdge] = polygonIndex + 1;
      }
    }
  }

  for (let polygonIndex = 0; polygonIndex < polygonCount; polygonIndex += 1) {
    const row = data.detailMeshes[polygonIndex] as NavMeshDetailMesh;
    if (
      row.vertexBase < 0 ||
      row.vertexCount < 0 ||
      row.vertexBase + row.vertexCount > data.detailVertices.length ||
      row.triangleBase < 0 ||
      row.triangleCount < 0 ||
      row.triangleBase + row.triangleCount > data.detailTriangles.length ||
      row.vertexCount > 0xff ||
      row.triangleCount > 0xff
    ) {
      throw new Error(
        `NavMeshManager.buildFromPolygons: polygon ${polygonIndex} has an invalid detail row`,
      );
    }
  }
  for (const triangle of data.detailTriangles) {
    if (triangle.some((value) => !Number.isInteger(value) || value < 0 || value > 0xff)) {
      throw new Error(
        'NavMeshManager.buildFromPolygons: detail triangles must contain uint8 values',
      );
    }
  }

  const boundsMin = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const boundsMax = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const vertex of [...data.vertices, ...data.detailVertices]) {
    for (let component = 0; component < 3; component += 1) {
      const value = vertex[component] as number;
      if (!Number.isFinite(value)) {
        throw new Error('NavMeshManager.buildFromPolygons: every vertex component must be finite');
      }
      boundsMin[component] = Math.min(boundsMin[component] as number, value);
      boundsMax[component] = Math.max(boundsMax[component] as number, value);
    }
  }

  // Detour's in-memory structs are emitted in its stable 32-bit serialized layout. `importNavMesh`
  // owns the ABI boundary and recreates live WASM objects from these ordinary bytes.
  const headerBytes = 100;
  const polygonBytes = 32;
  const linkBytes = 12;
  const detailMeshBytes = 12;
  const detailTriangleBytes = 4;
  const tileBytes =
    headerBytes +
    vertexCount * 12 +
    polygonCount * polygonBytes +
    maxLinkCount * linkBytes +
    polygonCount * detailMeshBytes +
    data.detailVertices.length * 12 +
    data.detailTriangles.length * detailTriangleBytes;
  const bytes = new Uint8Array(48 + tileBytes);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const uint8 = (value: number): void => {
    view.setUint8(offset, value);
    offset += 1;
  };
  const uint16 = (value: number): void => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const uint32 = (value: number): void => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const int32 = (value: number): void => {
    view.setInt32(offset, value, true);
    offset += 4;
  };
  const float32 = (value: number): void => {
    view.setFloat32(offset, value, true);
    offset += 4;
  };

  const maxPolygons = nextPowerOfTwo(polygonCount);
  uint32(NAV_MESH_SET_MAGIC);
  uint32(NAV_MESH_SET_VERSION);
  uint32(1);
  for (const value of boundsMin) float32(value);
  float32(Math.max((boundsMax[0] as number) - (boundsMin[0] as number), Number.EPSILON));
  float32(Math.max((boundsMax[2] as number) - (boundsMin[2] as number), Number.EPSILON));
  uint32(1);
  uint32(maxPolygons);
  // With one tile, Detour's first valid salt occupies the bits above maxPolygons.
  uint32(maxPolygons);
  uint32(tileBytes);

  uint32(DETOUR_NAV_MESH_MAGIC);
  uint32(DETOUR_NAV_MESH_VERSION);
  int32(0);
  int32(0);
  int32(0);
  uint32(0);
  uint32(polygonCount);
  uint32(vertexCount);
  uint32(maxLinkCount);
  uint32(polygonCount);
  uint32(data.detailVertices.length);
  uint32(data.detailTriangles.length);
  uint32(0);
  uint32(0);
  uint32(polygonCount);
  const defaults = DEFAULTS.navigation;
  float32(params?.walkableHeight ?? defaults.walkableHeight);
  float32(params?.walkableRadius ?? defaults.walkableRadius);
  float32(params?.walkableClimb ?? defaults.walkableClimb);
  for (const value of boundsMin) float32(value);
  for (const value of boundsMax) float32(value);
  float32(1 / (params?.cellSize ?? defaults.cellSize));

  for (const vertex of data.vertices) for (const value of vertex) float32(value);
  for (let polygonIndex = 0; polygonIndex < polygonCount; polygonIndex += 1) {
    const polygon = data.polygons[polygonIndex] as NavMeshPolygon;
    uint32(0xffff_ffff);
    for (let index = 0; index < 6; index += 1) uint16(polygon.vertices[index] ?? 0);
    for (let index = 0; index < 6; index += 1) {
      uint16(neighbours[polygonIndex]?.[index] ?? 0);
    }
    uint16(polygon.flags ?? 1);
    uint8(polygon.vertices.length);
    uint8((polygon.area ?? 0) & 0x3f);
  }
  // `dtNavMesh::addTile` turns this zeroed capacity into its free-list, then populates the
  // internal links from the polygon neighbour indices above.
  offset += maxLinkCount * linkBytes;
  for (const row of data.detailMeshes) {
    uint32(row.vertexBase);
    uint32(row.triangleBase);
    uint8(row.vertexCount);
    uint8(row.triangleCount);
    uint16(0);
  }
  for (const vertex of data.detailVertices) for (const value of vertex) float32(value);
  for (const triangle of data.detailTriangles) for (const value of triangle) uint8(value);
  if (offset !== bytes.length) {
    throw new Error(
      `NavMeshManager.buildFromPolygons: encoded ${offset} bytes into a ${bytes.length}-byte allocation`,
    );
  }
  return bytes;
}

export class NavMeshManager {
  private navMesh: NavMesh | null = null;
  private query: NavMeshQuery | null = null;
  private crowd: Crowd | null = null;
  private helper: NavMeshHelper | null = null;

  /** Build navmesh from Three.js Mesh objects (grounds, obstacles, etc.). */
  buildFromMeshes(meshes: Mesh[], params?: NavMeshBuildParams): boolean {
    const d = DEFAULTS.navigation;
    const input = recastInputMeshes(meshes);
    const triangleCount = input.meshes.reduce((total, mesh) => {
      const index = mesh.geometry.getIndex();
      const vertices = mesh.geometry.getAttribute('position').count;
      return total + Math.floor((index?.count ?? vertices) / 3);
    }, 0);
    const config = {
      cs: params?.cellSize ?? d.cellSize,
      ch: params?.cellHeight ?? d.cellHeight,
      walkableSlopeAngle: params?.walkableSlopeAngle ?? d.walkableSlopeAngle,
      walkableHeight: params?.walkableHeight ?? d.walkableHeight,
      walkableClimb: params?.walkableClimb ?? d.walkableClimb,
      walkableRadius: params?.walkableRadius ?? d.walkableRadius,
      maxEdgeLen: params?.maxEdgeLen ?? d.maxEdgeLen,
      maxSimplificationError: params?.maxSimplificationError ?? d.maxSimplificationError,
      minRegionArea: params?.minRegionArea ?? d.minRegionArea,
      mergeRegionArea: params?.mergeRegionArea ?? d.mergeRegionArea,
      // Recast tuning knobs with no DEFAULTS counterpart (not modeled there).
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    };
    // A solo heightfield allocates for the whole scene at once. Large imported Unity scenes can
    // exceed Recast's WASM address space during rasterization even though every individual mesh
    // is ordinary-sized. Tiled generation is the library's native large-world path and keeps the
    // same NavMesh result/API while bounding each rasterization allocation.
    let result: ReturnType<typeof threeToSoloNavMesh> | ReturnType<typeof threeToTiledNavMesh>;
    try {
      result =
        params?.tiled === true || input.meshes.length > 256 || triangleCount > 10_000
          ? threeToTiledNavMesh(input.meshes, {
              ...config,
              tileSize: params?.tileSize ?? 256,
            })
          : threeToSoloNavMesh(input.meshes, config);
    } finally {
      for (const geometry of input.temporaryGeometries) geometry.dispose();
    }

    if (!result.success || !result.navMesh) return false;

    // Free the previous recast objects before replacing them (WASM heap leak).
    this.destroyRecast();
    this.navMesh = result.navMesh;
    this.query = new NavMeshQuery(this.navMesh);
    return true;
  }

  /** Load an authored polygon/detail mesh directly, without a second rasterization. */
  buildFromPolygons(data: NavMeshPolygonData, params?: NavMeshBuildParams): boolean {
    try {
      this.loadFromData(polygonNavMeshData(data, params));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destroy all live recast handles (crowd, query, navmesh) and dispose the
   * debug helper. Recast objects live on the WASM heap and are NOT GC'd —
   * they must be explicitly `.destroy()`ed or they leak.
   */
  private destroyRecast(): void {
    if (this.helper) {
      this.helper.parent?.remove(this.helper);
      (this.helper as unknown as { dispose?: () => void }).dispose?.();
      this.helper = null;
    }
    if (this.crowd) {
      this.crowd.destroy();
      this.crowd = null;
    }
    if (this.query) {
      this.query.destroy();
      this.query = null;
    }
    if (this.navMesh) {
      this.navMesh.destroy();
      this.navMesh = null;
    }
  }

  /** True once a navmesh has been built (for the NavigationAdapter to gate on). */
  hasNavMesh(): boolean {
    return this.navMesh !== null;
  }

  /**
   * Find a straight path between two world positions.
   *
   * THREE OUTCOMES, and only one of them is an empty array:
   *
   *  - **No pathfinder.** No navmesh has been built, so there is nothing to
   *    query. THROWS, the same way {@link createCrowd} does — `[]` here would
   *    say "I searched and there is no route between these points", which is a
   *    claim about the level rather than about this manager's state. Callers
   *    that can be in this position gate on {@link hasNavMesh} first.
   *  - **The query failed.** recast answered `success: false` WITH an error
   *    (bad half-extents, no polygon near an endpoint, a status code). THROWS,
   *    naming recast's own error — a failed search is not a searched-and-empty
   *    one, and the editor's probe already surfaces this separately from "no
   *    path found".
   *  - **Genuinely no route.** The query ran and found nothing. `[]`.
   */
  findPath(start: Vector3Like, end: Vector3Like): Vector3Like[] {
    if (!this.query) {
      throw new Error(
        'NavMeshManager.findPath: no navmesh has been built, so no path can be queried. ' +
          'Build one first (buildFromMeshes/importNavMesh) — gate on hasNavMesh() if the ' +
          'caller can run before a bake.',
      );
    }
    const result = this.query.computePath(start, end);
    if (!result.success && result.error) {
      throw new Error(
        `NavMeshManager.findPath: recast could not complete the query (${result.error.name}` +
          `${result.error.status === undefined ? '' : `, status ${result.error.status}`}).`,
      );
    }
    return result.path;
  }

  /** Create a crowd with up to maxAgents agents. */
  createCrowd(maxAgents: number): Crowd {
    if (!this.navMesh) throw new Error('Build navmesh first');
    this.crowd = new Crowd(this.navMesh, { maxAgents, maxAgentRadius: 0.6 });
    return this.crowd;
  }

  /** Step the crowd simulation. Call once per frame. */
  updateCrowd(dt: number): void {
    this.crowd?.update(dt);
  }

  /**
   * Plain-data snapshots of every active crowd agent (interpolated position,
   * velocity, radius, height) — the introspection feed for the editor's
   * play-mode crowd debug draw. Empty when no crowd exists.
   */
  getCrowdAgents(): CrowdAgentSnapshot[] {
    if (!this.crowd) return [];
    return this.crowd.getAgents().map((a) => {
      const p = a.interpolatedPosition;
      const v = a.velocity();
      const t = a.target();
      // An invalid agent has no corridor, and detour's accessors are not
      // guaranteed meaningful off the mesh — report the failure state with an
      // empty path rather than reading through it.
      const state = AGENT_STATES[a.state()] ?? 'invalid';
      const corners =
        state === 'invalid' ? [] : a.corners().map((c) => ({ x: c.x, y: c.y, z: c.z }));
      return {
        position: { x: p.x, y: p.y, z: p.z },
        velocity: { x: v.x, y: v.y, z: v.z },
        radius: a.radius,
        height: a.height,
        state,
        target: { x: t.x, y: t.y, z: t.z },
        corners,
      };
    });
  }

  /** Get or create the wireframe debug mesh. Add to scene once, call update() after rebuilding. */
  getDebugMesh(scene: Scene): NavMeshHelper | null {
    if (!this.navMesh) return null;
    if (!this.helper) {
      this.helper = new NavMeshHelper(this.navMesh);
      scene.add(this.helper);
    }
    return this.helper;
  }

  /** Serialize the current navmesh to a binary blob. */
  exportData(): Uint8Array {
    if (!this.navMesh) throw new Error('No navmesh to export');
    return exportNavMesh(this.navMesh);
  }

  /** Load a navmesh from a previously exported binary blob. */
  loadFromData(data: Uint8Array): void {
    const { navMesh } = importNavMesh(data);
    // Free the previous recast objects before replacing them.
    this.destroyRecast();
    this.navMesh = navMesh;
    this.query = new NavMeshQuery(this.navMesh);
  }

  dispose(scene: Scene): void {
    // Ensure the helper is removed from the passed scene as well, then destroy
    // every recast handle (crowd/query/navmesh) so nothing leaks on the WASM heap.
    if (this.helper) scene.remove(this.helper);
    this.destroyRecast();
  }
}
