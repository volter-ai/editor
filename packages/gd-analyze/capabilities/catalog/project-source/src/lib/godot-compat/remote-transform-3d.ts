/** RemoteTransform3D over retained Three Object3D world/local transforms. */

import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';

export interface RemoteTransform3DOptions {
  readonly remotePath?: string;
  readonly useGlobalCoordinates?: boolean;
  readonly updatePosition?: boolean;
  readonly updateRotation?: boolean;
  readonly updateScale?: boolean;
  readonly resolve: (path: string) => Object3D | null;
}

interface RemoteTransform3DState {
  path: string;
  useGlobal: boolean;
  position: boolean;
  rotation: boolean;
  scale: boolean;
  target: Object3D | null;
  readonly resolve: (path: string) => Object3D | null;
}

export type GodotRemoteTransform3D = Object3D & {
  remote_path: string;
  use_global_coordinates: boolean;
  update_position: boolean;
  update_rotation: boolean;
  update_scale: boolean;
  set_remote_node(path: string): void;
  get_remote_node(): string;
  force_update_cache(): void;
  set_use_global_coordinates(value: boolean): void;
  get_use_global_coordinates(): boolean;
  set_update_position(value: boolean): void;
  get_update_position(): boolean;
  set_update_rotation(value: boolean): void;
  get_update_rotation(): boolean;
  set_update_scale(value: boolean): void;
  get_update_scale(): boolean;
};

const STATE = new WeakMap<Object3D, RemoteTransform3DState>();
const SOURCE_POSITION = new Vector3();
const SOURCE_ROTATION = new Quaternion();
const SOURCE_SCALE = new Vector3();
const TARGET_POSITION = new Vector3();
const TARGET_ROTATION = new Quaternion();
const TARGET_SCALE = new Vector3();
const TARGET_WORLD = new Matrix4();
const PARENT_INVERSE = new Matrix4();

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`RemoteTransform3D.${member} must be bool.`);
  return value;
}

function nodePath(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('RemoteTransform3D.remote_path must be NodePath/string.');
  return value;
}

function stateOf(node: Object3D, member: string): RemoteTransform3DState {
  const state = STATE.get(node);
  if (state === undefined) throw new Error(`RemoteTransform3D.${member} requires a retained binding.`);
  return state;
}

function isRelated(source: Object3D, target: Object3D): boolean {
  for (let parent: Object3D | null = source; parent !== null; parent = parent.parent) {
    if (parent === target) return true;
  }
  for (let parent: Object3D | null = target; parent !== null; parent = parent.parent) {
    if (parent === source) return true;
  }
  return false;
}

function refresh(node: Object3D, state: RemoteTransform3DState): void {
  if (state.path === '') { state.target = null; return; }
  const target = state.resolve(state.path);
  if (target === null) {
    throw new Error(`RemoteTransform3D.remote_path ${JSON.stringify(state.path)} does not resolve to a live Node3D.`);
  }
  if (isRelated(node, target)) {
    throw new Error('RemoteTransform3D remote_path cannot target itself, an ancestor, or a descendant.');
  }
  state.target = target;
}

export function bindRemoteTransform3D(
  node: Object3D,
  options: RemoteTransform3DOptions,
): GodotRemoteTransform3D {
  releaseRemoteTransform3D(node);
  const remote = node as GodotRemoteTransform3D;
  const state: RemoteTransform3DState = {
    path: nodePath(options.remotePath ?? ''),
    useGlobal: boolean(options.useGlobalCoordinates ?? true, 'use_global_coordinates'),
    position: boolean(options.updatePosition ?? true, 'update_position'),
    rotation: boolean(options.updateRotation ?? true, 'update_rotation'),
    scale: boolean(options.updateScale ?? true, 'update_scale'),
    target: null,
    resolve: options.resolve,
  };
  STATE.set(remote, state);
  registerGodotObjectIdentity(remote, 'RemoteTransform3D');
  const property = <T>(
    name: string,
    get: () => T,
    set: (value: T) => void,
  ): void => {
    Object.defineProperty(remote, name, { configurable: true, enumerable: true, get, set });
  };
  property('remote_path', () => state.path, (value: string) => {
    state.path = nodePath(value);
    refresh(remote, state);
  });
  property('use_global_coordinates', () => state.useGlobal, (value: boolean) => { state.useGlobal = boolean(value, 'use_global_coordinates'); });
  property('update_position', () => state.position, (value: boolean) => { state.position = boolean(value, 'update_position'); });
  property('update_rotation', () => state.rotation, (value: boolean) => { state.rotation = boolean(value, 'update_rotation'); });
  property('update_scale', () => state.scale, (value: boolean) => { state.scale = boolean(value, 'update_scale'); });
  Object.assign(remote, {
    set_remote_node: (value: string) => { remote.remote_path = value; },
    get_remote_node: () => remote.remote_path,
    force_update_cache: () => { refresh(remote, state); },
    set_use_global_coordinates: (value: boolean) => { remote.use_global_coordinates = value; },
    get_use_global_coordinates: () => remote.use_global_coordinates,
    set_update_position: (value: boolean) => { remote.update_position = value; },
    get_update_position: () => remote.update_position,
    set_update_rotation: (value: boolean) => { remote.update_rotation = value; },
    get_update_rotation: () => remote.update_rotation,
    set_update_scale: (value: boolean) => { remote.update_scale = value; },
    get_update_scale: () => remote.update_scale,
  });
  refresh(remote, state);
  return remote;
}

export function updateRemoteTransform3D(node: Object3D): void {
  const state = stateOf(node, 'update');
  if (state.target === null) return;
  const target = state.target;
  if (!state.useGlobal) {
    if (state.position) target.position.copy(node.position);
    if (state.rotation) target.quaternion.copy(node.quaternion);
    if (state.scale) target.scale.copy(node.scale);
    target.updateMatrix();
    target.updateMatrixWorld(true);
    return;
  }
  node.updateWorldMatrix(true, false);
  target.updateWorldMatrix(true, false);
  node.matrixWorld.decompose(SOURCE_POSITION, SOURCE_ROTATION, SOURCE_SCALE);
  target.matrixWorld.decompose(TARGET_POSITION, TARGET_ROTATION, TARGET_SCALE);
  if (state.position) TARGET_POSITION.copy(SOURCE_POSITION);
  if (state.rotation) TARGET_ROTATION.copy(SOURCE_ROTATION);
  if (state.scale) TARGET_SCALE.copy(SOURCE_SCALE);
  TARGET_WORLD.compose(TARGET_POSITION, TARGET_ROTATION, TARGET_SCALE);
  if (target.parent !== null) {
    target.parent.updateWorldMatrix(true, false);
    PARENT_INVERSE.copy(target.parent.matrixWorld).invert();
    TARGET_WORLD.premultiply(PARENT_INVERSE);
  }
  TARGET_WORLD.decompose(target.position, target.quaternion, target.scale);
  target.updateMatrix();
  target.updateMatrixWorld(true);
}

export function releaseRemoteTransform3D(node: Object3D): void {
  STATE.delete(node);
  for (const member of [
    'remote_path', 'use_global_coordinates', 'update_position', 'update_rotation', 'update_scale',
    'set_remote_node', 'get_remote_node', 'force_update_cache',
    'set_use_global_coordinates', 'get_use_global_coordinates',
    'set_update_position', 'get_update_position', 'set_update_rotation', 'get_update_rotation',
    'set_update_scale', 'get_update_scale',
  ]) delete (node as unknown as Record<string, unknown>)[member];
}
