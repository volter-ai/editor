/**
 * Physics cases build collision objects with shapes under the SceneTree, step physics frames, and
 * read queries. The native side runs GDScript in the official binary (GodotPhysics3D, the pinned
 * default engine) at a fixed 60 Hz; the target side builds the same nodes as three objects, hands a
 * Rapier world to `world-3d.ts`, and drives `scene-tree.ts`'s clock, whose physics steps sync and
 * step that world.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { Group, Object3D, Scene } from 'three';
import * as BOX from '../../capabilities/catalog/project-source/src/lib/godot-compat/box-shape-3d';
import * as CAP from '../../capabilities/catalog/project-source/src/lib/godot-compat/capsule-shape-3d';
import * as CO from '../../capabilities/catalog/project-source/src/lib/godot-compat/collision-object-3d';
import * as CS from '../../capabilities/catalog/project-source/src/lib/godot-compat/collision-shape-3d';
import * as CONCAVE from '../../capabilities/catalog/project-source/src/lib/godot-compat/concave-polygon-shape-3d';
import * as CONVEX from '../../capabilities/catalog/project-source/src/lib/godot-compat/convex-polygon-shape-3d';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as N3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-3d';
import * as DSS from '../../capabilities/catalog/project-source/src/lib/godot-compat/physics-direct-space-state-3d';
import * as RQ from '../../capabilities/catalog/project-source/src/lib/godot-compat/physics-ray-query-parameters-3d';
import * as PS from '../../capabilities/catalog/project-source/src/lib/godot-compat/physics-server-3d';
import * as RC from '../../capabilities/catalog/project-source/src/lib/godot-compat/ray-cast-3d';
import * as SPHERE from '../../capabilities/catalog/project-source/src/lib/godot-compat/sphere-shape-3d';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import * as W from '../../capabilities/catalog/project-source/src/lib/godot-compat/world-3d';
import { gd, gs } from './literals';

await RAPIER.init();

export type Triple = readonly [number, number, number];

export type Shape =
  | { readonly box: Triple }
  | { readonly sphere: number }
  | { readonly capsule: readonly [number, number] }
  | { readonly convex: readonly Triple[] }
  | { readonly concave: readonly Triple[]; readonly backface?: boolean };

export type Op =
  | {
      readonly body: string;
      readonly kind: 'static' | 'area' | 'character' | 'rigid';
      readonly parent?: string;
      readonly shapes: readonly { readonly shape: Shape; readonly at?: Triple; readonly rotation?: Triple; readonly disabled?: boolean }[];
      readonly at?: Triple;
      readonly rotation?: Triple;
      readonly layer?: number;
      readonly mask?: number;
    }
  | { readonly raycast: string; readonly parent?: string; readonly at?: Triple; readonly target?: Triple; readonly mask?: number; readonly areas?: boolean; readonly excludeParent?: boolean }
  | { readonly move: string; readonly at: Triple }
  | { readonly layer: string; readonly value: number }
  | { readonly mask: string; readonly value: number }
  | { readonly layerBit: string; readonly bit: number; readonly on: boolean }
  | { readonly disable: string; readonly index: number; readonly on: boolean }
  | { readonly remove: string }
  | { readonly read: Read };

export type Read =
  | readonly ['ray', Triple, Triple, { readonly mask?: number; readonly exclude?: readonly string[]; readonly areas?: boolean; readonly bodies?: boolean; readonly inside?: boolean; readonly backFaces?: boolean }?]
  | readonly ['raycast', string]
  | readonly ['layer', string]
  | readonly ['mask', string]
  | readonly ['layerBit', string, number]
  | readonly ['maskBit', string, number];

export interface Segment {
  readonly await?: 'process' | 'physics';
  readonly ops: readonly Op[];
}

const DT = 1 / 60;
const v = (tag: string): string => `n_${tag}`;
const gv = ([x, y, z]: Triple): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;
const CLASSES = { static: 'StaticBody3D', area: 'Area3D', character: 'CharacterBody3D', rigid: 'RigidBody3D' } as const;

function gdShape(name: string, shape: Shape): string[] {
  if ('box' in shape) return [`var ${name} := BoxShape3D.new()`, `${name}.size = ${gv(shape.box)}`];
  if ('sphere' in shape) return [`var ${name} := SphereShape3D.new()`, `${name}.radius = ${gd(shape.sphere)}`];
  if ('capsule' in shape) {
    return [`var ${name} := CapsuleShape3D.new()`, `${name}.radius = ${gd(shape.capsule[0])}`, `${name}.height = ${gd(shape.capsule[1])}`];
  }
  const points = `PackedVector3Array([${('convex' in shape ? shape.convex : shape.concave).map(gv).join(', ')}])`;
  return 'convex' in shape
    ? [`var ${name} := ConvexPolygonShape3D.new()`, `${name}.points = ${points}`]
    : [
        `var ${name} := ConcavePolygonShape3D.new()`,
        `${name}.set_faces(${points})`,
        ...('concave' in shape && shape.backface === true ? [`${name}.backface_collision = true`] : []),
      ];
}

function jsShape(shape: Shape): object {
  if ('box' in shape) {
    const s = BOX.construct();
    BOX.set_size(s, V.construct(...shape.box));
    return s;
  }
  if ('sphere' in shape) {
    const s = SPHERE.construct();
    SPHERE.set_radius(s, shape.sphere);
    return s;
  }
  if ('capsule' in shape) {
    const s = CAP.construct();
    CAP.set_radius(s, shape.capsule[0]);
    CAP.set_height(s, shape.capsule[1]);
    return s;
  }
  if ('convex' in shape) {
    const s = CONVEX.construct();
    CONVEX.set_points(s, shape.convex.map((p) => V.construct(...p)));
    return s;
  }
  const s = CONCAVE.construct();
  CONCAVE.set_faces(s, shape.concave.map((p) => V.construct(...p)));
  if (shape.backface === true) CONCAVE.set_backface_collision_enabled(s, true);
  return s;
}

function gdRead(read: Read): string[] {
  switch (read[0]) {
    case 'ray': {
      const [, from, to, options = {}] = read;
      const exclude = (options.exclude ?? []).map((tag) => `${v(tag)}.get_rid()`).join(', ');
      return [
        `q = PhysicsRayQueryParameters3D.create(${gv(from)}, ${gv(to)}${options.mask === undefined ? '' : `, ${String(options.mask)}`}${exclude === '' ? '' : `${options.mask === undefined ? ', 4294967295' : ''}, [${exclude}]`})`,
        ...(options.areas === undefined ? [] : [`q.collide_with_areas = ${String(options.areas)}`]),
        ...(options.bodies === undefined ? [] : [`q.collide_with_bodies = ${String(options.bodies)}`]),
        ...(options.inside === undefined ? [] : [`q.hit_from_inside = ${String(options.inside)}`]),
        ...(options.backFaces === undefined ? [] : [`q.hit_back_faces = ${String(options.backFaces)}`]),
        'log.append(_hit(PhysicsServer3D.space_get_direct_state(get_root().find_world_3d().space).intersect_ray(q)))',
      ];
    }
    case 'raycast':
      return [`log.append(_raycast(${v(read[1])}))`];
    case 'layer':
      return [`log.append(${v(read[1])}.get_collision_layer())`];
    case 'mask':
      return [`log.append(${v(read[1])}.get_collision_mask())`];
    case 'layerBit':
      return [`log.append(${v(read[1])}.get_collision_layer_value(${String(read[2])}))`];
    case 'maskBit':
      return [`log.append(${v(read[1])}.get_collision_mask_value(${String(read[2])}))`];
    default:
      return read satisfies never;
  }
}

let shapeNumber = 0;

function gdOp(op: Op): string[] {
  if ('body' in op) {
    const lines = [`var ${v(op.body)} := ${CLASSES[op.kind]}.new()`, `${v(op.body)}.name = ${gs(op.body)}`];
    for (const entry of op.shapes) {
      const cs = `cs${String((shapeNumber += 1))}`;
      lines.push(...gdShape(`${cs}_shape`, entry.shape), `var ${cs} := CollisionShape3D.new()`, `${cs}.shape = ${cs}_shape`);
      if (entry.at !== undefined) lines.push(`${cs}.position = ${gv(entry.at)}`);
      if (entry.rotation !== undefined) lines.push(`${cs}.rotation = ${gv(entry.rotation)}`);
      if (entry.disabled === true) lines.push(`${cs}.disabled = true`);
      lines.push(`${v(op.body)}.add_child(${cs})`);
    }
    if (op.at !== undefined) lines.push(`${v(op.body)}.position = ${gv(op.at)}`);
    if (op.rotation !== undefined) lines.push(`${v(op.body)}.rotation = ${gv(op.rotation)}`);
    if (op.layer !== undefined) lines.push(`${v(op.body)}.collision_layer = ${String(op.layer)}`);
    if (op.mask !== undefined) lines.push(`${v(op.body)}.collision_mask = ${String(op.mask)}`);
    lines.push(`${op.parent === undefined ? 'holder' : v(op.parent)}.add_child(${v(op.body)})`);
    return lines;
  }
  if ('raycast' in op) {
    const lines = [`var ${v(op.raycast)} := RayCast3D.new()`];
    if (op.at !== undefined) lines.push(`${v(op.raycast)}.position = ${gv(op.at)}`);
    if (op.target !== undefined) lines.push(`${v(op.raycast)}.target_position = ${gv(op.target)}`);
    if (op.mask !== undefined) lines.push(`${v(op.raycast)}.collision_mask = ${String(op.mask)}`);
    if (op.areas !== undefined) lines.push(`${v(op.raycast)}.collide_with_areas = ${String(op.areas)}`);
    if (op.excludeParent !== undefined) lines.push(`${v(op.raycast)}.exclude_parent = ${String(op.excludeParent)}`);
    lines.push(`${op.parent === undefined ? 'holder' : v(op.parent)}.add_child(${v(op.raycast)})`);
    return lines;
  }
  if ('move' in op) return [`${v(op.move)}.position = ${gv(op.at)}`];
  if ('layer' in op) return [`${v(op.layer)}.set_collision_layer(${String(op.value)})`];
  if ('mask' in op) return [`${v(op.mask)}.set_collision_mask(${String(op.value)})`];
  if ('layerBit' in op) return [`${v(op.layerBit)}.set_collision_layer_value(${String(op.bit)}, ${String(op.on)})`];
  if ('disable' in op) return [`${v(op.disable)}.get_child(${String(op.index)}).set_disabled(${String(op.on)})`];
  if ('remove' in op) return [`${v(op.remove)}.get_parent().remove_child(${v(op.remove)})`];
  return gdRead(op.read);
}

export const PHYSICS_PROBE_HELPERS = `
func _hit(d: Dictionary) -> Variant:
\tif d.is_empty():
\t\treturn null
\treturn [d.position, d.normal, String(d.collider.name), d.shape, d.face_index]

func _raycast(r: RayCast3D) -> Variant:
\tif not r.is_colliding():
\t\treturn [false]
\treturn [true, r.get_collision_point(), r.get_collision_normal(), String(r.get_collider().name), r.get_collider_shape()]
`;

function gdscript(segments: readonly Segment[]): string {
  const lines = ['var log: Array = []', 'var q: PhysicsRayQueryParameters3D'];
  for (const segment of segments) {
    if (segment.await !== undefined) lines.push(segment.await === 'physics' ? 'await physics_frame' : 'await process_frame');
    for (const op of segment.ops) lines.push(...gdOp(op));
  }
  lines.push('await process_frame', 'return log.duplicate()');
  return lines.join('\n');
}

function target(segments: readonly Segment[]): () => unknown {
  return () => {
    const log: unknown[] = [];
    const world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
    W.godot_world_3d_attach(world);
    const root = new Scene();
    ST.godot_tree_set_root(root);
    const tree = ST.godot_tree();
    const holder = new Group();
    N.godot_node_adopt(holder, { kind: 'node' });
    N.add_child(root, holder);
    const nodes = new Map<string, Object3D>();
    const node = (tag: string): Object3D => nodes.get(tag) as Object3D;
    const hit = (d: Map<string, unknown>): unknown =>
      d.size === 0 ? null : [d.get('position'), d.get('normal'), N.get_name(d.get('collider') as object), d.get('shape'), d.get('face_index')];
    const read = (r: Read): void => {
      switch (r[0]) {
        case 'ray': {
          const [, from, to, options = {}] = r;
          const q = RQ.create(V.construct(...from), V.construct(...to), options.mask ?? 0xffffffff, (options.exclude ?? []).map((tag) => CO.get_rid(node(tag))));
          if (options.areas !== undefined) RQ.set_collide_with_areas(q, options.areas);
          if (options.bodies !== undefined) RQ.set_collide_with_bodies(q, options.bodies);
          if (options.inside !== undefined) RQ.set_hit_from_inside(q, options.inside);
          if (options.backFaces !== undefined) RQ.set_hit_back_faces(q, options.backFaces);
          log.push(hit(DSS.intersect_ray(PS.space_get_direct_state(W.get_space(W.godot_world_3d())), q)));
          return;
        }
        case 'raycast': {
          const ray = node(r[1]);
          log.push(
            RC.is_colliding(ray)
              ? [true, RC.get_collision_point(ray), RC.get_collision_normal(ray), N.get_name(RC.get_collider(ray) as object), RC.get_collider_shape(ray)]
              : [false],
          );
          return;
        }
        case 'layer':
          log.push(CO.get_collision_layer(node(r[1])));
          return;
        case 'mask':
          log.push(CO.get_collision_mask(node(r[1])));
          return;
        case 'layerBit':
          log.push(CO.get_collision_layer_value(node(r[1]), r[2]));
          return;
        case 'maskBit':
          log.push(CO.get_collision_mask_value(node(r[1]), r[2]));
          return;
        default:
          r satisfies never;
      }
    };
    const run = (op: Op): void => {
      if ('body' in op) {
        const body = new Object3D();
        body.name = op.body;
        CO.godot_collision_object_adopt(body, op.kind);
        for (const entry of op.shapes) {
          const cs = new Object3D();
          CS.godot_collision_shape_3d_adopt(cs);
          CS.set_shape(cs, jsShape(entry.shape));
          if (entry.at !== undefined) N3.set_position(cs, V.construct(...entry.at));
          if (entry.rotation !== undefined) N3.set_rotation(cs, V.construct(...entry.rotation));
          if (entry.disabled === true) CS.set_disabled(cs, true);
          N.add_child(body, cs);
        }
        if (op.at !== undefined) N3.set_position(body, V.construct(...op.at));
        if (op.rotation !== undefined) N3.set_rotation(body, V.construct(...op.rotation));
        if (op.layer !== undefined) CO.set_collision_layer(body, op.layer);
        if (op.mask !== undefined) CO.set_collision_mask(body, op.mask);
        N.add_child(op.parent === undefined ? holder : node(op.parent), body);
        nodes.set(op.body, body);
      } else if ('raycast' in op) {
        const ray = new Object3D();
        RC.godot_ray_cast_3d_adopt(ray);
        if (op.at !== undefined) N3.set_position(ray, V.construct(...op.at));
        if (op.target !== undefined) RC.set_target_position(ray, V.construct(...op.target));
        if (op.mask !== undefined) RC.set_collision_mask(ray, op.mask);
        if (op.areas !== undefined) RC.set_collide_with_areas(ray, op.areas);
        if (op.excludeParent !== undefined) RC.set_exclude_parent_body(ray, op.excludeParent);
        N.add_child(op.parent === undefined ? holder : node(op.parent), ray);
        nodes.set(op.raycast, ray);
      } else if ('move' in op) N3.set_position(node(op.move), V.construct(...op.at));
      else if ('layer' in op) CO.set_collision_layer(node(op.layer), op.value);
      else if ('mask' in op) CO.set_collision_mask(node(op.mask), op.value);
      else if ('layerBit' in op) CO.set_collision_layer_value(node(op.layerBit), op.bit, op.on);
      else if ('disable' in op) CS.set_disabled(node(op.disable).children[op.index] as object, op.on);
      else if ('remove' in op) N.remove_child(node(op.remove).parent as object, node(op.remove));
      else read(op.read);
    };
    let result: unknown[] | undefined;
    const pending: (Segment & { end?: true })[] = [...segments, { await: 'process', ops: [], end: true }];
    let first = true;
    const arm = (): void => {
      const segment = pending.shift();
      if (segment === undefined) return;
      // A segment without an await runs straight after the one before it; only the first waits
      // for the probe's first process frame.
      if (segment.await === undefined && !first) {
        for (const op of segment.ops) run(op);
        arm();
        return;
      }
      first = false;
      const signal = segment.await === 'physics' ? tree.physics_frame : tree.process_frame;
      signal.connect(
        () => {
          if (segment.end === true) {
            result = [...log];
            return;
          }
          for (const op of segment.ops) run(op);
          arm();
        },
        { oneShot: true },
      );
    };
    arm();
    ST.godot_tree_frame(DT);
    for (let guard = 0; result === undefined && guard < 1000; guard += 1) {
      ST.godot_tree_physics_step(DT);
      if (result !== undefined) break;
      ST.godot_tree_frame(DT);
    }
    world.free();
    return result;
  };
}

export function physicsCase(segments: readonly Segment[]): { readonly gdscript: string; readonly target: () => unknown } {
  shapeNumber = 0;
  return { gdscript: gdscript(segments), target: target(segments) };
}

export { Group };
