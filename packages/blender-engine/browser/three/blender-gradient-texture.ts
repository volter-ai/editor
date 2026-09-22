/** Blender's Gradient **Type**. */
export type GradientType =
  | 'LINEAR'
  | 'QUADRATIC'
  | 'EASING'
  | 'DIAGONAL'
  | 'SPHERICAL'
  | 'QUADRATIC_SPHERE'
  | 'RADIAL';

/** Options for `gradientTexture` (Blender: the Gradient Texture node). */
export interface GradientTextureOptions {
  /** Blender's **Type**. Default `'LINEAR'` (Blender's own). */
  readonly type?: GradientType;
}

/**
 * A RAMP IN SPACE (Blender: the **Gradient Texture** node): the point's own
 * coordinates read as a 0–1 fac. Height tinting, a spherical falloff, a
 * radial sweep — the cheapest way to say "this end is different".
 *
 * NO SCALE OR CENTRE, exactly like Blender's node, which takes a Vector and
 * nothing else: position, rotate and scale the POINT before calling (that
 * is what Blender's Mapping node does).
 *
 * This one IS numerically Blender's — the seven ramps are closed-form and
 * there is no noise substrate to differ over.
 */
export function gradientTexture(
  x: number,
  y: number,
  z: number,
  options: GradientTextureOptions = {},
): number {
  switch (options.type ?? 'LINEAR') {
    case 'QUADRATIC': {
      const r = Math.max(x, 0);
      return r * r;
    }
    case 'EASING': {
      const r = Math.min(1, Math.max(0, x));
      return r * r * (3 - 2 * r);
    }
    case 'DIAGONAL':
      return (x + y) / 2;
    case 'SPHERICAL':
      return Math.max(0.999999 - Math.hypot(x, y, z), 0);
    case 'QUADRATIC_SPHERE': {
      const r = Math.max(0.999999 - Math.hypot(x, y, z), 0);
      return r * r;
    }
    case 'RADIAL':
      return Math.atan2(y, x) / (2 * Math.PI) + 0.5;
    default:
      return x;
  }
}
