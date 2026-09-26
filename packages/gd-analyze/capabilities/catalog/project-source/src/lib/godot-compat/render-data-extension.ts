/** Godot RenderDataExtension composition of scene buffers, scene data, and render RIDs. */

import { registerGodotObjectIdentity } from './object';
import type { GodotRenderSceneBuffersExtension } from './render-scene-buffers-extension';
import type { GodotRenderRID, GodotRenderSceneDataExtension } from './render-scene-data-extension';

export interface GodotRenderDataExtensionHooks {
  _get_render_scene_buffers(): GodotRenderSceneBuffersExtension | null;
  _get_render_scene_data(): GodotRenderSceneDataExtension | null;
  _get_environment(): GodotRenderRID;
  _get_camera_attributes(): GodotRenderRID;
}

export class GodotRenderDataExtension {
  constructor(private readonly hooks: GodotRenderDataExtensionHooks) {
    registerGodotObjectIdentity(this, 'RenderDataExtension');
  }
  _get_render_scene_buffers(): GodotRenderSceneBuffersExtension | null { return this.hooks._get_render_scene_buffers(); }
  _get_render_scene_data(): GodotRenderSceneDataExtension | null { return this.hooks._get_render_scene_data(); }
  _get_environment(): GodotRenderRID { return this.hooks._get_environment(); }
  _get_camera_attributes(): GodotRenderRID { return this.hooks._get_camera_attributes(); }
  get_render_scene_buffers(): GodotRenderSceneBuffersExtension | null { return this._get_render_scene_buffers(); }
  get_render_scene_data(): GodotRenderSceneDataExtension | null { return this._get_render_scene_data(); }
  get_environment(): GodotRenderRID { return this._get_environment(); }
  get_camera_attributes(): GodotRenderRID { return this._get_camera_attributes(); }
}

export function createGodotRenderDataExtension(hooks: GodotRenderDataExtensionHooks): GodotRenderDataExtension {
  return new GodotRenderDataExtension(hooks);
}
