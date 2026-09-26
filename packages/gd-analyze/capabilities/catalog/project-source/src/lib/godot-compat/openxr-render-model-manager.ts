/** Godot OpenXRRenderModelManager Node3D and model discovery lifecycle. */

import { Object3D } from 'three';
import { registerGodotObjectIdentity } from './object';
import { GodotOpenXRRenderModel } from './openxr-render-model';
import {
  type GodotOpenXRRenderModelRID,
  GodotOpenXRRenderModelExtension,
} from './openxr-render-model-extension';
import { createSignal, type GodotSignal } from './signal';

export const OPENXR_RENDER_MODEL_TRACKER_ANY = 0;
export const OPENXR_RENDER_MODEL_TRACKER_NONE_SET = 1;
export const OPENXR_RENDER_MODEL_TRACKER_LEFT_HAND = 2;
export const OPENXR_RENDER_MODEL_TRACKER_RIGHT_HAND = 3;

export interface GodotOpenXRRenderModelManagerCarrier {
  matchesTracker(renderModel: GodotOpenXRRenderModelRID, tracker: number): boolean;
  localPoseObject?(poseName: string): Object3D | null;
}

function trackerType(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
    throw new RangeError('OpenXRRenderModelManager tracker is invalid.');
  }
  return value;
}

export class GodotOpenXRRenderModelManager extends Object3D {
  private readonly modelAdded = createSignal<readonly [GodotOpenXRRenderModel]>();
  private readonly modelRemoved = createSignal<readonly [GodotOpenXRRenderModel]>();
  readonly render_model_added: GodotSignal<readonly [GodotOpenXRRenderModel]> = this.modelAdded.signal;
  readonly render_model_removed: GodotSignal<readonly [GodotOpenXRRenderModel]> = this.modelRemoved.signal;
  private tracker = OPENXR_RENDER_MODEL_TRACKER_ANY;
  private makeLocalToPose = '';
  private readonly models = new Map<GodotOpenXRRenderModelRID, GodotOpenXRRenderModel>();

  constructor(
    private readonly extension: GodotOpenXRRenderModelExtension,
    private readonly carrier: GodotOpenXRRenderModelManagerCarrier,
  ) {
    super();
    registerGodotObjectIdentity(this, 'OpenXRRenderModelManager');
  }

  get_tracker(): number { return this.tracker; }
  set_tracker(tracker: number): void {
    const next = trackerType(tracker);
    if (next === this.tracker) return;
    this.tracker = next;
    this.refresh_models();
  }
  get_make_local_to_pose(): string { return this.makeLocalToPose; }
  set_make_local_to_pose(makeLocalToPose: string): void {
    if (typeof makeLocalToPose !== 'string') throw new TypeError('OpenXRRenderModelManager.make_local_to_pose requires String.');
    this.makeLocalToPose = makeLocalToPose;
    this.applyLocalPose();
  }

  refresh_models(): void {
    const available = new Set(
      this.extension.render_model_get_all().filter((model) => this.carrier.matchesTracker(model, this.tracker)),
    );
    for (const [rid, model] of [...this.models]) {
      if (available.has(rid)) continue;
      this.models.delete(rid);
      this.remove(model);
      model.clearRenderModel();
      this.modelRemoved.emit(model);
    }
    for (const rid of available) {
      let model = this.models.get(rid);
      if (model === undefined) {
        model = new GodotOpenXRRenderModel(this.extension);
        model.set_render_model(rid);
        this.models.set(rid, model);
        this.add(model);
        this.modelAdded.emit(model);
      }
      model.refresh();
    }
    this.applyLocalPose();
  }

  get_render_models(): readonly GodotOpenXRRenderModel[] { return [...this.models.values()]; }
  get_render_model(rid: GodotOpenXRRenderModelRID): GodotOpenXRRenderModel | null {
    return this.models.get(rid) ?? null;
  }
  clear_render_models(): void {
    for (const model of [...this.models.values()]) {
      this.remove(model);
      model.clearRenderModel();
      this.modelRemoved.emit(model);
    }
    this.models.clear();
  }

  private applyLocalPose(): void {
    if (this.makeLocalToPose.length === 0) {
      this.position.set(0, 0, 0);
      this.quaternion.identity();
      this.scale.set(1, 1, 1);
      this.updateMatrix();
      return;
    }
    const pose = this.carrier.localPoseObject?.(this.makeLocalToPose);
    if (pose === null || pose === undefined) return;
    pose.updateWorldMatrix(true, false);
    this.matrix.copy(pose.matrixWorld).invert();
    this.matrix.decompose(this.position, this.quaternion, this.scale);
    this.updateMatrixWorld(true);
  }
}

export function createGodotOpenXRRenderModelManager(
  extension: GodotOpenXRRenderModelExtension,
  carrier: GodotOpenXRRenderModelManagerCarrier,
): GodotOpenXRRenderModelManager {
  return new GodotOpenXRRenderModelManager(extension, carrier);
}
