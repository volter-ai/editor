/**
 * Node cases describe a small scene as steps, printed as GDScript for the official binary and run
 * against three objects through compat exports for the target: the same tree, the same calls.
 */
import { Group, Object3D, PerspectiveCamera, Scene } from 'three';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as B from '../../capabilities/catalog/project-source/src/lib/godot-compat/basis';
import * as T from '../../capabilities/catalog/project-source/src/lib/godot-compat/transform-3d';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import { gd } from './literals';

export type Triple = readonly [number, number, number];

/** A value both sides can build: a float, an int, a bool or a built-in. */
export type Value =
  | number
  | boolean
  | { readonly int: number }
  | { readonly v3: Triple }
  | { readonly v2: readonly [number, number] }
  | { readonly basis: readonly [Triple, Triple, Triple] }
  | { readonly transform: readonly [Triple, Triple, Triple, Triple] };

export const v3 = (x: number, y: number, z: number): Value => ({ v3: [x, y, z] });
export const v2 = (x: number, y: number): Value => ({ v2: [x, y] });
export const int = (value: number): Value => ({ int: value });
export const basis = (x: Triple, y: Triple, z: Triple): Value => ({ basis: [x, y, z] });
export const transform = (x: Triple, y: Triple, z: Triple, o: Triple): Value => ({ transform: [x, y, z, o] });

const gv3 = ([x, y, z]: Triple): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;

function gdValue(value: Value): string {
  if (typeof value === 'number') return gd(value);
  if (typeof value === 'boolean') return String(value);
  if ('int' in value) return String(value.int);
  if ('v3' in value) return gv3(value.v3);
  if ('v2' in value) return `Vector2(${gd(value.v2[0])}, ${gd(value.v2[1])})`;
  if ('basis' in value) return `Basis(${value.basis.map(gv3).join(', ')})`;
  return `Transform3D(${value.transform.map(gv3).join(', ')})`;
}

function jsValue(value: Value): unknown {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if ('int' in value) return value.int;
  if ('v3' in value) return V.construct(...value.v3);
  if ('v2' in value) return V2.construct(value.v2[0], value.v2[1]);
  const vectors = ('basis' in value ? value.basis : value.transform).map((t) => V.construct(...t));
  const b = B.construct(vectors[0] as V.Vector3, vectors[1] as V.Vector3, vectors[2] as V.Vector3);
  return 'basis' in value ? b : T.construct(b, vectors[3] as V.Vector3);
}

export type Step =
  /** A Node3D (or a Camera3D in a SubViewport of this pixel size) under `parent` or the holder. */
  | { readonly node: string; readonly parent?: string; readonly camera?: readonly [number, number]; readonly plain?: boolean }
  | { readonly call: string; readonly on: string; readonly args?: readonly Value[] };

type Exports = Readonly<Record<string, (...args: never[]) => unknown>>;

/**
 * The GDScript body (ending in `return`) and the target thunk for steps followed by one returned
 * call. `modules` resolves a method name to the compat module that exports it.
 */
export function scene(
  steps: readonly Step[],
  result: { readonly call: string; readonly on: string; readonly args?: readonly Value[] },
  modules: readonly Exports[],
  setSize: (viewport: Object3D, size: unknown) => void,
): { readonly gdscript: string; readonly target: () => unknown } {
  const lines: string[] = [];
  for (const step of steps) {
    if ('node' in step) {
      if (step.camera !== undefined) {
        lines.push(`var ${step.node}_vp := SubViewport.new()`);
        lines.push(`${step.node}_vp.size = Vector2i(${String(step.camera[0])}, ${String(step.camera[1])})`);
        lines.push(`holder.add_child(${step.node}_vp)`);
        lines.push(`var ${step.node} := Camera3D.new()`);
        lines.push(`${step.node}_vp.add_child(${step.node})`);
      } else {
        lines.push(`var ${step.node} := ${step.plain === true ? 'Node' : 'Node3D'}.new()`);
        lines.push(`${step.parent ?? 'holder'}.add_child(${step.node})`);
      }
    } else {
      lines.push(`${step.on}.${step.call}(${(step.args ?? []).map(gdValue).join(', ')})`);
    }
  }
  lines.push(`return ${result.on}.${result.call}(${(result.args ?? []).map(gdValue).join(', ')})`);
  const resolve = (name: string): ((...args: unknown[]) => unknown) => {
    const found = modules.find((module) => typeof module[name] === 'function');
    if (found === undefined) throw new Error(`no compat export ${name}`);
    return found[name] as (...args: unknown[]) => unknown;
  };
  const target = (): unknown => {
    const holder = new Scene();
    const nodes = new Map<string, Object3D>();
    for (const step of steps) {
      if ('node' in step) {
        if (step.camera !== undefined) {
          const viewport = new Scene();
          setSize(viewport, { x: step.camera[0], y: step.camera[1] });
          const camera = new PerspectiveCamera(75, 1, 0.05, 4000);
          viewport.add(camera);
          nodes.set(step.node, camera);
        } else {
          const node = step.plain === true ? new Group() : new Object3D();
          if (step.plain === true) N.godot_node_adopt(node, { kind: 'node' });
          (step.parent === undefined ? holder : (nodes.get(step.parent) as Object3D)).add(node);
          nodes.set(step.node, node);
        }
      } else {
        resolve(step.call)(nodes.get(step.on), ...(step.args ?? []).map(jsValue));
      }
    }
    return resolve(result.call)(nodes.get(result.on), ...(result.args ?? []).map(jsValue));
  };
  return { gdscript: lines.join('\n'), target };
}
