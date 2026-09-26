/**
 * UI cases describe a Control tree inside a SubViewport of a fixed size as segments of steps,
 * printed as GDScript for the official binary and run through compat exports for the target: the
 * same tree, the same calls, the same reads, across the same frames.
 */
import { Group, type Object3D, Scene } from 'three';
import * as BOX from '../../capabilities/catalog/project-source/src/lib/godot-compat/box-container';
import * as CI from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-item';
import * as CL from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-layer';
import * as COLOR from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as CONTAINER from '../../capabilities/catalog/project-source/src/lib/godot-compat/container';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/control';
import * as HBOX from '../../capabilities/catalog/project-source/src/lib/godot-compat/h-box-container';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/rect2';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as SV from '../../capabilities/catalog/project-source/src/lib/godot-compat/sub-viewport';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import { gd } from './literals';

export type Pair = readonly [number, number];

/** A value both sides can build. */
export type Value =
  | number
  | boolean
  | string
  | { readonly int: number }
  | { readonly v2: Pair }
  | { readonly rect: readonly [number, number, number, number] }
  | { readonly color: readonly [number, number, number, number] }
  | { readonly node: string };

export const int = (value: number): Value => ({ int: value });
export const v2 = (x: number, y: number): Value => ({ v2: [x, y] });
export const rect = (x: number, y: number, w: number, h: number): Value => ({ rect: [x, y, w, h] });
export const color = (r: number, g: number, b: number, a: number): Value => ({ color: [r, g, b, a] });
export const ref = (node: string): Value => ({ node });

export type Kind = 'CanvasLayer' | 'Control' | 'HBoxContainer';

export type Op =
  /** A node of `kind` under `parent` (default: the SubViewport), or outside the tree when `detached`. */
  | { readonly node: string; readonly kind: Kind; readonly parent?: string; readonly detached?: boolean }
  /** Adds a detached node under `to` (default: the SubViewport), as a scene instance enters. */
  | { readonly add: string; readonly to?: string }
  | { readonly call: string; readonly on: string; readonly args?: readonly Value[] }
  | { readonly read: string; readonly on: string; readonly args?: readonly Value[] }
  | { readonly remove: string };

export interface Segment {
  /** Frames to wait (`await process_frame`) before the steps. */
  readonly await?: number;
  readonly ops: readonly Op[];
}

type Exports = Readonly<Record<string, unknown>>;

/** The compat modules a node of each kind answers through, nearest class first. */
const MODULES: Readonly<Record<Kind, readonly Exports[]>> = {
  CanvasLayer: [CL, N],
  Control: [C, CI, N],
  HBoxContainer: [BOX, CONTAINER, C, CI, N],
};

function gdValue(value: Value): string {
  if (typeof value === 'number') return gd(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if ('int' in value) return String(value.int);
  if ('v2' in value) return `Vector2(${gd(value.v2[0])}, ${gd(value.v2[1])})`;
  if ('rect' in value) return `Rect2(${value.rect.map(gd).join(', ')})`;
  if ('color' in value) return `Color(${value.color.map(gd).join(', ')})`;
  return `n_${value.node}`;
}

export function uiGdscript(size: Pair, segments: readonly Segment[]): string {
  const lines = [
    'var log: Array = []',
    'var vp := SubViewport.new()',
    `vp.size = Vector2i(${String(size[0])}, ${String(size[1])})`,
    'holder.add_child(vp)',
  ];
  for (const segment of segments) {
    for (let frame = 0; frame < (segment.await ?? 0); frame += 1) lines.push('await process_frame');
    for (const op of segment.ops) {
      if ('node' in op) {
        lines.push(`var n_${op.node} := ${op.kind}.new()`);
        lines.push(`n_${op.node}.name = ${JSON.stringify(op.node)}`);
        if (op.detached !== true) lines.push(`${op.parent === undefined ? 'vp' : `n_${op.parent}`}.add_child(n_${op.node})`);
      } else if ('add' in op) {
        lines.push(`${op.to === undefined ? 'vp' : `n_${op.to}`}.add_child(n_${op.add})`);
      } else if ('remove' in op) {
        lines.push(`n_${op.remove}.get_parent().remove_child(n_${op.remove})`);
      } else if ('call' in op) {
        lines.push(`n_${op.on}.${op.call}(${(op.args ?? []).map(gdValue).join(', ')})`);
      } else {
        lines.push(`log.append(n_${op.on}.${op.read}(${(op.args ?? []).map(gdValue).join(', ')}))`);
      }
    }
  }
  lines.push('vp.queue_free()', 'return log');
  return lines.join('\n');
}

const DT = 1 / 60;

export function uiTarget(size: Pair, segments: readonly Segment[]): () => unknown {
  return () => {
    const root = new Scene();
    ST.godot_tree_set_root(root);
    const holder = new Group();
    N.godot_node_adopt(holder, { kind: 'node' });
    N.add_child(root, holder);
    const viewport = new Scene();
    N.godot_node_adopt(viewport, { kind: 'node', classes: ['SubViewport', 'Viewport', 'Node'] });
    SV.set_size(viewport, { x: size[0], y: size[1] });
    N.add_child(holder, viewport);
    const nodes = new Map<string, { readonly entity: Object3D; readonly kind: Kind }>();
    const jsValue = (value: Value): unknown => {
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
      if ('int' in value) return value.int;
      if ('v2' in value) return V2.construct(value.v2[0], value.v2[1]);
      if ('rect' in value) return R.construct(...value.rect);
      if ('color' in value) return COLOR.construct(...value.color);
      return nodes.get(value.node)?.entity;
    };
    const resolve = (kind: Kind, name: string): ((...args: unknown[]) => unknown) => {
      const found = MODULES[kind].find((module) => typeof module[name] === 'function');
      if (found === undefined) throw new Error(`no compat export ${name} for ${kind}`);
      return found[name] as (...args: unknown[]) => unknown;
    };
    const log: unknown[] = [];
    for (const segment of segments) {
      for (let frame = 0; frame < (segment.await ?? 0); frame += 1) ST.godot_tree_frame(DT);
      for (const op of segment.ops) {
        if ('node' in op) {
          const entity = new Group();
          entity.name = op.node;
          if (op.kind === 'CanvasLayer') {
            N.godot_node_adopt(entity, { kind: 'node', classes: ['CanvasLayer', 'Node'] });
            CL.godot_canvas_layer_mount(entity);
          } else if (op.kind === 'HBoxContainer') HBOX.godot_h_box_container_mount(entity);
          else C.godot_control_mount(entity, ['Control', 'CanvasItem', 'Node']);
          if (op.detached !== true) N.add_child(op.parent === undefined ? viewport : (nodes.get(op.parent)?.entity as Object3D), entity);
          nodes.set(op.node, { entity, kind: op.kind });
        } else if ('add' in op) {
          N.add_child(op.to === undefined ? viewport : (nodes.get(op.to)?.entity as Object3D), nodes.get(op.add)?.entity as Object3D);
        } else if ('remove' in op) {
          const entity = nodes.get(op.remove)?.entity as Object3D;
          N.remove_child(entity.parent as Object3D, entity);
        } else {
          const node = nodes.get(op.on);
          if (node === undefined) throw new Error(`no node ${op.on}`);
          const result = resolve(node.kind, 'call' in op ? op.call : op.read)(node.entity, ...(op.args ?? []).map(jsValue));
          if ('read' in op) log.push(result);
        }
      }
    }
    return log;
  };
}

export function uiCase(size: Pair, segments: readonly Segment[]): { readonly gdscript: string; readonly target: () => unknown } {
  return { gdscript: uiGdscript(size, segments), target: uiTarget(size, segments) };
}
