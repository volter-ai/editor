import { z } from 'zod';

export const CameraDescriptorSchema = z
  .object({
    type: z.enum(['perspective', 'orthographic']).describe('Camera projection type'),
    fov: z.number().optional().describe('Vertical field of view in degrees (perspective only)'),
    near: z.number().optional().describe('Near clipping plane distance'),
    far: z.number().optional().describe('Far clipping plane distance'),
    orthoSize: z
      .number()
      .optional()
      .describe('Half-height of the orthographic frustum (orthographic only)'),
    width: z.number().optional().describe('Render width in pixels. Defaults to viewport width'),
    height: z.number().optional().describe('Render height in pixels. Defaults to viewport height'),
  })
  .describe('Camera configuration');

export type CameraDescriptor = z.infer<typeof CameraDescriptorSchema>;
