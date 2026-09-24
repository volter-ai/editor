import { z } from 'zod';
import { Vec3Schema } from './tuples';

// --- Value Generators (mirrors quarks.core FunctionJSON) ---

const ConstantValueSchema = z.object({
  type: z.literal('ConstantValue'),
  value: z.number(),
});

const IntervalValueSchema = z.object({
  type: z.literal('IntervalValue'),
  a: z.number(),
  b: z.number(),
});

const BezierSchema = z.object({
  p0: z.number(),
  p1: z.number(),
  p2: z.number(),
  p3: z.number(),
});

const PiecewiseBezierSchema = z.object({
  type: z.literal('PiecewiseBezier'),
  functions: z.array(
    z.object({
      function: BezierSchema,
      start: z.number(),
    }),
  ),
});

export const ValueGeneratorSchema = z
  .discriminatedUnion('type', [ConstantValueSchema, IntervalValueSchema, PiecewiseBezierSchema])
  .describe('Numeric value: constant, random interval, or bezier curve');

export type ValueGeneratorJSON = z.infer<typeof ValueGeneratorSchema>;

// --- Color Generators (mirrors quarks.core ColorGenerator JSON) ---

const ColorRGBA = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(),
});

const ColorRGB = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
});

/** ContinuousLinearFunction JSON format used by Gradient internally */
const CLinearColorSchema = z.object({
  type: z.literal('CLinearFunction'),
  subType: z.literal('Color'),
  keys: z.array(z.object({ value: ColorRGB, pos: z.number() })),
});

const CLinearNumberSchema = z.object({
  type: z.literal('CLinearFunction'),
  subType: z.literal('Number'),
  keys: z.array(z.object({ value: z.number(), pos: z.number() })),
});

const ConstantColorSchema = z.object({
  type: z.literal('ConstantColor'),
  color: ColorRGBA,
});

const ColorRangeSchema = z.object({
  type: z.literal('ColorRange'),
  a: ColorRGBA,
  b: ColorRGBA,
});

const GradientSchema = z.object({
  type: z.literal('Gradient'),
  color: CLinearColorSchema,
  alpha: CLinearNumberSchema,
});

const RandomColorBetweenGradientSchema = z.object({
  type: z.literal('RandomColorBetweenGradient'),
  gradient1: GradientSchema,
  gradient2: GradientSchema,
});

export const ColorGeneratorSchema = z
  .discriminatedUnion('type', [
    ConstantColorSchema,
    ColorRangeSchema,
    GradientSchema,
    RandomColorBetweenGradientSchema,
  ])
  .describe('Color generator: constant, range, gradient, or random between gradients');

export type ColorGeneratorJSON = z.infer<typeof ColorGeneratorSchema>;

// --- Emitter Shapes (mirrors quarks.core shape constructor params) ---

const PointEmitterSchema = z.object({ type: z.literal('point') });

const SphereEmitterSchema = z.object({
  type: z.literal('sphere'),
  radius: z.number().optional().describe('Sphere radius'),
  arc: z.number().optional().describe('Arc angle in radians (2π = full sphere)'),
  thickness: z.number().optional().describe('Shell thickness 0–1 (1 = solid, 0 = surface only)'),
});

const HemisphereEmitterSchema = z.object({
  type: z.literal('hemisphere'),
  radius: z.number().optional().describe('Hemisphere radius'),
  arc: z.number().optional().describe('Arc angle in radians'),
  thickness: z.number().optional().describe('Shell thickness 0–1'),
});

const ConeEmitterSchema = z.object({
  type: z.literal('cone'),
  radius: z.number().optional().describe('Cone base radius'),
  arc: z.number().optional().describe('Arc angle in radians'),
  thickness: z.number().optional().describe('Shell thickness 0–1'),
  angle: z.number().optional().describe('Cone opening angle in radians'),
});

const CircleEmitterSchema = z.object({
  type: z.literal('circle'),
  radius: z.number().optional().describe('Circle radius'),
  arc: z.number().optional().describe('Arc angle in radians'),
  thickness: z.number().optional().describe('Ring thickness 0–1'),
});

const DonutEmitterSchema = z.object({
  type: z.literal('donut'),
  radius: z.number().optional().describe('Donut major radius'),
  arc: z.number().optional().describe('Arc angle in radians'),
  thickness: z.number().optional().describe('Ring thickness 0–1'),
  donutRadius: z.number().optional().describe('Donut tube (minor) radius'),
});

const RectangleEmitterSchema = z.object({
  type: z.literal('rectangle'),
  width: z.number().optional().describe('Rectangle width'),
  height: z.number().optional().describe('Rectangle height'),
  thickness: z.number().optional().describe('Extrusion depth 0–1'),
});

const GridEmitterSchema = z.object({
  type: z.literal('grid'),
  width: z.number().optional().describe('Grid total width'),
  height: z.number().optional().describe('Grid total height'),
  column: z.number().int().optional().describe('Number of columns'),
  row: z.number().int().optional().describe('Number of rows'),
});

export const EmitterShapeSchema = z
  .discriminatedUnion('type', [
    PointEmitterSchema,
    SphereEmitterSchema,
    HemisphereEmitterSchema,
    ConeEmitterSchema,
    CircleEmitterSchema,
    DonutEmitterSchema,
    RectangleEmitterSchema,
    GridEmitterSchema,
  ])
  .describe('Particle emitter shape');

export type EmitterShapeJSON = z.infer<typeof EmitterShapeSchema>;

// --- Behaviors (mirrors quarks.core behavior toJSON) ---

const ApplyForceBehaviorSchema = z.object({
  type: z.literal('ApplyForce'),
  direction: Vec3Schema.describe('Force direction vector'),
  magnitude: ValueGeneratorSchema.describe('Force magnitude'),
});

const ColorOverLifeBehaviorSchema = z.object({
  type: z.literal('ColorOverLife'),
  color: ColorGeneratorSchema.describe('Color curve over particle lifetime'),
});

const SizeOverLifeBehaviorSchema = z.object({
  type: z.literal('SizeOverLife'),
  size: ValueGeneratorSchema.describe('Size curve over particle lifetime'),
});

const SpeedOverLifeBehaviorSchema = z.object({
  type: z.literal('SpeedOverLife'),
  speed: ValueGeneratorSchema.describe('Speed multiplier curve over lifetime'),
});

const RotationOverLifeBehaviorSchema = z.object({
  type: z.literal('RotationOverLife'),
  angularVelocity: ValueGeneratorSchema.describe('Angular velocity in radians/sec'),
});

const ForceOverLifeBehaviorSchema = z.object({
  type: z.literal('ForceOverLife'),
  x: ValueGeneratorSchema.describe('Force along X axis over lifetime'),
  y: ValueGeneratorSchema.describe('Force along Y axis over lifetime'),
  z: ValueGeneratorSchema.describe('Force along Z axis over lifetime'),
});

const OrbitOverLifeBehaviorSchema = z.object({
  type: z.literal('OrbitOverLife'),
  orbitSpeed: ValueGeneratorSchema.describe('Orbit speed over lifetime'),
  axis: Vec3Schema.optional().describe('Orbit axis. Defaults to [0, 1, 0]'),
});

const NoiseBehaviorSchema = z.object({
  type: z.literal('Noise'),
  frequency: ValueGeneratorSchema.describe('Noise frequency'),
  power: ValueGeneratorSchema.describe('Noise amplitude'),
  positionAmount: ValueGeneratorSchema.optional().describe('Position displacement amount'),
  rotationAmount: ValueGeneratorSchema.optional().describe('Rotation displacement amount'),
});

const TurbulenceFieldBehaviorSchema = z.object({
  type: z.literal('TurbulenceField'),
  scale: Vec3Schema.describe('Turbulence field scale'),
  octaves: z.number().int().describe('Noise octave count'),
  velocityMultiplier: Vec3Schema.describe('Velocity multiplier per axis'),
  timeScale: Vec3Schema.describe('Time scale per axis'),
});

const FrameOverLifeBehaviorSchema = z.object({
  type: z.literal('FrameOverLife'),
  frame: ValueGeneratorSchema.describe('Sprite sheet frame index over lifetime'),
});

const LimitSpeedOverLifeBehaviorSchema = z.object({
  type: z.literal('LimitSpeedOverLife'),
  speed: ValueGeneratorSchema.describe('Maximum speed over lifetime'),
  dampen: z.number().describe('Damping factor when speed exceeds limit (0–1)'),
});

const ChangeEmitDirectionBehaviorSchema = z.object({
  type: z.literal('ChangeEmitDirection'),
  angle: ValueGeneratorSchema.describe('Angle deviation from original emit direction'),
});

const GravityForceBehaviorSchema = z.object({
  type: z.literal('GravityForce'),
  center: Vec3Schema.describe('Gravity center point'),
  magnitude: z.number().describe('Gravity force strength'),
});

const WidthOverLengthBehaviorSchema = z.object({
  type: z.literal('WidthOverLength'),
  width: ValueGeneratorSchema.describe('Trail width over trail length'),
});

export const BehaviorSchema = z
  .discriminatedUnion('type', [
    ApplyForceBehaviorSchema,
    ColorOverLifeBehaviorSchema,
    SizeOverLifeBehaviorSchema,
    SpeedOverLifeBehaviorSchema,
    RotationOverLifeBehaviorSchema,
    ForceOverLifeBehaviorSchema,
    OrbitOverLifeBehaviorSchema,
    NoiseBehaviorSchema,
    TurbulenceFieldBehaviorSchema,
    FrameOverLifeBehaviorSchema,
    LimitSpeedOverLifeBehaviorSchema,
    ChangeEmitDirectionBehaviorSchema,
    GravityForceBehaviorSchema,
    WidthOverLengthBehaviorSchema,
  ])
  .describe('Particle behavior applied over lifetime');

export type BehaviorJSON = z.infer<typeof BehaviorSchema>;

// --- Render Mode ---

export const RenderModeSchema = z
  .enum([
    'billboard',
    'stretchedBillboard',
    'mesh',
    'trail',
    'horizontalBillboard',
    'verticalBillboard',
  ])
  .describe('How particles are rendered');

// --- Particle Material (our format — asset paths, not Three.js UUIDs) ---

/**
 * The sprite `map`'s SAMPLER — how the image is addressed outside [0,1], interpolated, and
 * mip-chained. Separate from the URL because two emitters can name one image and want different
 * sampling of it; the factory caches per URL *and* sampler for exactly that reason.
 *
 * An absent field leaves three's own default alone (clamp-to-edge, linear, mipmapped, anisotropy
 * 1) rather than restating it — the same "absent means the loader's default" contract the rest of
 * this descriptor keeps. `map`'s COLOUR SPACE is deliberately not here: a `map` is always a colour
 * texture, so the factory states sRGB unconditionally (see `particles-factory.ts`).
 */
const ParticleMapSamplerSchema = z
  .object({
    wrap: z
      .enum(['clamp', 'repeat', 'mirror'])
      .optional()
      .describe('How UVs outside [0,1] address the sprite image (three wrapS/wrapT)'),
    filter: z
      .enum(['linear', 'nearest'])
      .optional()
      .describe('Texel interpolation — nearest keeps a pixel-art sprite crisp'),
    mipmaps: z.boolean().optional().describe('Generate and sample a mip chain'),
    anisotropy: z
      .number()
      .optional()
      .describe('Anisotropic filtering samples, for sprites viewed at grazing angles'),
  })
  .describe('Sprite texture sampler state');

const ParticleMaterialSchema = z
  .object({
    type: z.enum(['basic', 'standard']).optional().describe('Particle material shading model'),
    color: z.string().optional().describe('Particle color as CSS hex string'),
    map: z.string().optional().describe('Path to particle sprite texture'),
    mapSampler: ParticleMapSamplerSchema.optional().describe(
      'Sampler state applied to the sprite texture named by `map`',
    ),
    blending: z
      .enum(['normal', 'additive'])
      .optional()
      .describe('Blending mode (additive for glowing/fire effects)'),
    transparent: z.boolean().optional().describe('Enable transparency'),
    depthWrite: z
      .boolean()
      .optional()
      .describe('Write to depth buffer (disable for additive effects)'),
    side: z.enum(['front', 'back', 'double']).optional().describe('Which face sides to render'),
  })
  .describe('Particle material settings');

// --- Burst ---

const BurstSchema = z
  .object({
    time: z.number().describe('Time offset in seconds within the emission cycle'),
    count: ValueGeneratorSchema.describe('Number of particles to emit'),
    cycle: z.number().optional().describe('Burst repeat interval in seconds'),
    interval: z.number().optional().describe('Delay between burst repetitions'),
    probability: z.number().optional().describe('Chance of burst firing (0–1)'),
  })
  .describe('Timed particle burst');

// --- Top-level ParticlesDescriptor ---

export const ParticlesDescriptorSchema = z
  .object({
    // Lifecycle
    autoDestroy: z
      .boolean()
      .optional()
      .describe('Destroy the particle system when all particles have died'),
    looping: z.boolean().optional().describe('Continuously emit particles'),
    prewarm: z
      .boolean()
      .optional()
      .describe('Simulate one full cycle on start so particles appear immediately'),
    duration: z.number().optional().describe('Total emission duration in seconds'),

    // Shape
    shape: EmitterShapeSchema.optional().describe(
      'Emitter shape that defines where particles spawn',
    ),

    // Per-particle initial values
    startLife: ValueGeneratorSchema.optional().describe('Initial particle lifetime in seconds'),
    startSpeed: ValueGeneratorSchema.optional().describe('Initial particle speed'),
    startSize: ValueGeneratorSchema.optional().describe('Initial particle size'),
    startRotation: ValueGeneratorSchema.optional().describe('Initial particle rotation in radians'),
    startColor: ColorGeneratorSchema.optional().describe('Initial particle color'),
    startLength: ValueGeneratorSchema.optional().describe(
      'Initial trail length (trail render mode only)',
    ),
    startTileIndex: ValueGeneratorSchema.optional().describe('Initial sprite sheet tile index'),

    // Emission
    emissionOverTime: ValueGeneratorSchema.optional().describe('Particles emitted per second'),
    emissionOverDistance: ValueGeneratorSchema.optional().describe(
      'Particles emitted per unit of emitter movement',
    ),
    emissionBursts: z.array(BurstSchema).optional().describe('Timed burst emissions'),

    // Behaviors
    behaviors: z
      .array(BehaviorSchema)
      .optional()
      .describe('Behaviors applied to particles over their lifetime'),

    // Rendering
    renderMode: RenderModeSchema.optional().describe(
      'How particles are rendered (billboard, trail, mesh, etc.)',
    ),
    worldSpace: z
      .boolean()
      .optional()
      .describe('Simulate particles in world space instead of local space'),
    renderOrder: z
      .number()
      .optional()
      .describe('Render order for sorting (higher = rendered later)'),
    uTileCount: z.number().int().optional().describe('Horizontal tile count in sprite sheet'),
    vTileCount: z.number().int().optional().describe('Vertical tile count in sprite sheet'),
    blendTiles: z
      .boolean()
      .optional()
      .describe('Blend between sprite sheet tiles for smooth animation'),
    softParticles: z.boolean().optional().describe('Enable soft particle depth fading'),
    softFarFade: z.number().optional().describe('Far fade distance for soft particles'),
    softNearFade: z.number().optional().describe('Near fade distance for soft particles'),

    // Material
    material: ParticleMaterialSchema.describe('Particle material settings'),
  })
  .describe('Particle system configuration');

export type ParticlesDescriptor = z.infer<typeof ParticlesDescriptorSchema>;
