/** Godot RenderSceneDataExtension over renderer-owned camera and view state. */

import { Matrix4, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';

export type GodotRenderRID = unknown;

export interface GodotRenderSceneDataExtensionHooks {
  _get_cam_transform(): Matrix4;
  _get_cam_projection(): Matrix4;
  _get_view_count(): number;
  _get_view_eye_offset(view: number): Vector3;
  _get_view_projection(view: number): Matrix4;
  _get_uniform_buffer(): GodotRenderRID;
}

export class GodotRenderSceneDataExtension {
  constructor(private readonly hooks: GodotRenderSceneDataExtensionHooks) {
    registerGodotObjectIdentity(this, 'RenderSceneDataExtension');
  }
  _get_cam_transform(): Matrix4 {
    const value = this.hooks._get_cam_transform();
    if (!(value instanceof Matrix4)) throw new TypeError('RenderSceneData camera transform requires Transform3D.');
    return value.clone();
  }
  _get_cam_projection(): Matrix4 {
    const value = this.hooks._get_cam_projection();
    if (!(value instanceof Matrix4)) throw new TypeError('RenderSceneData camera projection requires Projection.');
    return value.clone();
  }
  _get_view_count(): number { return Math.max(0, Math.trunc(this.hooks._get_view_count())); }
  _get_view_eye_offset(view: number): Vector3 {
    const value = this.hooks._get_view_eye_offset(this.viewIndex(view));
    if (!(value instanceof Vector3)) throw new TypeError('RenderSceneData eye offset requires Vector3.');
    return value.clone();
  }
  _get_view_projection(view: number): Matrix4 {
    const value = this.hooks._get_view_projection(this.viewIndex(view));
    if (!(value instanceof Matrix4)) throw new TypeError('RenderSceneData view projection requires Projection.');
    return value.clone();
  }
  _get_uniform_buffer(): GodotRenderRID { return this.hooks._get_uniform_buffer(); }
  get_cam_transform(): Matrix4 { return this._get_cam_transform(); }
  get_cam_projection(): Matrix4 { return this._get_cam_projection(); }
  get_view_count(): number { return this._get_view_count(); }
  get_view_eye_offset(view: number): Vector3 { return this._get_view_eye_offset(view); }
  get_view_projection(view: number): Matrix4 { return this._get_view_projection(view); }
  get_uniform_buffer(): GodotRenderRID { return this._get_uniform_buffer(); }
  private viewIndex(view: number): number {
    const count = this._get_view_count();
    if (!Number.isSafeInteger(view) || view < 0 || view >= count) throw new RangeError(`RenderSceneData view requires 0..${Math.max(0, count - 1)}.`);
    return view;
  }
}

export function createGodotRenderSceneDataExtension(hooks: GodotRenderSceneDataExtensionHooks): GodotRenderSceneDataExtension {
  return new GodotRenderSceneDataExtension(hooks);
}
