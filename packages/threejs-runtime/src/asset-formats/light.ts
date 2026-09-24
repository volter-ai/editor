import { z } from 'zod';

const LightDescriptorBase = z.object({
  type: z.enum(['directional', 'point', 'spot', 'hemisphere', 'area']).describe('Light type'),
  color: z.string().optional().describe('Light color as CSS hex string'),
  intensity: z
    .number()
    .optional()
    .describe(
      'Native Three.js light intensity. Point and spot lights use candela with inverse-square ' +
        'falloff (a value near 1 is candle-scale); area lights use nit; directional and ' +
        'hemisphere lights use Three.js scene-light intensity units.',
    ),
  groundColor: z.string().optional().describe('Ground color for hemisphere lights'),
  distance: z
    .number()
    .optional()
    .describe('Maximum range of the light. 0 = infinite (point/spot only)'),
  decay: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      'Native Three.js distance-decay exponent for point/spot lights. Default 2 gives ' +
        'physically correct inverse-square falloff.',
    ),
  angle: z.number().optional().describe('Spotlight cone angle in radians (spot only)'),
  penumbra: z.number().optional().describe('Spotlight penumbra softness 0–1 (spot only)'),
  width: z
    .number()
    .optional()
    .describe(
      'Area light width (area only). RectAreaLight has NO shadow support and only affects ' +
        'Standard/Physical materials — degrades loudly, not silently.',
    ),
  height: z
    .number()
    .optional()
    .describe(
      'Area light height (area only). RectAreaLight has NO shadow support and only affects ' +
        'Standard/Physical materials — degrades loudly, not silently.',
    ),
});

export const LightDescriptorSchema = LightDescriptorBase.refine(
  (l) => l.type !== 'spot' || l.angle === undefined || l.angle > 0,
  { message: 'Spot light angle must be positive' },
).describe('Light source configuration');

export type LightDescriptor = z.infer<typeof LightDescriptorSchema>;
