/**
 * The Three-typed half of the adapter contract. `@volter/editor-project`
 * states the `three` surface with its medium objects opaque (a scene, a
 * camera, a renderer, a hierarchy's scene objects, navigation's debug mesh);
 * this module names them as three.js objects for the editor side that renders
 * and authors them. A `three`-surface adapter hands exactly these objects, so
 * each view below is a narrowing of what the contract already carries, not a
 * conversion.
 */

import type {
  AuthoringAdapter,
  HierarchyProvider,
  MountedThreeRoot,
  NavigationAdapter,
  PhysicsAdapter,
  ThreeHostContext,
} from '@volter/editor-project/adapter';
import type { NavBakeParams } from '@volter/editor-project/adapter/system-adapter';
import type * as THREE from 'three';

/** Shared GLTF/texture cache a `three` host hands its roots. */
export interface ThreeAssetCache {
  /** Load an asset by URL. Returns a cached promise if already loading/loaded. */
  load<T = unknown>(url: string): Promise<T>;
  /** Get a previously-loaded asset synchronously. Throws if not yet loaded. */
  get<T = unknown>(url: string): T;
}

/** What a `three`-surface root is handed, Three-typed. */
export type ThreeRootHostContext = ThreeHostContext<typeof THREE, THREE.WebGLRenderer, ThreeAssetCache>;

/** A live, mounted Three world, Three-typed. */
export type ThreeMountedRoot = MountedThreeRoot<THREE.Scene, THREE.Camera>;

/** A mounted `three` root, as the Three objects it hands. */
export function threeRoot(mounted: MountedThreeRoot): ThreeMountedRoot {
  return mounted as ThreeMountedRoot;
}

/** The hierarchy's scene-object doors, Three-typed. */
export interface ThreeHierarchy {
  object3D?(id: string): THREE.Object3D | null;
  idForObject3D?(o: THREE.Object3D): string | null;
}

/** A `three`-surface authoring adapter's hierarchy, as the Three objects it hands. */
export function threeHierarchy(adapter: Pick<AuthoringAdapter, 'hierarchy'>): HierarchyProvider & ThreeHierarchy {
  return adapter.hierarchy as HierarchyProvider & ThreeHierarchy;
}

/** The live Three object a `three`-surface hierarchy hands for `id` (null
 * when it has none, or omits the door). */
export function threeObject(hierarchy: Pick<HierarchyProvider, 'object3D'>, id: string): THREE.Object3D | null {
  return (hierarchy.object3D?.(id) ?? null) as THREE.Object3D | null;
}

/** A `three`-surface navigation adapter, as the Three objects it trades in. */
export interface ThreeNavigationAdapter extends NavigationAdapter {
  debugMesh(scene: THREE.Scene): THREE.Object3D | null;
  bake?(meshes: THREE.Mesh[], params?: NavBakeParams): boolean;
  clear?(scene: THREE.Scene): void;
}

export function threeNavigation(adapter: NavigationAdapter): ThreeNavigationAdapter {
  return adapter as ThreeNavigationAdapter;
}

/** A `three`-surface physics adapter's debug-draw object. */
export function threePhysicsDebugDraw(adapter: PhysicsAdapter): THREE.Object3D | null {
  return (adapter.debugDraw?.() ?? null) as THREE.Object3D | null;
}
