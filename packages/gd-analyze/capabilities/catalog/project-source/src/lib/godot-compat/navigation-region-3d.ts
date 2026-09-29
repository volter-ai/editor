/**
 * @godot-class NavigationRegion3D
 * @role BINDING
 *
 * Godot 4.7's `NavigationRegion3D` (`scene/3d/navigation/navigation_region_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over three-pathfinding: each enabled region in the
 * tree is a zone of its navigation mesh placed by its global transform, made when a path is first
 * asked for after it changes. A path runs within the zone its start lies in, by three-pathfinding's
 * A* and funnel; Godot's regions join where their edges meet, which separate zones do not.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, Vector3 as ThreeVector3 } from 'three';
import { Pathfinding } from 'three-pathfinding';
import { godot_navigation_mesh_geometry, type NavigationMesh } from './navigation-mesh';
import { godot_node_entity, godot_node_tree_signal, is_inside_tree } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector3, type Vector3 } from './vector3';

interface RegionState {
  mesh: NavigationMesh | null;
  enabled: boolean;
  /** The zone the region is in three-pathfinding under, once made. */
  zone: string | undefined;
}

const REGIONS = new Map<Object3D, RegionState>();
/** The world's zones, one per region. */
const PATHFINDING = new Pathfinding();
let zones = 0;

function stateOf(self: object): RegionState {
  const entity = godot_node_entity(self) as Object3D;
  let state = REGIONS.get(entity);
  if (state === undefined) {
    state = { mesh: null, enabled: true, zone: undefined };
    REGIONS.set(entity, state);
  }
  return state;
}

/** A region's zone again: its mesh or place changed. */
function remake(state: RegionState): void {
  state.zone = undefined;
}

/** The zone of an enabled region in the tree, made from its mesh placed where the region stands. */
function zoneOf(entity: Object3D, state: RegionState): string | undefined {
  if (!state.enabled || state.mesh === null || !is_inside_tree(entity)) return undefined;
  if (state.zone === undefined) {
    entity.updateWorldMatrix(true, false);
    const geometry = godot_navigation_mesh_geometry(state.mesh).clone().applyMatrix4(entity.matrixWorld);
    const zone = `region${String((zones += 1))}`;
    PATHFINDING.setZoneData(zone, Pathfinding.createZone(geometry));
    geometry.dispose();
    state.zone = zone;
  }
  return state.zone;
}

/**
 * The path from `from` to `to` over the regions' meshes: the start, then the points three-pathfinding
 * finds within the zone the start lies in; empty where no region holds the start.
 *
 * @godot NavigationRegion3D (protocol)
 * @source scene/3d/navigation/navigation_agent_3d.cpp:799
 */
export function godot_navigation_path(from: Vector3, to: Vector3): Vector3[] {
  const start = new ThreeVector3(from.x, from.y, from.z);
  const end = new ThreeVector3(to.x, to.y, to.z);
  for (const [entity, state] of REGIONS) {
    const zone = zoneOf(entity, state);
    if (zone === undefined) continue;
    const group = PATHFINDING.getGroup(zone, start);
    if (group === null || group === undefined) continue;
    const found = PATHFINDING.findPath(start, end, zone, group);
    if (found === null || found === undefined || found.length === 0) continue;
    return [vector3(from.x, from.y, from.z), ...found.map((point) => vector3(point.x, point.y, point.z))];
  }
  return [];
}

/**
 * @godot NavigationRegion3D.set_enabled
 * @source scene/3d/navigation/navigation_region_3d.cpp:41
 */
export function set_enabled(self: object, enabled: boolean): void {
  stateOf(self).enabled = enabled;
}

/**
 * @godot NavigationRegion3D.is_enabled
 * @source scene/3d/navigation/navigation_region_3d.cpp:77
 */
export function is_enabled(self: object): boolean {
  return stateOf(self).enabled;
}

/**
 * @godot NavigationRegion3D.set_navigation_mesh
 * @source scene/3d/navigation/navigation_region_3d.cpp:186
 */
export function set_navigation_mesh(self: object, navigation_mesh: NavigationMesh | null): void {
  const state = stateOf(self);
  state.mesh = navigation_mesh;
  remake(state);
}

/**
 * @godot NavigationRegion3D.get_navigation_mesh
 * @source scene/3d/navigation/navigation_region_3d.cpp:200
 */
export function get_navigation_mesh(self: object): NavigationMesh | null {
  return stateOf(self).mesh;
}

const NAVIGATION_REGION_3D = {
  create: () => new Group(),
  spatial: true,
  mount: (entity: Object3D) => {
    stateOf(entity);
    // A region leaving the tree leaves the world's map, and comes back placed anew.
    godot_node_tree_signal(entity, 'tree_exiting').connect(() => remake(stateOf(entity)));
  },
  props: new Map<string, GodotElementProp<Object3D>>([
    ['navigationMesh', (entity, value: NavigationMesh | null) => set_navigation_mesh(entity, value)],
    ['enabled', (entity, value: boolean) => set_enabled(entity, value)],
  ]),
};

/**
 * A NavigationRegion3D as a scene writes it: `<GodotNavigationRegion3D navigationMesh={mesh}>…</GodotNavigationRegion3D>`.
 *
 * @godot NavigationRegion3D (protocol)
 * @source scene/3d/navigation/navigation_region_3d.cpp:426
 */
export function GodotNavigationRegion3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(NAVIGATION_REGION_3D, props);
}
