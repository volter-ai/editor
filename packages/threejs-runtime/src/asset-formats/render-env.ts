/**
 * Render settings — the tone-mapping / post-processing / render-feature scope
 * the engine's renderer setup reads (`setup/setup-renderer.ts`).
 *
 * Exactly THREE scopes, and each is here because `setup-renderer.ts` reads
 * every one of its fields to build the postprocessing chain. A setting with
 * no such reader does not belong in this descriptor.
 */
import { z } from 'zod';
import { buildRenderingZod } from '../render/render-features';

export const ToneMappingDescriptorSchema = z
  .object({
    mode: z
      .enum(['none', 'linear', 'reinhard', 'cineon', 'aces', 'agx'])
      .optional()
      .describe('Tone mapping operator'),
    exposure: z.number().optional().describe('Exposure level'),
  })
  .describe('Tone mapping configuration');

export type ToneMappingDescriptor = z.infer<typeof ToneMappingDescriptorSchema>;

export const PostProcessingDescriptorSchema = z
  .object({
    // ── Bloom & Vignette ──────────────────────────────────────────────────
    bloom: z
      .object({
        enabled: z.boolean().optional().describe('Enable bloom effect'),
        intensity: z.number().optional().describe('Bloom intensity multiplier'),
        luminanceThreshold: z.number().optional().describe('Minimum luminance to trigger bloom'),
        luminanceSmoothing: z
          .number()
          .optional()
          .describe('Smoothing applied to luminance threshold'),
      })
      .optional()
      .describe('Bloom glow effect'),
    vignette: z
      .object({
        enabled: z.boolean().optional().describe('Enable vignette effect'),
        darkness: z.number().optional().describe('Vignette darkness intensity'),
        offset: z.number().optional().describe('Vignette offset from center'),
      })
      .optional()
      .describe('Screen-edge darkening effect'),

    // ── Color adjustments ─────────────────────────────────────────────────
    brightnessContrast: z
      .object({
        enabled: z.boolean().optional().describe('Enable brightness/contrast adjustment'),
        brightness: z.number().optional().describe('Brightness adjustment (-1 to 1)'),
        contrast: z.number().optional().describe('Contrast adjustment (-1 to 1)'),
      })
      .optional()
      .describe('Brightness and contrast color adjustment'),
    hueSaturation: z
      .object({
        enabled: z.boolean().optional().describe('Enable hue/saturation adjustment'),
        hue: z.number().optional().describe('Hue rotation in radians'),
        saturation: z.number().optional().describe('Saturation adjustment (-1 to 1)'),
      })
      .optional()
      .describe('Hue rotation and saturation color adjustment'),
    sepia: z
      .object({
        enabled: z.boolean().optional().describe('Enable sepia tone'),
        intensity: z.number().optional().describe('Sepia effect intensity (0 to 1)'),
      })
      .optional()
      .describe('Warm sepia tone for vintage photograph look'),
    colorDepth: z
      .object({
        enabled: z.boolean().optional().describe('Enable color depth reduction'),
        bits: z.number().optional().describe('Number of color bits per channel (1–16)'),
      })
      .optional()
      .describe('Reduce color bit depth for posterized/banded look'),

    // ── Lens effects ──────────────────────────────────────────────────────
    chromaticAberration: z
      .object({
        enabled: z.boolean().optional().describe('Enable chromatic aberration'),
        offsetX: z.number().optional().describe('Horizontal color fringe offset'),
        offsetY: z.number().optional().describe('Vertical color fringe offset'),
        radialModulation: z.boolean().optional().describe('Increase effect toward screen edges'),
        modulationOffset: z.number().optional().describe('Radial modulation offset from center'),
      })
      .optional()
      .describe('Lens chromatic aberration (color fringing at screen edges)'),
    lensDistortion: z
      .object({
        enabled: z.boolean().optional().describe('Enable lens distortion'),
        distortionX: z.number().optional().describe('Horizontal barrel/pincushion distortion'),
        distortionY: z.number().optional().describe('Vertical barrel/pincushion distortion'),
        focalLengthX: z.number().optional().describe('Horizontal focal length'),
        focalLengthY: z.number().optional().describe('Vertical focal length'),
        skew: z.number().optional().describe('Lens skew angle'),
      })
      .optional()
      .describe('Barrel/pincushion lens distortion'),
    depthOfField: z
      .object({
        enabled: z.boolean().optional().describe('Enable depth of field'),
        worldFocusDistance: z.number().optional().describe('Focus distance in world units'),
        worldFocusRange: z.number().optional().describe('Focus range in world units'),
        bokehScale: z.number().optional().describe('Bokeh blur scale'),
        focalLength: z.number().optional().describe('Camera focal length in mm'),
      })
      .optional()
      .describe('Physically-based depth of field with bokeh blur'),
    tiltShift: z
      .object({
        enabled: z.boolean().optional().describe('Enable tilt-shift effect'),
        offset: z.number().optional().describe('Focus band offset from center'),
        rotation: z.number().optional().describe('Focus band rotation in radians'),
        focusArea: z.number().optional().describe('Focus band width (0–1)'),
        feather: z.number().optional().describe('Blur falloff smoothness'),
      })
      .optional()
      .describe('Tilt-shift miniature-world blur effect'),

    // ── Film / retro ──────────────────────────────────────────────────────
    noise: z
      .object({
        enabled: z.boolean().optional().describe('Enable film grain noise'),
        premultiply: z
          .boolean()
          .optional()
          .describe('Multiply noise with input color instead of adding'),
      })
      .optional()
      .describe('Random per-pixel noise overlay (film grain)'),
    scanline: z
      .object({
        enabled: z.boolean().optional().describe('Enable scanline overlay'),
        density: z.number().optional().describe('Number of scanlines across screen height'),
      })
      .optional()
      .describe('Horizontal scanline overlay (CRT monitor look)'),
    dotScreen: z
      .object({
        enabled: z.boolean().optional().describe('Enable dot screen halftone'),
        angle: z.number().optional().describe('Pattern angle in radians'),
        scale: z.number().optional().describe('Pattern dot scale'),
      })
      .optional()
      .describe('Halftone dot pattern (newspaper/comic look)'),
    grid: z
      .object({
        enabled: z.boolean().optional().describe('Enable grid overlay'),
        scale: z.number().optional().describe('Grid cell scale'),
        lineWidth: z.number().optional().describe('Grid line width'),
      })
      .optional()
      .describe('Visible grid pattern overlay'),
    pixelation: z
      .object({
        enabled: z.boolean().optional().describe('Enable pixelation'),
        granularity: z.number().optional().describe('Pixel size (higher = more pixelated)'),
      })
      .optional()
      .describe('Reduce resolution for pixel-art / mosaic effect'),
    glitch: z
      .object({
        enabled: z.boolean().optional().describe('Enable digital glitch effect'),
        delayX: z.number().optional().describe('Minimum delay between glitches (seconds)'),
        delayY: z.number().optional().describe('Maximum delay between glitches (seconds)'),
        durationX: z.number().optional().describe('Minimum glitch duration (seconds)'),
        durationY: z.number().optional().describe('Maximum glitch duration (seconds)'),
        strengthX: z.number().optional().describe('Minimum glitch strength'),
        strengthY: z.number().optional().describe('Maximum glitch strength'),
        columns: z.number().optional().describe('Number of glitch columns'),
        ratio: z.number().optional().describe('Glitch ratio (0–1)'),
      })
      .optional()
      .describe('Random digital glitch artifacts (block displacement, color shifting)'),

    // ── Distortion ────────────────────────────────────────────────────────
    shockWave: z
      .object({
        enabled: z.boolean().optional().describe('Enable shock wave distortion'),
        speed: z.number().optional().describe('Wave propagation speed'),
        maxRadius: z.number().optional().describe('Maximum wave radius'),
        waveSize: z.number().optional().describe('Width of the distortion wave'),
        amplitude: z.number().optional().describe('Distortion strength'),
        positionX: z.number().optional().describe('Wave origin X in world space'),
        positionY: z.number().optional().describe('Wave origin Y in world space'),
        positionZ: z.number().optional().describe('Wave origin Z in world space'),
      })
      .optional()
      .describe('Expanding spherical distortion wave from a point'),

    // ── Anti-aliasing ─────────────────────────────────────────────────────
    smaa: z
      .object({
        enabled: z.boolean().optional().describe('Enable SMAA anti-aliasing'),
        preset: z
          .enum(['low', 'medium', 'high', 'ultra'])
          .optional()
          .describe('Quality preset (higher = better quality, more cost)'),
      })
      .optional()
      .describe('Subpixel Morphological Anti-Aliasing'),

    // ── Ambient occlusion ─────────────────────────────────────────────────
    ssao: z
      .object({
        enabled: z.boolean().optional().describe('Enable screen-space ambient occlusion'),
        radius: z.number().optional().describe('Occlusion sampling radius'),
        intensity: z.number().optional().describe('Occlusion intensity multiplier'),
        bias: z.number().optional().describe('Depth bias to reduce self-occlusion artifacts'),
        samples: z.number().optional().describe('Number of occlusion samples per pixel'),
        rings: z.number().optional().describe('Number of spiral sample rings'),
        fade: z.number().optional().describe('Distance at which occlusion fades out'),
        color: z.string().optional().describe('Occlusion tint color as CSS hex'),
      })
      .optional()
      .describe('Screen-space ambient occlusion (darken creases and crevices)'),
    n8ao: z
      .object({
        enabled: z.boolean().optional().describe('Enable N8AO ambient occlusion'),
        aoSamples: z.number().optional().describe('Number of AO samples (default 16)'),
        aoRadius: z.number().optional().describe('AO sampling radius in world units'),
        intensity: z.number().optional().describe('AO intensity multiplier'),
        denoiseSamples: z.number().optional().describe('Number of denoise samples'),
        denoiseRadius: z.number().optional().describe('Denoise blur radius'),
        distanceFalloff: z.number().optional().describe('AO distance falloff'),
        screenSpaceRadius: z
          .boolean()
          .optional()
          .describe('Use screen-space radius instead of world-space'),
        color: z.string().optional().describe('AO tint color as CSS hex'),
        halfRes: z.boolean().optional().describe('Render AO at half resolution for performance'),
      })
      .optional()
      .describe('High-quality ambient occlusion (N8AO — alternative to SSAO)'),

    // ── Entity-referencing effects ────────────────────────────────────────
    godRays: z
      .object({
        enabled: z.boolean().optional().describe('Enable god rays'),
        sourceEntity: z.string().optional().describe('Entity ID of the light source mesh'),
        density: z.number().optional().describe('Ray density'),
        decay: z.number().optional().describe('Ray intensity decay along distance'),
        weight: z.number().optional().describe('Ray weight / brightness'),
        exposure: z.number().optional().describe('Overall god ray exposure'),
        samples: z.number().optional().describe('Number of ray-march samples'),
      })
      .optional()
      .describe('Volumetric light shafts from a light source entity'),
    outline: z
      .object({
        enabled: z.boolean().optional().describe('Enable outline effect'),
        tags: z.array(z.string()).optional().describe('Entity tags to outline'),
        edgeStrength: z.number().optional().describe('Outline edge thickness / strength'),
        pulseSpeed: z.number().optional().describe('Outline pulse animation speed (0 = no pulse)'),
        visibleEdgeColor: z.string().optional().describe('Color of visible edges as CSS hex'),
        hiddenEdgeColor: z
          .string()
          .optional()
          .describe('Color of hidden/occluded edges as CSS hex'),
        xRay: z.boolean().optional().describe('Show outline through occluding objects'),
      })
      .optional()
      .describe('Highlight entities matching tags with colored outlines'),

    // ── Screen-space reflections & GI (realism-effects) ───────────────────
    ssr: z
      .object({
        enabled: z.boolean().optional().describe('Enable screen-space reflections'),
        intensity: z.number().optional().describe('Reflection intensity'),
        exponent: z.number().optional().describe('Reflection falloff exponent'),
        distance: z.number().optional().describe('Maximum reflection ray distance'),
        thickness: z.number().optional().describe('Depth thickness for hit testing'),
        maxRoughness: z.number().optional().describe('Maximum roughness for reflections (0–1)'),
      })
      .optional()
      .describe('Screen-space reflections for reflective/glossy surfaces'),
    ssgi: z
      .object({
        enabled: z.boolean().optional().describe('Enable screen-space global illumination'),
        intensity: z.number().optional().describe('Indirect light intensity'),
        distance: z.number().optional().describe('Maximum GI ray distance'),
        thickness: z.number().optional().describe('Depth thickness for hit testing'),
        maxRoughness: z.number().optional().describe('Maximum roughness for GI (0–1)'),
      })
      .optional()
      .describe('Screen-space global illumination (indirect lighting bounce)'),
    motionBlur: z
      .object({
        enabled: z.boolean().optional().describe('Enable motion blur'),
        intensity: z.number().optional().describe('Motion blur intensity'),
        jitter: z.number().optional().describe('Sample jitter amount'),
        samples: z.number().optional().describe('Number of blur samples'),
      })
      .optional()
      .describe('Per-object motion blur from camera and object movement'),
  })
  .describe('Post-processing effects');

export type PostProcessingDescriptor = z.infer<typeof PostProcessingDescriptorSchema>;

export const RenderEnvironmentSchema = z
  .object({
    toneMapping: ToneMappingDescriptorSchema.optional().describe('Tone mapping configuration'),
    postProcessing: PostProcessingDescriptorSchema.optional().describe(
      'Post-processing effects (bloom, vignette, SSAO, SSR, ...)',
    ),
    rendering: buildRenderingZod()
      .optional()
      .describe(
        'Render feature toggles (auto-batching, culling, LOD, shadows, etc.). Omit a field to inherit the engine default. Derived from the render-feature registry.',
      ),
  })
  .describe('Renderer-level settings read by setup/setup-renderer.ts');

export type RenderEnvironment = z.infer<typeof RenderEnvironmentSchema>;
