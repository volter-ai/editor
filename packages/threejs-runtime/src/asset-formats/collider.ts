import { z } from 'zod';
import { Vec3Schema } from './tuples';

export const ColliderDescriptorSchema = z
  .object({
    type: z
      .enum(['cuboid', 'ball', 'capsule', 'trimesh'])
      .describe(
        "Collider shape type. T1.2: every shape scales with the entity's composed world scale " +
          "(self × ancestors) — for trimesh this means the entity's own mesh geometry vertices " +
          'are pre-scaled per-axis before building the Rapier trimesh, so it matches whatever ' +
          "size ends up on screen; it does not require the collider's own dimension fields.",
      ),
    halfExtents: Vec3Schema.optional().describe(
      "Half-size [x, y, z] for cuboid colliders, in the ENTITY'S OWN LOCAL units. T1.2: " +
        "scales with the entity — the actual Rapier collider is this value times the entity's " +
        'composed world scale (self × every transformed ancestor), per axis, baked in once at ' +
        "load time (Rapier has no live notion of an Object3D's scale).",
    ),
    radius: z
      .number()
      .optional()
      .describe(
        "Radius for ball and capsule colliders, in the ENTITY'S OWN LOCAL units. T1.2: scales " +
          "with the entity's composed world scale, which MUST be uniform on the collider's round " +
          'axes (ball: all of x/y/z; capsule: x and z) — a non-uniform scale there throws a loud ' +
          'load error (Rapier balls/capsules cannot represent an ellipse).',
      ),
    halfHeight: z
      .number()
      .optional()
      .describe(
        "Half-height for capsule colliders, in the entity's own local units, along the capsule's " +
          "axis (Y). T1.2: scales by the entity's composed world scale on that axis.",
      ),
    friction: z.number().optional().describe('Surface friction coefficient'),
    restitution: z
      .number()
      .optional()
      .describe('Bounciness coefficient (0 = no bounce, 1 = perfect bounce)'),
    density: z
      .number()
      .optional()
      .describe('Mass density. Used to compute mass from collider volume'),
    offset: Vec3Schema.optional().describe(
      "Translation offset relative to body origin, in the ENTITY'S OWN LOCAL units. T1.2/R1c: " +
        "scales with the entity's composed world scale (self × every transformed ancestor), " +
        'per axis, the same way halfExtents/radius/halfHeight do — an unscaled offset would ' +
        "silently drift away from the entity's visual anchor point under any non-1 scale.",
    ),
    isSensor: z
      .boolean()
      .optional()
      .describe('When true, detects overlaps without physical blocking (trigger volume)'),
    collisionGroups: z
      .number()
      .optional()
      .describe('Bitmask: collision layers this collider belongs to (max 16 bits)'),
    collisionFilter: z
      .number()
      .optional()
      .describe('Bitmask: collision layers this collider interacts with (max 16 bits)'),
  })
  .describe('Physics collider shape and properties');

export type ColliderDescriptor = z.infer<typeof ColliderDescriptorSchema>;
