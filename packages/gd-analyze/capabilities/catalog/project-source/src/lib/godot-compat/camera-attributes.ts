import { registerGodotObjectIdentity } from './object';
import { updateGodotCameraProjection, type GodotProjectionCamera } from './spatial';

interface GodotCameraAttributesBase {
  readonly __godotClass: 'CameraAttributesPhysical' | 'CameraAttributesPractical';
  auto_exposure_enabled: boolean;
  auto_exposure_scale: number;
  auto_exposure_speed: number;
  exposure_multiplier: number;
  exposure_sensitivity: number;
}

export interface GodotCameraAttributesPhysical extends GodotCameraAttributesBase {
  readonly __godotClass: 'CameraAttributesPhysical';
  auto_exposure_max_exposure_value: number;
  auto_exposure_min_exposure_value: number;
  exposure_aperture: number;
  exposure_shutter_speed: number;
  frustum_far: number;
  frustum_focal_length: number;
  frustum_focus_distance: number;
  frustum_near: number;
}

export interface GodotCameraAttributesPractical extends GodotCameraAttributesBase {
  readonly __godotClass: 'CameraAttributesPractical';
  auto_exposure_max_sensitivity: number;
  auto_exposure_min_sensitivity: number;
  dof_blur_amount: number;
  dof_blur_far_distance: number;
  dof_blur_far_enabled: boolean;
  dof_blur_far_transition: number;
  dof_blur_near_distance: number;
  dof_blur_near_enabled: boolean;
  dof_blur_near_transition: number;
}

export type GodotCameraAttributes =
  | GodotCameraAttributesPhysical
  | GodotCameraAttributesPractical;

type CameraAttributeListener = (attributes: GodotCameraAttributes) => void;
const CAMERA_ATTRIBUTE_LISTENERS = new WeakMap<GodotCameraAttributes, Set<CameraAttributeListener>>();

function finite(value: unknown, member: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new RangeError(`godot-compat: ${member} requires a finite value >= ${minimum}.`);
  }
  return value;
}

function property<T extends object>(
  owner: T,
  member: string,
  initial: unknown,
  normalize: (value: unknown) => unknown,
): void {
  let retained = normalize(initial);
  Object.defineProperty(owner, member, {
    configurable: true,
    enumerable: true,
    get: () => retained,
    set: (value: unknown) => {
      const next = normalize(value);
      if (Object.is(next, retained)) return;
      retained = next;
      for (const listener of CAMERA_ATTRIBUTE_LISTENERS.get(owner as GodotCameraAttributes) ?? []) {
        listener(owner as GodotCameraAttributes);
      }
    },
  });
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ${member} requires bool.`);
  return value;
}

function base<T extends GodotCameraAttributes>(owner: T): T {
  property(owner, 'auto_exposure_enabled', false, (value) => bool(value, 'CameraAttributes.auto_exposure_enabled'));
  property(owner, 'auto_exposure_scale', 0.4, (value) => finite(value, 'CameraAttributes.auto_exposure_scale', Number.MIN_VALUE));
  property(owner, 'auto_exposure_speed', 0.5, (value) => finite(value, 'CameraAttributes.auto_exposure_speed'));
  property(owner, 'exposure_multiplier', 1, (value) => finite(value, 'CameraAttributes.exposure_multiplier'));
  property(owner, 'exposure_sensitivity', 100, (value) => finite(value, 'CameraAttributes.exposure_sensitivity', Number.MIN_VALUE));
  return owner;
}

export function createGodotCameraAttributesPhysical(): GodotCameraAttributesPhysical {
  const attributes = base({ __godotClass: 'CameraAttributesPhysical' } as GodotCameraAttributesPhysical);
  property(attributes, 'auto_exposure_max_exposure_value', 10, (value) => finite(value, 'CameraAttributesPhysical.auto_exposure_max_exposure_value', -32));
  property(attributes, 'auto_exposure_min_exposure_value', -8, (value) => finite(value, 'CameraAttributesPhysical.auto_exposure_min_exposure_value', -32));
  property(attributes, 'exposure_aperture', 16, (value) => finite(value, 'CameraAttributesPhysical.exposure_aperture', 0.5));
  property(attributes, 'exposure_shutter_speed', 100, (value) => finite(value, 'CameraAttributesPhysical.exposure_shutter_speed', 0.1));
  property(attributes, 'frustum_far', 4000, (value) => finite(value, 'CameraAttributesPhysical.frustum_far', 0.01));
  property(attributes, 'frustum_focal_length', 35, (value) => finite(value, 'CameraAttributesPhysical.frustum_focal_length', 1));
  property(attributes, 'frustum_focus_distance', 10, (value) => finite(value, 'CameraAttributesPhysical.frustum_focus_distance', 0.01));
  property(attributes, 'frustum_near', 0.05, (value) => finite(value, 'CameraAttributesPhysical.frustum_near', 0.001));
  registerGodotObjectIdentity(attributes, 'CameraAttributesPhysical');
  return attributes;
}

export function createGodotCameraAttributesPractical(): GodotCameraAttributesPractical {
  const attributes = base({ __godotClass: 'CameraAttributesPractical' } as GodotCameraAttributesPractical);
  property(attributes, 'auto_exposure_max_sensitivity', 800, (value) => finite(value, 'CameraAttributesPractical.auto_exposure_max_sensitivity'));
  property(attributes, 'auto_exposure_min_sensitivity', 0, (value) => finite(value, 'CameraAttributesPractical.auto_exposure_min_sensitivity'));
  property(attributes, 'dof_blur_amount', 0.1, (value) => {
    const amount = finite(value, 'CameraAttributesPractical.dof_blur_amount');
    if (amount > 1) throw new RangeError('godot-compat: CameraAttributesPractical.dof_blur_amount must be <= 1.');
    return amount;
  });
  property(attributes, 'dof_blur_far_distance', 10, (value) => finite(value, 'CameraAttributesPractical.dof_blur_far_distance'));
  property(attributes, 'dof_blur_far_enabled', false, (value) => bool(value, 'CameraAttributesPractical.dof_blur_far_enabled'));
  property(attributes, 'dof_blur_far_transition', 5, (value) => finite(value, 'CameraAttributesPractical.dof_blur_far_transition'));
  property(attributes, 'dof_blur_near_distance', 2, (value) => finite(value, 'CameraAttributesPractical.dof_blur_near_distance'));
  property(attributes, 'dof_blur_near_enabled', false, (value) => bool(value, 'CameraAttributesPractical.dof_blur_near_enabled'));
  property(attributes, 'dof_blur_near_transition', 1, (value) => finite(value, 'CameraAttributesPractical.dof_blur_near_transition'));
  registerGodotObjectIdentity(attributes, 'CameraAttributesPractical');
  return attributes;
}

export function watchGodotCameraAttributes(
  attributes: GodotCameraAttributes,
  listener: CameraAttributeListener,
): () => void {
  let listeners = CAMERA_ATTRIBUTE_LISTENERS.get(attributes);
  if (listeners === undefined) {
    listeners = new Set();
    CAMERA_ATTRIBUTE_LISTENERS.set(attributes, listeners);
  }
  listeners.add(listener);
  return () => listeners?.delete(listener);
}

const CAMERA_ATTRIBUTES = new WeakMap<GodotProjectionCamera, GodotCameraAttributes | null>();
const CAMERA_ATTRIBUTE_RELEASES = new WeakMap<GodotProjectionCamera, () => void>();

function applyPhysicalCameraAttributes(camera: GodotProjectionCamera, attributes: GodotCameraAttributes): void {
  if (attributes.__godotClass !== 'CameraAttributesPhysical' || !('isPerspectiveCamera' in camera)) {
    updateGodotCameraProjection(camera);
    return;
  }
  camera.near = attributes.frustum_near;
  camera.far = attributes.frustum_far;
  camera.focus = attributes.frustum_focus_distance;
  camera.setFocalLength(attributes.frustum_focal_length);
  camera.updateProjectionMatrix();
}

export function getGodotCameraAttributes(camera: GodotProjectionCamera): GodotCameraAttributes | null {
  return CAMERA_ATTRIBUTES.get(camera) ?? null;
}

export function setGodotCameraAttributes(
  camera: GodotProjectionCamera,
  attributes: GodotCameraAttributes | null,
): void {
  CAMERA_ATTRIBUTE_RELEASES.get(camera)?.();
  CAMERA_ATTRIBUTE_RELEASES.delete(camera);
  if (attributes !== null && (
    typeof attributes !== 'object' ||
    (attributes.__godotClass !== 'CameraAttributesPhysical' && attributes.__godotClass !== 'CameraAttributesPractical')
  )) {
    throw new TypeError('godot-compat: Camera3D.attributes requires CameraAttributes or null.');
  }
  CAMERA_ATTRIBUTES.set(camera, attributes);
  if (attributes === null) {
    updateGodotCameraProjection(camera);
    return;
  }
  applyPhysicalCameraAttributes(camera, attributes);
  CAMERA_ATTRIBUTE_RELEASES.set(camera, watchGodotCameraAttributes(attributes, (next) => {
    applyPhysicalCameraAttributes(camera, next);
  }));
}
