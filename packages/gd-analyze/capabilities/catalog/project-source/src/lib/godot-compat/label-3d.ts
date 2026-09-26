import { Color, DoubleSide, Quaternion, SRGBColorSpace, Vector3, type Object3D } from 'three';
import { Text } from 'troika-three-text';
import { registerGodotObjectIdentity } from './object';

export interface GodotLabel3D extends Text {
  text: string;
  fontSize: number;
  fillOpacity: number;
  outlineWidth: number;
}

interface Label3DState {
  billboard: 0 | 1 | 2;
  fixedSize: boolean;
  fontSize: number;
  pixelSize: number;
  modulate: { r: number; g: number; b: number; a: number };
  outlineSize: number;
  readonly parentQuaternion: Quaternion;
  readonly worldPosition: Vector3;
  readonly cameraPosition: Vector3;
  readonly billboardQuaternion: Quaternion;
  readonly authoredQuaternion: Quaternion;
  readonly authoredScale: Vector3;
  readonly previousBeforeRender: Object3D['onBeforeRender'];
  readonly previousAfterRender: Object3D['onAfterRender'];
  renderPoseApplied: boolean;
}

const LABEL_STATE = new WeakMap<GodotLabel3D, Label3DState>();
const LABEL_UP = new Vector3(0, 1, 0);

function stateOf(label: GodotLabel3D): Label3DState {
  const state = LABEL_STATE.get(label);
  if (state === undefined) throw new Error('Label3D runtime member used before native Text binding.');
  return state;
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`Label3D.${member} requires a finite number.`);
  return value;
}

function applyFont(label: GodotLabel3D, state: Label3DState): void {
  label.fontSize = state.fontSize * state.pixelSize;
  label.outlineWidth = state.outlineSize * state.pixelSize;
}

function applyModulate(label: GodotLabel3D, state: Label3DState): void {
  label.color = new Color().setRGB(
    state.modulate.r,
    state.modulate.g,
    state.modulate.b,
    SRGBColorSpace,
  );
  label.fillOpacity = state.modulate.a;
}

export function bindGodotLabel3D(
  label: GodotLabel3D,
  options: {
    readonly billboard?: number;
    readonly fixedSize?: boolean;
    readonly fontSize?: number;
    readonly pixelSize?: number;
    readonly modulate?: { readonly r: number; readonly g: number; readonly b: number; readonly a?: number };
    readonly outlineSize?: number;
  } = {},
): GodotLabel3D {
  registerGodotObjectIdentity(label, 'Label3D');
  const existing = LABEL_STATE.get(label);
  if (existing !== undefined) return label;
  const billboard = options.billboard ?? 0;
  if (billboard !== 0 && billboard !== 1 && billboard !== 2) {
    throw new RangeError('Label3D.billboard requires DISABLED (0), ENABLED (1), or FIXED_Y (2).');
  }
  const color = options.modulate ?? { r: 1, g: 1, b: 1, a: 1 };
  const state: Label3DState = {
    billboard,
    fixedSize: options.fixedSize ?? false,
    fontSize: finite(options.fontSize ?? 32, 'font_size'),
    pixelSize: finite(options.pixelSize ?? 0.005, 'pixel_size'),
    modulate: { r: color.r, g: color.g, b: color.b, a: color.a ?? 1 },
    outlineSize: finite(options.outlineSize ?? 12, 'outline_size'),
    parentQuaternion: new Quaternion(),
    worldPosition: new Vector3(),
    cameraPosition: new Vector3(),
    billboardQuaternion: new Quaternion(),
    authoredQuaternion: label.quaternion.clone(),
    authoredScale: label.scale.clone(),
    previousBeforeRender: label.onBeforeRender,
    previousAfterRender: label.onAfterRender,
    renderPoseApplied: false,
  };
  LABEL_STATE.set(label, state);
  applyFont(label, state);
  applyModulate(label, state);
  label.onBeforeRender = function (...args: Parameters<Object3D['onBeforeRender']>): void {
    state.previousBeforeRender.apply(this, args);
    if (state.billboard !== 0 || state.fixedSize) {
      state.authoredQuaternion.copy(label.quaternion);
      state.authoredScale.copy(label.scale);
      const camera = args[2];
      if (state.billboard === 1) camera.getWorldQuaternion(state.billboardQuaternion);
      else if (state.billboard === 2) {
        label.getWorldPosition(state.worldPosition);
        camera.getWorldPosition(state.cameraPosition);
        const yaw = Math.atan2(
          state.cameraPosition.x - state.worldPosition.x,
          state.cameraPosition.z - state.worldPosition.z,
        );
        state.billboardQuaternion.setFromAxisAngle(LABEL_UP, yaw);
      }
      if (state.billboard !== 0) {
        if (label.parent !== null) {
          label.parent.getWorldQuaternion(state.parentQuaternion).invert();
          label.quaternion.copy(state.parentQuaternion.multiply(state.billboardQuaternion));
        } else label.quaternion.copy(state.billboardQuaternion);
      }
      if (state.fixedSize) {
        label.getWorldPosition(state.worldPosition).applyMatrix4(camera.matrixWorldInverse);
        const projection = camera.projectionMatrix.elements;
        const scale = projection[15] !== 0
          ? Math.abs(1 / (projection[5] ?? 1))
          : Math.max(Number.EPSILON, -state.worldPosition.z);
        label.scale.copy(state.authoredScale).multiplyScalar(scale);
      }
      label.updateMatrixWorld();
      state.renderPoseApplied = true;
    }
  };
  label.onAfterRender = function (...args: Parameters<Object3D['onAfterRender']>): void {
    if (state.renderPoseApplied) {
      label.quaternion.copy(state.authoredQuaternion);
      label.scale.copy(state.authoredScale);
      label.updateMatrixWorld();
      state.renderPoseApplied = false;
    }
    state.previousAfterRender.apply(this, args);
  };
  return label;
}

export function createGodotLabel3D(): GodotLabel3D {
  const label = new Text() as GodotLabel3D;
  label.text = '';
  label.anchorX = 'center';
  label.anchorY = 'middle';
  label.outlineColor = new Color(0, 0, 0);
  label.outlineOpacity = 1;
  label.material.side = DoubleSide;
  return bindGodotLabel3D(label);
}

export function getLabel3DBillboard(label: GodotLabel3D): number { return stateOf(label).billboard; }
export function setLabel3DBillboard(label: GodotLabel3D, value: number): void {
  if (value !== 0 && value !== 1 && value !== 2) throw new RangeError('Label3D.billboard requires enum value 0..2.');
  stateOf(label).billboard = value;
}
export function getLabel3DFixedSize(label: GodotLabel3D): boolean { return stateOf(label).fixedSize; }
export function setLabel3DFixedSize(label: GodotLabel3D, value: boolean): void {
  stateOf(label).fixedSize = value;
}
export function getLabel3DFontSize(label: GodotLabel3D): number { return stateOf(label).fontSize; }
export function setLabel3DFontSize(label: GodotLabel3D, value: number): void {
  const state = stateOf(label);
  state.fontSize = finite(value, 'font_size');
  applyFont(label, state);
}
export function getLabel3DModulate(label: GodotLabel3D): { r: number; g: number; b: number; a: number } {
  return { ...stateOf(label).modulate };
}
export function setLabel3DModulate(label: GodotLabel3D, value: { readonly r: number; readonly g: number; readonly b: number; readonly a?: number }): void {
  if (![value.r, value.g, value.b, value.a ?? 1].every(Number.isFinite)) throw new TypeError('Label3D.modulate requires a finite Color.');
  const state = stateOf(label);
  state.modulate = { r: value.r, g: value.g, b: value.b, a: value.a ?? 1 };
  applyModulate(label, state);
}
export function getLabel3DOutlineSize(label: GodotLabel3D): number { return stateOf(label).outlineSize; }
export function setLabel3DOutlineSize(label: GodotLabel3D, value: number): void {
  const state = stateOf(label);
  state.outlineSize = finite(value, 'outline_size');
  applyFont(label, state);
}
