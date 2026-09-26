/** Pure authored RemoteTransform3D plan. */

import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

type Properties = Readonly<Record<string, GodotValue>>;

export interface RemoteTransform3DSpec {
  readonly remotePath: string;
  readonly useGlobalCoordinates: boolean;
  readonly updatePosition: boolean;
  readonly updateRotation: boolean;
  readonly updateScale: boolean;
}

function bool(props: Properties, key: string, fallback: boolean, at: string): boolean {
  const value = props[key];
  if (value === undefined) return fallback;
  if (value.kind !== 'bool') throw new TranslateError(`${at}.${key}`, `RemoteTransform3D.${key} must be bool.`);
  return value.value;
}

function path(props: Properties, at: string): string {
  const value = props['remote_path'];
  if (value === undefined) return '';
  if (value.kind === 'string') return value.value;
  const argument = value.kind === 'ctor' && value.name === 'NodePath' ? value.args[0] : undefined;
  if (argument?.kind === 'string') return argument.value;
  throw new TranslateError(`${at}.remote_path`, 'RemoteTransform3D.remote_path must be NodePath.');
}

export function readRemoteTransform3DSpec(props: Properties, at: string): RemoteTransform3DSpec {
  return {
    remotePath: path(props, at),
    useGlobalCoordinates: bool(props, 'use_global_coordinates', true, at),
    updatePosition: bool(props, 'update_position', true, at),
    updateRotation: bool(props, 'update_rotation', true, at),
    updateScale: bool(props, 'update_scale', true, at),
  };
}
