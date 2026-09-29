/**
 * @godot-class CameraAttributesPractical
 * @role BINDING
 *
 * Godot 4.7's `CameraAttributesPractical` (`scene/resources/camera_attributes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a camera's depth of field, kept and read back, which
 * the WorldEnvironment's post pass draws as `postprocessing`'s own `DepthOfField`
 * (`world-environment.ts`). Exposure and auto exposure are not members here: a scene that states
 * one is refused by name.
 */

export interface CameraAttributesPractical {
  dof_blur_far_enabled: boolean;
  dof_blur_far_distance: number;
  dof_blur_far_transition: number;
  dof_blur_near_enabled: boolean;
  dof_blur_near_distance: number;
  dof_blur_near_transition: number;
  dof_blur_amount: number;
}

const f32 = Math.fround;

/**
 * No depth of field; far blur from 10 m over 5, near blur before 2 m over 1, amount 0.1
 * (`camera_attributes.h:82`).
 *
 * @godot CameraAttributesPractical.CameraAttributesPractical
 * @source scene/resources/camera_attributes.cpp:309
 */
export function construct(): CameraAttributesPractical {
  return {
    dof_blur_far_enabled: false,
    dof_blur_far_distance: 10,
    dof_blur_far_transition: 5,
    dof_blur_near_enabled: false,
    dof_blur_near_distance: 2,
    dof_blur_near_transition: 1,
    dof_blur_amount: f32(0.1),
  };
}

/**
 * A CameraAttributesPractical of its defaults and the properties a scene states, by their prop names.
 *
 * @godot CameraAttributesPractical (protocol)
 * @source scene/resources/camera_attributes.cpp:309
 */
export function godot_camera_attributes_practical_new(properties: Readonly<Record<string, unknown>> = {}): CameraAttributesPractical {
  const self = construct();
  const set = <Value>(key: string, setter: (attributes: CameraAttributesPractical, value: Value) => void) => {
    if (properties[key] !== undefined) setter(self, properties[key] as Value);
  };
  set('dofBlurFarEnabled', set_dof_blur_far_enabled);
  set('dofBlurFarDistance', set_dof_blur_far_distance);
  set('dofBlurFarTransition', set_dof_blur_far_transition);
  set('dofBlurNearEnabled', set_dof_blur_near_enabled);
  set('dofBlurNearDistance', set_dof_blur_near_distance);
  set('dofBlurNearTransition', set_dof_blur_near_transition);
  set('dofBlurAmount', set_dof_blur_amount);
  return self;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_far_enabled
 * @source scene/resources/camera_attributes.cpp:151
 */
export function set_dof_blur_far_enabled(self: CameraAttributesPractical, enabled: boolean): void {
  self.dof_blur_far_enabled = enabled;
}

/**
 * @godot CameraAttributesPractical.is_dof_blur_far_enabled
 * @source scene/resources/camera_attributes.cpp:157
 */
export function is_dof_blur_far_enabled(self: CameraAttributesPractical): boolean {
  return self.dof_blur_far_enabled;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_far_distance
 * @source scene/resources/camera_attributes.cpp:161
 */
export function set_dof_blur_far_distance(self: CameraAttributesPractical, distance: number): void {
  self.dof_blur_far_distance = f32(distance);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_far_distance
 * @source scene/resources/camera_attributes.cpp:166
 */
export function get_dof_blur_far_distance(self: CameraAttributesPractical): number {
  return self.dof_blur_far_distance;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_far_transition
 * @source scene/resources/camera_attributes.cpp:170
 */
export function set_dof_blur_far_transition(self: CameraAttributesPractical, distance: number): void {
  self.dof_blur_far_transition = f32(distance);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_far_transition
 * @source scene/resources/camera_attributes.cpp:175
 */
export function get_dof_blur_far_transition(self: CameraAttributesPractical): number {
  return self.dof_blur_far_transition;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_near_enabled
 * @source scene/resources/camera_attributes.cpp:179
 */
export function set_dof_blur_near_enabled(self: CameraAttributesPractical, enabled: boolean): void {
  self.dof_blur_near_enabled = enabled;
}

/**
 * @godot CameraAttributesPractical.is_dof_blur_near_enabled
 * @source scene/resources/camera_attributes.cpp:185
 */
export function is_dof_blur_near_enabled(self: CameraAttributesPractical): boolean {
  return self.dof_blur_near_enabled;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_near_distance
 * @source scene/resources/camera_attributes.cpp:189
 */
export function set_dof_blur_near_distance(self: CameraAttributesPractical, distance: number): void {
  self.dof_blur_near_distance = f32(distance);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_near_distance
 * @source scene/resources/camera_attributes.cpp:194
 */
export function get_dof_blur_near_distance(self: CameraAttributesPractical): number {
  return self.dof_blur_near_distance;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_near_transition
 * @source scene/resources/camera_attributes.cpp:198
 */
export function set_dof_blur_near_transition(self: CameraAttributesPractical, distance: number): void {
  self.dof_blur_near_transition = f32(distance);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_near_transition
 * @source scene/resources/camera_attributes.cpp:203
 */
export function get_dof_blur_near_transition(self: CameraAttributesPractical): number {
  return self.dof_blur_near_transition;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_amount
 * @source scene/resources/camera_attributes.cpp:207
 */
export function set_dof_blur_amount(self: CameraAttributesPractical, amount: number): void {
  self.dof_blur_amount = f32(amount);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_amount
 * @source scene/resources/camera_attributes.cpp:212
 */
export function get_dof_blur_amount(self: CameraAttributesPractical): number {
  return self.dof_blur_amount;
}
