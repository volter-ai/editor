import { z } from 'zod';

const MaterialDescriptorObjectSchema = z
  .object({
    type: z.enum(['standard', 'physical', 'basic', 'toon']).describe('Material shading model'),
    color: z.string().optional().describe('Base color as CSS hex string (e.g. "#ff0000")'),
    metalness: z.number().optional().describe('Metalness factor 0–1 (standard/physical only)'),
    roughness: z.number().optional().describe('Roughness factor 0–1 (standard/physical only)'),
    map: z.string().optional().describe('Path to albedo/diffuse texture image'),
    normalMap: z.string().optional().describe('Path to normal map texture image'),
    emissive: z.string().optional().describe('Emissive color as CSS hex string'),
    emissiveIntensity: z.number().optional().describe('Emissive light intensity multiplier'),
    emissiveMap: z.string().optional().describe('Path to emissive map texture image'),
    aoMap: z.string().optional().describe('Path to ambient occlusion map texture image'),
    lightMap: z
      .string()
      .optional()
      .describe(
        "Path to a baked lightmap texture (uses the mesh's second UV set). Applies the pre-baked GI/shadow result on top of the material.",
      ),
    lightMapIntensity: z.number().optional().describe('Lightmap intensity multiplier (default 1).'),
    roughnessMap: z.string().optional().describe('Path to roughness map texture image'),
    metalnessMap: z.string().optional().describe('Path to metalness map texture image'),
    opacity: z.number().optional().describe('Opacity 0–1. Set transparent: true to enable'),
    transparent: z.boolean().optional().describe('Enable alpha blending for this material'),
    side: z.enum(['front', 'back', 'double']).optional().describe('Which face sides to render'),
    flatShading: z.boolean().optional().describe('Use flat (faceted) shading instead of smooth'),

    // Physical material feature groups (physical only, all optional)
    clearcoat: z
      .object({
        clearcoat: z.number().describe('Clearcoat layer intensity 0–1'),
        clearcoatRoughness: z.number().optional().describe('Clearcoat roughness 0–1'),
        clearcoatMap: z.string().optional().describe('Path to clearcoat intensity map'),
        clearcoatRoughnessMap: z.string().optional().describe('Path to clearcoat roughness map'),
      })
      .optional()
      .describe('Clearcoat layer (physical only)'),

    transmission: z
      .object({
        transmission: z.number().describe('Transmission intensity 0–1 (glass, liquid)'),
        ior: z.number().optional().describe('Index of refraction (default 1.5)'),
        thickness: z.number().optional().describe('Volume thickness for refraction'),
        attenuationColor: z.string().optional().describe('Color absorbed over distance'),
        attenuationDistance: z
          .number()
          .optional()
          .describe('Distance at which attenuation color takes full effect'),
        transmissionMap: z.string().optional().describe('Path to transmission map'),
      })
      .optional()
      .describe('Light transmission (physical only)'),

    sheen: z
      .object({
        sheen: z.number().describe('Sheen intensity 0–1 (fabric, velvet)'),
        sheenColor: z.string().optional().describe('Sheen tint color'),
        sheenRoughness: z.number().optional().describe('Sheen roughness 0–1'),
        sheenColorMap: z.string().optional().describe('Path to sheen color map'),
        sheenRoughnessMap: z.string().optional().describe('Path to sheen roughness map'),
      })
      .optional()
      .describe('Sheen layer (physical only)'),

    iridescence: z
      .object({
        iridescence: z.number().describe('Iridescence intensity 0–1 (soap bubbles, oil slick)'),
        iridescenceIOR: z.number().optional().describe('Thin-film IOR (default 1.3)'),
        iridescenceThicknessRange: z
          .tuple([z.number(), z.number()])
          .optional()
          .describe('Min/max thin-film thickness in nm'),
        iridescenceMap: z.string().optional().describe('Path to iridescence intensity map'),
        iridescenceThicknessMap: z
          .string()
          .optional()
          .describe('Path to iridescence thickness map'),
      })
      .optional()
      .describe('Iridescence thin-film (physical only)'),

    displacementMap: z.string().optional().describe('Path to displacement/height map'),
    displacementScale: z.number().optional().describe('Displacement height multiplier'),
    displacementBias: z.number().optional().describe('Displacement offset'),
  })
  .strict();

export const MaterialDescriptorSchema = MaterialDescriptorObjectSchema.describe(
  'Material appearance properties',
);

export type MaterialDescriptor = z.infer<typeof MaterialDescriptorSchema>;
