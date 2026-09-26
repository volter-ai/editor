/** Godot OpenXRRenderModel Node3D over native Three scene instances. */

import { Object3D } from 'three';
import { registerGodotObjectIdentity } from './object';
import {
  type GodotOpenXRRenderModelRID,
  GodotOpenXRRenderModelExtension,
} from './openxr-render-model-extension';
import { createSignal, type GodotSignal } from './signal';

export class GodotOpenXRRenderModel extends Object3D {
  private readonly topLevelPathChanged = createSignal<readonly [string]>();
  readonly render_model_top_level_path_changed: GodotSignal<readonly [string]> = this.topLevelPathChanged.signal;
  private renderModel: GodotOpenXRRenderModelRID = null;
  private sceneInstance: Object3D | null = null;
  private topLevelPath = '';

  constructor(private readonly extension: GodotOpenXRRenderModelExtension) {
    super();
    registerGodotObjectIdentity(this, 'OpenXRRenderModel');
  }

  get_top_level_path(): string { return this.topLevelPath; }
  get_render_model(): GodotOpenXRRenderModelRID { return this.renderModel; }

  set_render_model(renderModel: GodotOpenXRRenderModelRID): void {
    if (renderModel === this.renderModel) return;
    this.detachSceneInstance();
    this.renderModel = renderModel;
    if (renderModel === null || renderModel === undefined) {
      this.setTopLevelPath('');
      return;
    }
    this.setTopLevelPath(this.extension.render_model_get_top_level_path(renderModel));
    const scene = this.extension.render_model_new_scene_instance(renderModel);
    if (scene instanceof Object3D) {
      this.sceneInstance = scene;
      this.add(scene);
    } else if (scene !== null) {
      throw new TypeError('OpenXR render model scene instance requires native Object3D.');
    }
    this.matrix.copy(this.extension.render_model_get_root_transform(renderModel));
    this.matrixAutoUpdate = false;
  }

  refresh(): void {
    if (this.renderModel === null || this.renderModel === undefined) return;
    const path = this.extension.render_model_get_top_level_path(this.renderModel);
    this.setTopLevelPath(path);
    this.matrix.copy(this.extension.render_model_get_root_transform(this.renderModel));
    this.updateMatrixWorld(true);
    const count = this.extension.render_model_get_animatable_node_count(this.renderModel);
    for (let index = 0; index < count; index += 1) {
      const name = this.extension.render_model_get_animatable_node_name(this.renderModel, index);
      const node = this.sceneInstance?.getObjectByName(name);
      if (node === undefined) continue;
      node.visible = this.extension.render_model_is_animatable_node_visible(this.renderModel, index);
      node.matrix.copy(this.extension.render_model_get_animatable_node_transform(this.renderModel, index));
      node.matrixAutoUpdate = false;
    }
  }

  clearRenderModel(): void { this.set_render_model(null); }

  private setTopLevelPath(path: string): void {
    if (path === this.topLevelPath) return;
    this.topLevelPath = path;
    this.topLevelPathChanged.emit(path);
  }
  private detachSceneInstance(): void {
    if (this.sceneInstance === null) return;
    this.remove(this.sceneInstance);
    this.sceneInstance = null;
  }
}

export function createGodotOpenXRRenderModel(
  extension: GodotOpenXRRenderModelExtension,
): GodotOpenXRRenderModel {
  return new GodotOpenXRRenderModel(extension);
}
