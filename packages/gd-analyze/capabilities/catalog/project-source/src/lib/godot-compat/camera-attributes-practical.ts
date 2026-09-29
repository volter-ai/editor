/**
 * @godot-class CameraAttributesPractical
 * @role BINDING
 *
 * Godot 4.7's `CameraAttributesPractical` (`scene/resources/camera_attributes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a camera's depth of field and exposure settings, kept
 * and read back. A scene states only its defaults (no depth of field, no auto exposure, an exposure
 * multiplier of 1), which change nothing drawn; the plan refuses any other.
 */

export interface CameraAttributesPractical {
  readonly properties: Map<string, unknown>;
}

/**
 * A CameraAttributesPractical of its defaults and the properties a scene states.
 *
 * @godot CameraAttributesPractical.CameraAttributesPractical
 * @source scene/resources/camera_attributes.cpp:306
 */
export function construct(properties: Readonly<Record<string, unknown>> = {}): CameraAttributesPractical {
  return { properties: new Map(Object.entries(properties)) };
}
