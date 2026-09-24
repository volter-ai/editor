import { z } from 'zod';

export const Vec3Schema = z
  .tuple([z.number(), z.number(), z.number()])
  .describe('3D vector as [x, y, z]');
export const QuatSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .describe('Quaternion as [x, y, z, w]');

export type Vec3 = z.infer<typeof Vec3Schema>;
export type Quat = z.infer<typeof QuatSchema>;

export const TransformSchema = z
  .object({
    position: Vec3Schema.optional().describe('World-space position [x, y, z]'),
    rotation: QuatSchema.optional().describe('Rotation quaternion [x, y, z, w]'),
    scale: Vec3Schema.optional().describe('Scale factor per axis [x, y, z]. Defaults to [1, 1, 1]'),
  })
  .describe('Local transform relative to parent entity');

export type Transform = z.infer<typeof TransformSchema>;
