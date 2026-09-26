/** Godot 3 CollisionPolygon / Godot 4 CollisionPolygon3D on a retained Rapier body. */
import RAPIER from '@dimforge/rapier3d-compat';
import { Object3D } from 'three';
import type { CollisionLayers } from './collision-layers';
import { convexPartitionPolygon, type PolygonPoint2 } from './collision-polygon-partition';
import { registerGodotObjectIdentity } from './object';
import { packedVector2Array, type PackedVector2Array } from './packed-array';
import { vec2 } from './vector2';

export interface CollisionPolygon3DOptions {
  readonly node: Object3D;
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly layers: CollisionLayers;
  readonly polygon: readonly PolygonPoint2[];
  readonly depth: number;
  readonly margin: number;
  readonly disabled: boolean;
  readonly sensor: boolean;
  readonly collisionLayer: number;
  readonly collisionMask: number;
  readonly friction?: number;
  readonly frictionCombine?: 'min' | 'max';
  readonly restitution?: number;
  readonly onColliderAdded: (collider: RAPIER.Collider) => void;
  readonly onColliderRemoved: (collider: RAPIER.Collider) => void;
  readonly at: string;
}

export type GodotCollisionPolygon3D = Object3D & {
  readonly colliders: readonly RAPIER.Collider[];
  polygon: PackedVector2Array;
  depth: number;
  margin: number;
  disabled: boolean;
  set_polygon(value: Iterable<PolygonPoint2>): void;
  get_polygon(): PackedVector2Array;
  set_depth(value: number): void;
  get_depth(): number;
  set_margin(value: number): void;
  get_margin(): number;
  set_disabled(value: boolean): void;
  is_disabled(): boolean;
  isEnabled(): boolean;
  setEnabled(value: boolean): void;
  release(): void;
};

function finiteNumber(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`CollisionPolygon.${member} requires a finite float.`);
  }
  return value;
}

function polygonValue(value: Iterable<PolygonPoint2>, at: string): PolygonPoint2[] {
  if (
    value === null || typeof value !== 'object' ||
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function'
  ) {
    throw new TypeError(`${at}: CollisionPolygon.polygon requires PoolVector2Array/PackedVector2Array.`);
  }
  const points: PolygonPoint2[] = [];
  for (const point of value) {
    if (
      point === null || typeof point !== 'object' ||
      typeof point.x !== 'number' || typeof point.y !== 'number' ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y)
    ) {
      throw new TypeError(`${at}: CollisionPolygon.polygon contains a non-finite Vector2.`);
    }
    points.push({ x: point.x, y: point.y });
  }
  return points;
}

function extrudedVertices(points: readonly PolygonPoint2[], depth: number): Float32Array {
  const halfDepth = depth * 0.5;
  const vertices = new Float32Array(points.length * 6);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const offset = index * 6;
    // Godot appends the positive-Z face first, then the negative-Z face, in polygon order.
    vertices[offset] = point.x;
    vertices[offset + 1] = point.y;
    vertices[offset + 2] = halfDepth;
    vertices[offset + 3] = point.x;
    vertices[offset + 4] = point.y;
    vertices[offset + 5] = -halfDepth;
  }
  return vertices;
}

function descriptors(
  polygon: readonly PolygonPoint2[],
  depth: number,
  margin: number,
  at: string,
): RAPIER.ColliderDesc[] {
  if (margin < 0) {
    throw new Error(
      `${at}: negative CollisionPolygon.margin has no native Rapier contact-skin representation.`,
    );
  }
  if (polygon.length < 3) return [];
  const result: RAPIER.ColliderDesc[] = [];
  for (const part of convexPartitionPolygon(polygon, at)) {
    const vertices = extrudedVertices(part, depth);
    const descriptor = margin === 0
      ? RAPIER.ColliderDesc.convexHull(vertices)
      : RAPIER.ColliderDesc.roundConvexHull(vertices, margin);
    if (descriptor === null) {
      throw new Error(`${at}: Rapier rejected a convex prism produced by Godot's polygon decomposition.`);
    }
    // Godot exposes Shape.margin to contacts AND physics queries as the convex prism's Minkowski
    // border. A rounded convex hull carries that border in native geometry; contact skin would
    // affect only solver prediction and make ray/shape queries observe the un-margined prism.
    result.push(descriptor);
  }
  return result;
}

function assertRigidLocalTransform(node: Object3D): void {
  const { position, quaternion, scale } = node;
  if (
    !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z) ||
    !Number.isFinite(quaternion.x) || !Number.isFinite(quaternion.y) ||
    !Number.isFinite(quaternion.z) || !Number.isFinite(quaternion.w)
  ) {
    throw new TypeError('CollisionPolygon Spatial transform must remain finite.');
  }
  if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
    throw new Error(
      'CollisionPolygon scale cannot be represented by Godot shape-owner transform semantics; ' +
      'author the polygon/depth dimensions instead.',
    );
  }
}

/** Bind one retained Spatial node to the direct CollisionObject parent's native Rapier body. */
export function bindCollisionPolygon3D(options: CollisionPolygon3DOptions): GodotCollisionPolygon3D {
  const { node, at } = options;
  let polygon = polygonValue(options.polygon, at);
  let depth = finiteNumber(options.depth, 'depth');
  let margin = finiteNumber(options.margin, 'margin');
  let enabled = !options.disabled;
  let released = false;
  const colliders: RAPIER.Collider[] = [];

  const removeNative = (): void => {
    for (const collider of colliders) {
      options.onColliderRemoved(collider);
      options.world.removeCollider(collider, true);
    }
    colliders.length = 0;
  };
  const syncTransform = (): void => {
    assertRigidLocalTransform(node);
    for (const collider of colliders) {
      collider.setTranslationWrtParent(node.position);
      collider.setRotationWrtParent(node.quaternion);
    }
  };
  const rebuild = (): void => {
    const layer = colliders.length === 0 ? options.collisionLayer : options.layers.layerOf(colliders[0]!);
    const mask = colliders.length === 0 ? options.collisionMask : options.layers.maskOf(colliders[0]!);
    removeNative();
    if (released) return;
    assertRigidLocalTransform(node);
    for (const descriptor of descriptors(polygon, depth, margin, at)) {
      descriptor
        .setTranslation(node.position.x, node.position.y, node.position.z)
        .setRotation(node.quaternion)
        .setEnabled(enabled)
        .setSensor(options.sensor);
      if (options.sensor) descriptor.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
      else {
        if (options.friction !== undefined) {
          descriptor
            .setFriction(options.friction)
            .setFrictionCombineRule(
              options.frictionCombine === 'max'
                ? RAPIER.CoefficientCombineRule.Max
                : RAPIER.CoefficientCombineRule.Min,
            );
        }
        if (options.restitution !== undefined) {
          descriptor
            .setRestitution(options.restitution)
            .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
        }
      }
      const collider = options.world.createCollider(descriptor, options.body);
      options.layers.set(collider, layer, mask);
      colliders.push(collider);
      options.onColliderAdded(collider);
    }
  };

  const handle = Object.assign(node, {
    set_polygon(value: Iterable<PolygonPoint2>): void {
      polygon = polygonValue(value, at);
      rebuild();
    },
    get_polygon(): PackedVector2Array {
      return packedVector2Array(polygon.map((point) => vec2(point.x, point.y)));
    },
    set_depth(value: number): void {
      depth = finiteNumber(value, 'depth');
      rebuild();
    },
    get_depth(): number { return depth; },
    set_margin(value: number): void {
      margin = finiteNumber(value, 'margin');
      rebuild();
    },
    get_margin(): number { return margin; },
    set_disabled(value: boolean): void {
      if (typeof value !== 'boolean') throw new TypeError('CollisionPolygon.disabled requires bool.');
      handle.setEnabled(!value);
    },
    is_disabled(): boolean { return !enabled; },
    isEnabled(): boolean { return enabled; },
    setEnabled(value: boolean): void {
      if (typeof value !== 'boolean') throw new TypeError('CollisionPolygon enabled state requires bool.');
      enabled = value;
      for (const collider of colliders) collider.setEnabled(value);
    },
    release(): void {
      if (released) return;
      released = true;
      removeNative();
    },
  }) as GodotCollisionPolygon3D;
  Object.defineProperties(handle, {
    colliders: { enumerable: false, configurable: true, get: () => colliders },
    polygon: {
      enumerable: true,
      configurable: true,
      get: () => handle.get_polygon(),
      set: (value: Iterable<PolygonPoint2>) => handle.set_polygon(value),
    },
    depth: { enumerable: true, configurable: true, get: () => depth, set: handle.set_depth },
    margin: { enumerable: true, configurable: true, get: () => margin, set: handle.set_margin },
    disabled: { enumerable: true, configurable: true, get: handle.is_disabled, set: handle.set_disabled },
  });
  Reflect.defineProperty(handle, '__syncCollisionPolygon3DTransform', {
    configurable: true,
    value: syncTransform,
  });
  registerGodotObjectIdentity(handle, 'CollisionPolygon');
  rebuild();
  return handle;
}

export function syncCollisionPolygon3DTransform(node: GodotCollisionPolygon3D): void {
  const sync = Reflect.get(node, '__syncCollisionPolygon3DTransform');
  if (typeof sync !== 'function') throw new Error('CollisionPolygon has no retained native binding.');
  Reflect.apply(sync, node, []);
}

export function releaseCollisionPolygon3D(node: GodotCollisionPolygon3D): void {
  node.release();
}
