/**
 * `Area3D.monitoring` — the flag that decides whether an `Area` REPORTS the bodies overlapping it.
 *
 * ## What Godot's `monitoring` is, and what it is NOT
 *
 * The pinned 4.7 dump (`vendor/extension-api/godot-4.7-extension_api.json`, header
 * `4.7.stable.official`) declares `Area3D` — inheriting `CollisionObject3D` — with TWO adjacent
 * boolean properties, and telling them apart is the whole of this file's correctness:
 *
 *  - `{"type":"bool","name":"monitoring","setter":"set_monitoring","getter":"is_monitoring"}`
 *  - `{"type":"bool","name":"monitorable","setter":"set_monitorable","getter":"is_monitorable"}`
 *
 * `monitoring` is the AREA'S OWN detection: with it off, this area stops reporting what is inside
 * it — the dump's own neighbouring surface is the set that goes quiet (`body_entered`/`body_exited`
 * and their `_shape_` variants, `get_overlapping_bodies`, `has_overlapping_bodies`,
 * `overlaps_body`, and the `area_` half of each). `monitorable` is the OPPOSITE direction: whether
 * OTHER monitoring areas can detect THIS one. Neither of them is `CollisionShape3D.disabled`, which
 * removes the shape itself.
 *
 * That distinction is why this ships as its own flag rather than as a second caller of
 * `physics-2d.ts`'s `setDisabled`. Disabling the collider would be one line and would look right on
 * `starter-kit-3d-platformer`'s brick — where nothing else can observe the difference — and it
 * would be wrong the first time a port authors a `monitorable` area, an area gravity override, or a
 * second area querying the first. This lane's rule is that a member is modelled or refused, never
 * approximated onto a neighbour that happens to agree on one fixture.
 *
 * ## How "stops reporting" is reproduced here
 *
 * Godot implements `set_monitoring(false)` in the PHYSICS SERVER: it clears the area's monitor
 * callback, so the server stops handing this area its overlap pairs, and it drops the pairs it was
 * already holding. This port has no monitor callback — it has a per-fixed-step SHAPE QUERY
 * (`godotAreaOverlappingBodies`, `kinematic-body-3d.ts`) that the emitted scene poses once per step
 * — so the same fact is reproduced at the same place: with monitoring off, the query reports
 * NOTHING, exactly as a server with no callback hands over nothing.
 *
 * The dropped-pairs half falls out of that rather than needing code. The emitted scene holds the
 * set of bodies that were inside as of the last step and fires `body_entered` on each body's ENTER
 * EDGE (`gd-analyze translate/scene-module-3d.ts`, `areaMonitorStatements`). An empty report makes
 * that set empty on the next step, which IS Godot dropping its pairs — and it gives the re-enable
 * behaviour for free: a body that never left is a fresh enter when monitoring comes back on, which
 * is what Godot does too, because its own maps were cleared while the callback was gone.
 *
 * ## The initial value is the lane's own shipped behaviour, not a default read off a dump
 *
 * `extension_api.json` carries no property defaults, so "monitoring starts true" is NOT a citation
 * this file can make from the pin. It does not have to: {@link createAreaMonitoring3D} opens
 * MONITORING because that is precisely the behaviour every emitted port already had before this
 * file existed — the per-step query ran unconditionally for every `Area`, and that emission is
 * verified running by the ladder's S4 rung on `platformer-3d` (whose coins are `Area` roots
 * collected through this very query). So the flag preserves the measured status quo and adds the
 * one transition a script asks for; it does not introduce a default.
 *
 * A `.tscn` that AUTHORS `monitoring` is a different question and is not answered here — the
 * emitter refuses it by name rather than seeding this record from a value nothing measured.
 */

/**
 * An `Area`'s two independent overlap-reporting flags.
 *
 * A record rather than booleans because the emitted scene and PhysicsServer hand the same retained
 * state to per-step queries and script writes; copied primitive flags would diverge immediately.
 */
export interface AreaMonitoring3D {
  /** `is_monitoring()` — true while this area reports what overlaps it. */
  monitoring: boolean;
  /** `is_monitorable()` — true while other monitoring Areas may report this Area. */
  monitorable: boolean;
}

/**
 * The body-level half of Godot's Area monitor map.
 *
 * Godot's physics server reports shape-pair edges, while `Area` retains a reference count per
 * body and emits `body_entered` for its first pair and `body_exited` for its last pair. The Rapier
 * query used by imported scenes returns the currently intersecting collider owners instead, so
 * this retained set is the equivalent body map. It deliberately stores the exact collider owner
 * objects supplied by the shared physics world; it never manufactures or mirrors a body.
 */
export interface AreaBodyMonitor3D<T extends object> {
  readonly bodies: Set<T>;
}

/** A fresh Area has no retained overlaps. */
export function createAreaBodyMonitor3D<T extends object>(): AreaBodyMonitor3D<T> {
  return { bodies: new Set<T>() };
}

export interface AreaBodyMonitorCallbacks3D<T extends object> {
  /** The first overlapping shape pair for this body appeared. */
  readonly entered?: (body: T) => void | boolean;
  /** The last overlapping shape pair for this body disappeared. */
  readonly exited?: (body: T) => void | boolean;
}

/**
 * Apply one native fixed-step overlap snapshot to an Area's retained body map.
 *
 * Multiple Rapier colliders (and multiple local Area shapes) can name the same Godot body. The
 * `Set` collapses those shape pairs by exact retained owner identity, so replacing one overlapping
 * pair with another produces no body-level edge. State is installed before callbacks, matching
 * Godot's `_body_inout`: an exit removes the final body-map entry before `body_exited`, and an
 * enter inserts it before `body_entered`.
 */
export function advanceAreaBodyMonitor3D<T extends object>(
  monitor: AreaBodyMonitor3D<T>,
  overlappingShapeOwners: Iterable<T>,
  callbacks: AreaBodyMonitorCallbacks3D<T>,
): void {
  const next = new Set(overlappingShapeOwners);
  const exited: T[] = [];
  const entered: T[] = [];
  for (const body of monitor.bodies) if (!next.has(body)) exited.push(body);
  for (const body of next) if (!monitor.bodies.has(body)) entered.push(body);

  // Install unchanged pairs first. Edges are then applied one at a time because a callback may
  // queue-free the Area or change its monitor state. Returning false leaves every not-yet-delivered
  // edge pending for the next native snapshot rather than silently consuming it.
  monitor.bodies.clear();
  for (const body of next) if (!entered.includes(body)) monitor.bodies.add(body);
  for (let index = 0; index < exited.length; index += 1) {
    const body = exited[index] as T;
    if (callbacks.exited?.(body) === false) {
      for (let rest = index + 1; rest < exited.length; rest += 1) {
        monitor.bodies.add(exited[rest] as T);
      }
      return;
    }
  }
  for (const body of entered) {
    monitor.bodies.add(body);
    if (callbacks.entered?.(body) === false) return;
  }
}

/**
 * Drop every retained pair when monitoring is disabled or the Area leaves the tree.
 *
 * Godot clears its body map before emitting the corresponding exits. Keeping this separate from
 * disposal lets an emitted scene use it both for a false `monitoring` snapshot and for tree-exit
 * cleanup, while preserving the exact retained body identities in the callbacks.
 */
export function clearAreaBodyMonitor3D<T extends object>(
  monitor: AreaBodyMonitor3D<T>,
  exited?: (body: T) => void,
): void {
  const bodies = [...monitor.bodies];
  monitor.bodies.clear();
  if (exited !== undefined) for (const body of bodies) exited(body);
}

/** A fresh Area is both monitoring and monitorable, matching the retained scene/server defaults. */
export function createAreaMonitoring3D(): AreaMonitoring3D {
  return { monitoring: true, monitorable: true };
}

/** `area.monitoring` / `area.is_monitoring()`. */
export function isMonitoring3D(area: AreaMonitoring3D): boolean {
  return area.monitoring;
}

/**
 * `area.monitoring = enable` / `area.set_monitoring(enable)`.
 *
 * Godot forbids this write from INSIDE an area's own in/out signal — `set_monitoring` fails with
 * "Use set_deferred(...)" while the area is locked — which is why the measured call site
 * (`starter-kit-3d-platformer` `objects/brick.gd:29`) spells it
 * `bottom_detector.set_deferred("monitoring", false)` from within its `body_entered` handler. That
 * deferral is `deferred.ts`'s end-of-frame queue on this port and is the CALLER's, not this
 * function's: a setter that deferred itself would also defer the direct writes other games make
 * (`rota` `Player.gd:207` is a plain `arrow.monitoring = false`), which Godot applies immediately.
 */
export function setMonitoring3D(area: AreaMonitoring3D, enable: boolean): void {
  if (typeof enable !== 'boolean') throw new TypeError('Area.monitoring must be boolean');
  area.monitoring = enable;
}

/** `area.monitorable` / `area.is_monitorable()`. This is deliberately independent of monitoring. */
export function isMonitorable3D(area: AreaMonitoring3D): boolean {
  return area.monitorable;
}

/** `area.monitorable = enable` / `area.set_monitorable(enable)`. */
export function setMonitorable3D(area: AreaMonitoring3D, enable: boolean): void {
  if (typeof enable !== 'boolean') throw new TypeError('Area.monitorable must be boolean');
  area.monitorable = enable;
}
