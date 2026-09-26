import RAPIER from '@dimforge/rapier2d-compat';
import { Container } from 'pixi.js';
import type { CollisionLayers } from './collision-layers';
import type { GodotColliderLookup, GodotColliderOwner } from './collider-registry';
import { registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';
import { physicsRid2DOf, registerPhysicsArea2D, unregisterPhysicsArea2D } from './physics-query-2d';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

interface Area2DBodyQuery {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly sensors: readonly RAPIER.Collider[];
  readonly shapes: RAPIER.Collider[][];
  readonly bodies: GodotColliderLookup<RAPIER.Collider, GodotColliderOwner>;
  readonly areas: ReadonlyMap<RAPIER.Collider, { readonly node?: object }>;
  readonly layers: CollisionLayers;
}

/**
 * The two independent PhysicsServer2D flags owned by an Area2D.
 *
 * Godot's Area2D keeps `monitoring` (this Area reports overlaps) separate from `monitorable`
 * (other monitoring Areas may report this Area). Neither flag disables or removes a shape. The
 * translated scene therefore keeps the flags on the retained Pixi node and lets the native Rapier
 * overlap walk consult them at the same boundary where Godot installs/removes monitor callbacks.
 */
export interface Area2DMonitoringState {
  monitoring: boolean;
  monitorable: boolean;
  bodyQuery?: Area2DBodyQuery;
  readonly bodyEntered: SignalHandle<readonly [unknown]>;
  readonly bodyExited: SignalHandle<readonly [unknown]>;
  readonly bodyShapeEntered: SignalHandle<readonly [unknown, unknown, number, number]>;
  readonly bodyShapeExited: SignalHandle<readonly [unknown, unknown, number, number]>;
  readonly areaEntered: SignalHandle<readonly [unknown]>;
  readonly areaExited: SignalHandle<readonly [unknown]>;
  readonly overlappingBodies: Set<unknown>;
  readonly overlappingBodyShapes: Map<string, readonly [unknown, unknown, number, number]>;
  readonly overlappingAreas: Set<unknown>;
}

const AREA_STATE = new WeakMap<object, Area2DMonitoringState>();

interface ConstructedArea2D {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly areas: Map<RAPIER.Collider, { readonly node?: object }>;
  unregisterRelease(): void;
}

const CONSTRUCTED_AREAS = new WeakMap<object, ConstructedArea2D>();

export interface Area2DConstructorOptions {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly bodies: GodotColliderLookup<RAPIER.Collider, GodotColliderOwner>;
  readonly areas: Map<RAPIER.Collider, { readonly node?: object }>;
}

/**
 * Runtime `Area2D.new()` owns a fixed Rapier body and a disabled zero-radius sensor. Godot's empty
 * Area has no shapes and therefore detects nothing; retaining a disabled native sensor seats the
 * exact body/query identity so later CollisionShape attachment can replace that empty carrier.
 */
export function createGodotArea2D(options: Area2DConstructorOptions): Container {
  const area = new Container();
  registerGodotObjectIdentity(area, 'Area2D');
  const body = options.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const collider = options.world.createCollider(
    RAPIER.ColliderDesc.ball(Number.EPSILON).setSensor(true),
    body,
  );
  collider.setEnabled(false);
  options.layers.set(collider, 1, 1);
  bindArea2DMonitoring(area);
  options.areas.set(collider, { node: area });
  bindArea2DBodyQuery(area, {
    world: options.world,
    body,
    sensors: [collider],
    shapes: [[collider]],
    bodies: options.bodies,
    areas: options.areas,
    layers: options.layers,
  });
  const state: ConstructedArea2D = {
    world: options.world,
    body,
    collider,
    areas: options.areas,
    unregisterRelease: () => {},
  };
  CONSTRUCTED_AREAS.set(area, state);
  state.unregisterRelease = registerCanvasNodeRelease(area, () => releaseArea2DMonitoring(area));
  return area;
}

function stateOf(area: object): Area2DMonitoringState {
  const state = AREA_STATE.get(area);
  if (state === undefined) {
    throw new Error(
      `Area2D monitoring state was read before bindArea2DMonitoring() installed the retained node`,
    );
  }
  return state;
}

/** Bind authored Area2D flags to the retained Pixi identity. Godot defaults both flags to true. */
export function bindArea2DMonitoring(
  area: object,
  authored: Readonly<Partial<Area2DMonitoringState>> = {},
): Area2DMonitoringState {
  if (AREA_STATE.has(area)) {
    throw new Error('bindArea2DMonitoring() received an Area2D node that is already bound');
  }
  const state = {
    monitoring: authored.monitoring ?? true,
    monitorable: authored.monitorable ?? true,
    bodyEntered: createSignal<readonly [unknown]>(),
    bodyExited: createSignal<readonly [unknown]>(),
    bodyShapeEntered: createSignal<readonly [unknown, unknown, number, number]>(),
    bodyShapeExited: createSignal<readonly [unknown, unknown, number, number]>(),
    areaEntered: createSignal<readonly [unknown]>(),
    areaExited: createSignal<readonly [unknown]>(),
    overlappingBodies: new Set<unknown>(),
    overlappingBodyShapes: new Map<string, readonly [unknown, unknown, number, number]>(),
    overlappingAreas: new Set<unknown>(),
  };
  AREA_STATE.set(area, state);
  return state;
}

/** Release a scene-owned binding without retaining a parallel node or scene registry. */
export function releaseArea2DMonitoring(area: object): void {
  unregisterPhysicsArea2D(area);
  const constructed = CONSTRUCTED_AREAS.get(area);
  if (constructed !== undefined) {
    CONSTRUCTED_AREAS.delete(area);
    constructed.unregisterRelease();
    constructed.areas.delete(constructed.collider);
    constructed.world.removeRigidBody(constructed.body);
  }
  AREA_STATE.delete(area);
}

/** `Area2D.monitoring` / `is_monitoring()`. */
export function isMonitoring2D(area: object): boolean {
  return stateOf(area).monitoring;
}

/** `Area2D.monitoring = value` / `set_monitoring(value)`. */
export function setMonitoring2D(area: object, value: boolean): void {
  if (typeof value !== 'boolean') throw new Error('Area2D.monitoring must be boolean');
  stateOf(area).monitoring = value;
}

/** `Area2D.monitorable` / `is_monitorable()`. */
export function isMonitorable2D(area: object): boolean {
  return stateOf(area).monitorable;
}

/** `Area2D.monitorable = value` / `set_monitorable(value)`. */
export function setMonitorable2D(area: object, value: boolean): void {
  if (typeof value !== 'boolean') throw new Error('Area2D.monitorable must be boolean');
  stateOf(area).monitorable = value;
}

/** Attach this Area's native sensors and the translated body's owner registry after construction. */
export function bindArea2DBodyQuery(
  area: object,
  query: Area2DBodyQuery,
): void {
  const state = stateOf(area);
  if (state.bodyQuery !== undefined) {
    throw new Error('bindArea2DBodyQuery() received an Area2D whose query is already bound');
  }
  registerPhysicsArea2D({ node: area, sceneOwned: true, world: query.world, body: query.body, shapes: query.shapes });
  state.bodyQuery = query;
}

/**
 * `Area2D.get_overlapping_bodies()` from the same native sensor/body registry that emits overlap
 * signals. The asker's mask is tested against each body's layer in one direction, then every
 * enabled sensor participates; owners are returned once in registry order even when they own
 * multiple colliders or overlap multiple Area shapes.
 */
export function getOverlappingBodies2D<T>(area: object): T[] {
  const state = stateOf(area);
  if (!state.monitoring) {
    throw new Error(
      `Area2D.get_overlapping_bodies(): Can't find overlapping bodies when monitoring is off.`,
    );
  }
  const query = state.bodyQuery;
  if (query === undefined) {
    throw new Error('Area2D.get_overlapping_bodies() was called before its native query was bound');
  }
  const askingSensor = query.sensors.find((sensor) => sensor.isEnabled());
  if (askingSensor === undefined) return [];
  const result = new Set<T>();
  for (const [collider, owner] of query.bodies) {
    if (!collider.isEnabled()) continue;
    if ((query.layers.layerOf(collider) & query.layers.maskOf(askingSensor)) === 0) continue;
    if (
      !query.sensors.some(
        (sensor) =>
          sensor.isEnabled() &&
          collider.intersectsShape(sensor.shape, sensor.translation(), sensor.rotation()),
      )
    ) {
      continue;
    }
    result.add(owner as T);
  }
  return [...result];
}

/** `Area2D.body_entered`, owned by the same retained Area state as overlap queries. */
export function getArea2DBodyEnteredSignal(area: object): GodotSignal<readonly [unknown]> {
  return stateOf(area).bodyEntered.signal;
}

/** `Area2D.body_exited`, paired with body_entered on the same native overlap edge set. */
export function getArea2DBodyExitedSignal(area: object): GodotSignal<readonly [unknown]> {
  return stateOf(area).bodyExited.signal;
}

/** Shape-granular overlap edges carry Godot's body RID, body owner, body shape, and local shape. */
export function getArea2DBodyShapeEnteredSignal(
  area: object,
): GodotSignal<readonly [unknown, unknown, number, number]> {
  return stateOf(area).bodyShapeEntered.signal;
}

export function getArea2DBodyShapeExitedSignal(
  area: object,
): GodotSignal<readonly [unknown, unknown, number, number]> {
  return stateOf(area).bodyShapeExited.signal;
}

export function getArea2DAreaEnteredSignal(area: object): GodotSignal<readonly [unknown]> {
  return stateOf(area).areaEntered.signal;
}

export function getArea2DAreaExitedSignal(area: object): GodotSignal<readonly [unknown]> {
  return stateOf(area).areaExited.signal;
}

/** Refresh native overlap edges once per fixed step and emit each newly entered body. */
export function advanceArea2DBodySignals2D(area: object): void {
  const state = stateOf(area);
  if (!state.monitoring) {
    for (const body of state.overlappingBodies) state.bodyExited.emit(body);
    for (const edge of state.overlappingBodyShapes.values()) state.bodyShapeExited.emit(...edge);
    for (const areaNode of state.overlappingAreas) state.areaExited.emit(areaNode);
    state.overlappingBodies.clear();
    state.overlappingBodyShapes.clear();
    state.overlappingAreas.clear();
    return;
  }
  const current = new Set<unknown>(getOverlappingBodies2D(area));
  for (const body of state.overlappingBodies) {
    if (!current.has(body)) state.bodyExited.emit(body);
  }
  for (const body of current) {
    if (!state.overlappingBodies.has(body)) state.bodyEntered.emit(body);
  }
  state.overlappingBodies.clear();
  for (const body of current) state.overlappingBodies.add(body);

  const query = state.bodyQuery;
  const currentShapes = new Map<string, readonly [unknown, unknown, number, number]>();
  if (query !== undefined) {
    for (let localShape = 0; localShape < query.shapes.length; localShape += 1) {
      for (const sensor of query.shapes[localShape] ?? []) {
        if (!sensor.isEnabled()) continue;
        for (const [collider, owner] of query.bodies) {
          if (!collider.isEnabled()) continue;
          if ((query.layers.layerOf(collider) & query.layers.maskOf(sensor)) === 0) continue;
          if (!collider.intersectsShape(sensor.shape, sensor.translation(), sensor.rotation())) continue;
          const body = collider.parent();
          if (body === null) continue;
          let bodyShape = 0;
          for (; bodyShape < body.numColliders(); bodyShape += 1) {
            if (body.collider(bodyShape).handle === collider.handle) break;
          }
          if (bodyShape >= body.numColliders()) continue;
          currentShapes.set(
            `${localShape}:${collider.handle}`,
            [physicsRid2DOf(collider), owner, bodyShape, localShape],
          );
        }
      }
    }
  }
  for (const [key, edge] of state.overlappingBodyShapes) {
    if (!currentShapes.has(key)) state.bodyShapeExited.emit(...edge);
  }
  for (const [key, edge] of currentShapes) {
    if (!state.overlappingBodyShapes.has(key)) state.bodyShapeEntered.emit(...edge);
  }
  state.overlappingBodyShapes.clear();
  for (const [key, edge] of currentShapes) state.overlappingBodyShapes.set(key, edge);
  const currentAreas = new Set<unknown>(getOverlappingAreas2D(area));
  for (const areaNode of state.overlappingAreas) {
    if (!currentAreas.has(areaNode)) state.areaExited.emit(areaNode);
  }
  for (const areaNode of currentAreas) {
    if (!state.overlappingAreas.has(areaNode)) state.areaEntered.emit(areaNode);
  }
  state.overlappingAreas.clear();
  for (const areaNode of currentAreas) state.overlappingAreas.add(areaNode);
}

/** `Area2D.get_overlapping_areas()` over the real sensor registry, preserving retained nodes. */
export function getOverlappingAreas2D<T>(area: object): T[] {
  const state = stateOf(area);
  if (!state.monitoring) throw new Error(`Area2D.get_overlapping_areas(): Can't find overlapping areas when monitoring is off.`);
  const query = state.bodyQuery;
  if (query === undefined) throw new Error('Area2D.get_overlapping_areas() was called before its native query was bound');
  const askingSensor = query.sensors.find((sensor) => sensor.isEnabled());
  if (askingSensor === undefined) return [];
  const result = new Set<T>();
  for (const [collider, owner] of query.areas) {
    if (query.sensors.includes(collider) || !collider.isEnabled() || owner.node === undefined) continue;
    if (!isMonitorable2D(owner.node)) continue;
    if ((query.layers.layerOf(collider) & query.layers.maskOf(askingSensor)) === 0) continue;
    if (!query.sensors.some((sensor) => sensor.isEnabled() && collider.intersectsShape(sensor.shape, sensor.translation(), sensor.rotation()))) continue;
    result.add(owner.node as T);
  }
  return [...result];
}
