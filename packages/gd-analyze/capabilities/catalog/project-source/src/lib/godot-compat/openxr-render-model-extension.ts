/** Godot OpenXRRenderModelExtension over runtime-owned render model handles. */

import { Matrix4 } from 'three';
import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedStringArray } from './packed-array';
import { createSignal, type GodotSignal } from './signal';

export type GodotOpenXRRenderModelRID = unknown;
export type GodotOpenXRRenderModelNode3D = object;

export interface GodotOpenXRRenderModelCarrier {
  isActive(): boolean;
  create(renderModelId: number): GodotOpenXRRenderModelRID;
  destroy(renderModel: GodotOpenXRRenderModelRID): void;
  getAll(): Iterable<GodotOpenXRRenderModelRID>;
  newSceneInstance(renderModel: GodotOpenXRRenderModelRID): GodotOpenXRRenderModelNode3D | null;
  getSubactionPaths(renderModel: GodotOpenXRRenderModelRID): Iterable<string>;
  getTopLevelPath(renderModel: GodotOpenXRRenderModelRID): string;
  getConfidence(renderModel: GodotOpenXRRenderModelRID): number;
  getRootTransform(renderModel: GodotOpenXRRenderModelRID): Matrix4;
  getAnimatableNodeCount(renderModel: GodotOpenXRRenderModelRID): number;
  getAnimatableNodeName(renderModel: GodotOpenXRRenderModelRID, index: number): string;
  isAnimatableNodeVisible(renderModel: GodotOpenXRRenderModelRID, index: number): boolean;
  getAnimatableNodeTransform(renderModel: GodotOpenXRRenderModelRID, index: number): Matrix4;
}

function renderModelId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('OpenXR render model ID requires a positive integer.');
  }
  return value;
}

export class GodotOpenXRRenderModelExtension {
  private readonly modelAdded = createSignal<readonly [number]>();
  private readonly modelRemoved = createSignal<readonly [number]>();
  private readonly topLevelPathChanged = createSignal<readonly [number]>();
  readonly render_model_added: GodotSignal<readonly [number]> = this.modelAdded.signal;
  readonly render_model_removed: GodotSignal<readonly [number]> = this.modelRemoved.signal;
  readonly render_model_top_level_path_changed: GodotSignal<readonly [number]> = this.topLevelPathChanged.signal;
  private readonly ownedModels = new Set<GodotOpenXRRenderModelRID>();
  private readonly idsByModel = new Map<GodotOpenXRRenderModelRID, number>();

  constructor(private readonly carrier: GodotOpenXRRenderModelCarrier) {
    registerGodotObjectIdentity(this, 'OpenXRRenderModelExtension');
  }

  is_active(): boolean { return Boolean(this.carrier.isActive()); }

  render_model_create(id: number): GodotOpenXRRenderModelRID {
    if (!this.is_active()) throw new Error('OpenXRRenderModelExtension is not active.');
    const normalizedId = renderModelId(id);
    const model = this.carrier.create(normalizedId);
    if (model === null || model === undefined) throw new Error(`OpenXR render model ${normalizedId} creation failed.`);
    this.ownedModels.add(model);
    this.idsByModel.set(model, normalizedId);
    this.modelAdded.emit(normalizedId);
    return model;
  }

  render_model_destroy(renderModel: GodotOpenXRRenderModelRID): void {
    this.requireModel(renderModel);
    const id = this.idsByModel.get(renderModel) ?? 0;
    this.carrier.destroy(renderModel);
    this.ownedModels.delete(renderModel);
    this.idsByModel.delete(renderModel);
    if (id !== 0) this.modelRemoved.emit(id);
  }

  render_model_get_all(): readonly GodotOpenXRRenderModelRID[] {
    const models = [...this.carrier.getAll()];
    for (const model of models) this.ownedModels.add(model);
    return models;
  }

  render_model_new_scene_instance(renderModel: GodotOpenXRRenderModelRID): GodotOpenXRRenderModelNode3D | null {
    return this.carrier.newSceneInstance(this.requireModel(renderModel));
  }
  render_model_get_subaction_paths(renderModel: GodotOpenXRRenderModelRID): PackedStringArray {
    return packedStringArray(this.carrier.getSubactionPaths(this.requireModel(renderModel)));
  }
  render_model_get_top_level_path(renderModel: GodotOpenXRRenderModelRID): string {
    return String(this.carrier.getTopLevelPath(this.requireModel(renderModel)));
  }
  render_model_get_confidence(renderModel: GodotOpenXRRenderModelRID): number {
    const confidence = Math.trunc(this.carrier.getConfidence(this.requireModel(renderModel)));
    return confidence >= 0 && confidence <= 2 ? confidence : 0;
  }
  render_model_get_root_transform(renderModel: GodotOpenXRRenderModelRID): Matrix4 {
    const transform = this.carrier.getRootTransform(this.requireModel(renderModel));
    if (!(transform instanceof Matrix4)) throw new TypeError('OpenXR render model root requires Transform3D.');
    return transform.clone();
  }
  render_model_get_animatable_node_count(renderModel: GodotOpenXRRenderModelRID): number {
    return Math.max(0, Math.trunc(this.carrier.getAnimatableNodeCount(this.requireModel(renderModel))));
  }
  render_model_get_animatable_node_name(renderModel: GodotOpenXRRenderModelRID, index: number): string {
    return String(this.carrier.getAnimatableNodeName(this.requireModel(renderModel), this.requireNodeIndex(renderModel, index)));
  }
  render_model_is_animatable_node_visible(renderModel: GodotOpenXRRenderModelRID, index: number): boolean {
    return Boolean(this.carrier.isAnimatableNodeVisible(this.requireModel(renderModel), this.requireNodeIndex(renderModel, index)));
  }
  render_model_get_animatable_node_transform(renderModel: GodotOpenXRRenderModelRID, index: number): Matrix4 {
    const transform = this.carrier.getAnimatableNodeTransform(
      this.requireModel(renderModel),
      this.requireNodeIndex(renderModel, index),
    );
    if (!(transform instanceof Matrix4)) throw new TypeError('OpenXR animatable node requires Transform3D.');
    return transform.clone();
  }

  notify_render_model_added(id: number): void { this.modelAdded.emit(renderModelId(id)); }
  notify_render_model_removed(id: number): void { this.modelRemoved.emit(renderModelId(id)); }
  notify_top_level_path_changed(id: number): void { this.topLevelPathChanged.emit(renderModelId(id)); }

  destroy_all(): void {
    for (const model of [...this.ownedModels]) this.render_model_destroy(model);
  }

  private requireModel(renderModel: GodotOpenXRRenderModelRID): GodotOpenXRRenderModelRID {
    if (renderModel === null || renderModel === undefined || !this.ownedModels.has(renderModel)) {
      throw new Error('OpenXR render model RID is not owned by this extension.');
    }
    return renderModel;
  }
  private requireNodeIndex(renderModel: GodotOpenXRRenderModelRID, index: number): number {
    const count = this.render_model_get_animatable_node_count(renderModel);
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
      throw new RangeError(`OpenXR render model node index requires 0..${Math.max(0, count - 1)}.`);
    }
    return index;
  }
}

export function createGodotOpenXRRenderModelExtension(
  carrier: GodotOpenXRRenderModelCarrier,
): GodotOpenXRRenderModelExtension {
  return new GodotOpenXRRenderModelExtension(carrier);
}
