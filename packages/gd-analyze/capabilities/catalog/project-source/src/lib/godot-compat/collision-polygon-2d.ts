/**
 * CollisionPolygon2D over the port's retained Rapier 2D body.
 *
 * Godot 3.6 and 4.7 both build SOLIDS with TPPLPartition::ConvexPartition_HM and build SEGMENTS
 * as the closed edge sequence `(p[i], p[(i + 1) % n])`. This file carries that engine behaviour;
 * emitted source supplies only the authored points and owner properties.
 */
import RAPIER from '@dimforge/rapier2d-compat';
import { Container } from 'pixi.js';
import type { CollisionLayers } from './collision-layers';
import type { GodotColliderOwner, GodotMutableColliderRegistry } from './collider-registry';
import { convexPartitionPolygon } from './collision-polygon-partition';
import { registerGodotObjectIdentity } from './object';
import { packedVector2Array, type PackedVector2Array } from './packed-array';
import { vec2 } from './vector2';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';

export interface CollisionPolygonPoint2D {
  readonly x: number;
  readonly y: number;
}

export type CollisionPolygonBuildMode = 0 | 1;

export interface CollisionPolygon2DOptions {
  readonly node: Container;
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly layers: CollisionLayers;
  readonly polygon: readonly CollisionPolygonPoint2D[];
  readonly buildMode: CollisionPolygonBuildMode;
  readonly disabled: boolean;
  readonly sensor: boolean;
  readonly collisionLayer: number;
  readonly collisionMask: number;
  readonly oneWayCollision: boolean;
  readonly oneWayCollisionMargin: number;
  readonly onColliderAdded: (collider: RAPIER.Collider) => void;
  readonly onColliderRemoved: (collider: RAPIER.Collider) => void;
  readonly at: string;
}

/** Shape-owner-shaped aggregate: every convex piece changes enabled state as one Godot node. */
export type CollisionPolygon2DHandle = Container & {
  readonly colliders: readonly RAPIER.Collider[];
  polygon: PackedVector2Array;
  build_mode: CollisionPolygonBuildMode;
  set_polygon(polygon: Iterable<CollisionPolygonPoint2D>): void;
  get_polygon(): PackedVector2Array;
  set_build_mode(mode: CollisionPolygonBuildMode): void;
  get_build_mode(): CollisionPolygonBuildMode;
  set_disabled(disabled: boolean): void;
  is_disabled(): boolean;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  release(): void;
};

function flat(points: readonly CollisionPolygonPoint2D[]): Float32Array {
  return new Float32Array(points.flatMap((point) => [point.x, point.y]));
}

function polygonValue(value: Iterable<CollisionPolygonPoint2D>, at: string): CollisionPolygonPoint2D[] {
  if (
    value === null || typeof value !== 'object' ||
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function'
  ) {
    throw new TypeError(`${at}: CollisionPolygon2D.polygon requires a PoolVector2Array/PackedVector2Array value.`);
  }
  const points: CollisionPolygonPoint2D[] = [];
  for (const point of value) {
    if (
      point === null || typeof point !== 'object' ||
      typeof point.x !== 'number' || typeof point.y !== 'number' ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y)
    ) {
      throw new TypeError(`${at}: CollisionPolygon2D.polygon contains a non-finite Vector2.`);
    }
    points.push({ x: point.x, y: point.y });
  }
  return points;
}

function descriptorsFor(
  polygon: readonly CollisionPolygonPoint2D[],
  buildMode: CollisionPolygonBuildMode,
  at: string,
): RAPIER.ColliderDesc[] {
  const descriptors: RAPIER.ColliderDesc[] = [];
  if (buildMode === 0) {
    if (polygon.length >= 3) {
      for (const part of convexPartitionPolygon(polygon, at)) {
        const descriptor = RAPIER.ColliderDesc.convexPolyline(flat(part));
        if (descriptor === null) {
          throw new Error(`${at}: Rapier rejected a convex piece produced by Godot's BUILD_SOLIDS decomposition.`);
        }
        descriptors.push(descriptor);
      }
    }
    return descriptors;
  }
  if (buildMode === 1) {
    if (polygon.length >= 2) {
      const vertices = flat(polygon);
      const indices = new Uint32Array(polygon.length * 2);
      for (let i = 0; i < polygon.length; i += 1) {
        indices[i * 2] = i;
        indices[i * 2 + 1] = (i + 1) % polygon.length;
      }
      descriptors.push(RAPIER.ColliderDesc.polyline(vertices, indices));
    }
    return descriptors;
  }
  throw new Error(`${at}: CollisionPolygon2D.build_mode=${String(buildMode)} is outside BUILD_SOLIDS/BUILD_SEGMENTS.`);
}

/** Construct and own every Rapier collider represented by one CollisionPolygon2D shape owner. */
export function createCollisionPolygon2D(options: CollisionPolygon2DOptions): CollisionPolygon2DHandle {
  const node = bindGodotCanvasNode2DApi(options.node);
  const { at } = options;
  let polygon = polygonValue(options.polygon, at);
  let buildMode = options.buildMode;
  if (options.oneWayCollision && !options.sensor) {
    throw new Error(
      `${at}: CollisionPolygon2D.one_way_collision=true requires Godot's directional contact ` +
        `solver with margin ${options.oneWayCollisionMargin}; Rapier 2D has no equivalent one-way collider mode.`,
    );
  }
  const colliders: RAPIER.Collider[] = [];
  let released = false;
  let enabled = !options.disabled;
  const removeNative = (): void => {
    for (const collider of colliders) {
      options.onColliderRemoved(collider);
      options.world.removeCollider(collider, true);
    }
    colliders.length = 0;
  };
  const rebuild = (): void => {
    const currentLayer = colliders.length === 0
      ? options.collisionLayer
      : options.layers.layerOf(colliders[0]!);
    const currentMask = colliders.length === 0
      ? options.collisionMask
      : options.layers.maskOf(colliders[0]!);
    removeNative();
    if (released) return;
    for (const descriptor of descriptorsFor(polygon, buildMode, at)) {
      descriptor
        .setTranslation(node.position.x, node.position.y)
        .setRotation(node.rotation)
        .setEnabled(enabled)
        .setSensor(options.sensor);
      if (options.sensor) descriptor.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
      const collider = options.world.createCollider(descriptor, options.body);
      options.layers.set(collider, currentLayer, currentMask);
      colliders.push(collider);
      options.onColliderAdded(collider);
    }
  };
  const handle = Object.assign(node, {
    set_polygon(value: Iterable<CollisionPolygonPoint2D>): void {
      polygon = polygonValue(value, at);
      rebuild();
    },
    get_polygon(): PackedVector2Array {
      return packedVector2Array(polygon.map((point) => vec2(point.x, point.y)));
    },
    set_build_mode(value: CollisionPolygonBuildMode): void {
      if (value !== 0 && value !== 1) {
        throw new RangeError(`${at}: CollisionPolygon2D.build_mode requires BUILD_SOLIDS (0) or BUILD_SEGMENTS (1).`);
      }
      if (buildMode === value) return;
      buildMode = value;
      rebuild();
    },
    get_build_mode(): CollisionPolygonBuildMode { return buildMode; },
    set_disabled(disabled: boolean): void {
      if (typeof disabled !== 'boolean') throw new TypeError('CollisionPolygon2D.disabled requires bool.');
      handle.setEnabled(!disabled);
    },
    is_disabled(): boolean { return !enabled; },
    isEnabled(): boolean { return enabled; },
    setEnabled(next: boolean): void {
      if (typeof next !== 'boolean') throw new TypeError('CollisionPolygon2D enabled state requires bool.');
      enabled = next;
      for (const collider of colliders) collider.setEnabled(next);
    },
    release(): void {
      if (released) return;
      released = true;
      removeNative();
    },
  }) as unknown as CollisionPolygon2DHandle;
  Object.defineProperties(handle, {
    colliders: { enumerable: false, configurable: true, get: () => colliders },
    polygon: {
      enumerable: true,
      configurable: true,
      get: () => handle.get_polygon(),
      set: (value: Iterable<CollisionPolygonPoint2D>) => handle.set_polygon(value),
    },
    build_mode: {
      enumerable: true,
      configurable: true,
      get: () => handle.get_build_mode(),
      set: (value: CollisionPolygonBuildMode) => handle.set_build_mode(value),
    },
    disabled: {
      enumerable: true,
      configurable: true,
      get: () => handle.is_disabled(),
      set: (value: boolean) => handle.set_disabled(value),
    },
  });
  registerGodotObjectIdentity(handle, 'CollisionPolygon2D');
  registerCanvasNodeRelease(handle, () => handle.release());
  rebuild();
  return handle;
}

/** Runtime CollisionPolygon2D.new() over a caller-owned Rapier body and world. */
export function createGodotCollisionPolygon2D(
  options: Omit<CollisionPolygon2DOptions, 'node' | 'polygon' | 'buildMode' | 'disabled'> & {
    readonly polygon?: readonly CollisionPolygonPoint2D[];
    readonly buildMode?: CollisionPolygonBuildMode;
    readonly disabled?: boolean;
  },
): CollisionPolygon2DHandle {
  return createCollisionPolygon2D({
    ...options,
    node: new Container(),
    polygon: options.polygon ?? [],
    buildMode: options.buildMode ?? 0,
    disabled: options.disabled ?? false,
  });
}

/** `CollisionPolygon2D.new()` owns a detached fixed body until a caller adds the node to a body. */
export function createGodotCollisionPolygon2DStandalone(options: {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly colliders: GodotMutableColliderRegistry<RAPIER.Collider, GodotColliderOwner>;
}): CollisionPolygon2DHandle {
  const body = options.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const node = new Container();
  try {
    const handle = createCollisionPolygon2D({
      world: options.world,
      body,
      node,
      layers: options.layers,
      sensor: false,
      collisionLayer: 1,
      collisionMask: 1,
      oneWayCollision: false,
      oneWayCollisionMargin: 1,
      polygon: [],
      buildMode: 0,
      disabled: false,
      onColliderAdded: (collider) => options.colliders.set(collider, node),
      onColliderRemoved: (collider) => options.colliders.delete(collider),
      at: 'CollisionPolygon2D.new',
    });
    registerCanvasNodeRelease(handle, () => options.world.removeRigidBody(body));
    return handle;
  } catch (error) {
    options.world.removeRigidBody(body);
    throw error;
  }
}

/** Push the retained Node2D local transform into every current native shape before physics. */
export function syncCollisionPolygon2DTransform(handle: CollisionPolygon2DHandle): void {
  if (
    handle.scale.x !== 1 || handle.scale.y !== 1 ||
    handle.skew.x !== 0 || handle.skew.y !== 0
  ) {
    throw new Error(
      'CollisionPolygon2D runtime scale/skew cannot be represented by a rigid Rapier shape-owner transform.',
    );
  }
  if (
    !Number.isFinite(handle.position.x) || !Number.isFinite(handle.position.y) ||
    !Number.isFinite(handle.rotation)
  ) {
    throw new TypeError('CollisionPolygon2D Node2D transform must remain finite.');
  }
  for (const collider of handle.colliders) {
    collider.setTranslationWrtParent({ x: handle.position.x, y: handle.position.y });
    collider.setRotationWrtParent(handle.rotation);
  }
}
