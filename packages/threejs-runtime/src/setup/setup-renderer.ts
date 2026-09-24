/// <reference path="../types-n8ao.d.ts" />

import { N8AOPostPass } from 'n8ao';
import {
  BloomEffect,
  BrightnessContrastEffect,
  ChromaticAberrationEffect,
  ColorDepthEffect,
  DepthOfFieldEffect,
  DotScreenEffect,
  type Effect,
  type EffectComposer,
  EffectPass,
  GlitchEffect,
  GodRaysEffect,
  GridEffect,
  HueSaturationEffect,
  LensDistortionEffect,
  NoiseEffect,
  NormalPass,
  OutlineEffect,
  PixelationEffect,
  RenderPass,
  ScanlineEffect,
  SepiaEffect,
  ShockWaveEffect,
  SMAAEffect,
  SMAAPreset,
  SSAOEffect,
  TiltShiftEffect,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import {
  MotionBlurEffect,
  SSGIEffect,
  SSREffect,
  VelocityDepthNormalPass,
} from '../../vendor/realism-effects/dist/index.js';
import type { RenderEnvironment } from '../asset-formats/render-env';
import { DEFAULTS } from '../defaults';
import { detectKtx2Support } from '../loader';
import { type RenderScope, resolveRenderSettings } from '../render/render-settings';

/**
 * Apply the live renderer-level render settings (shadows, resolution scale) from
 * the resolved cascade. `antialias`/`backend` are reload-only (renderer re-init)
 * and are handled at construction, not here. Pass the scene `rendering` scope
 * (e.g. `env.rendering`); absent values fall back to the registry defaults so
 * behavior is unchanged when a scene omits `rendering`.
 *
 * `basePixelRatio` is the call-site's native pixel-ratio policy (the runtime caps
 * at 2; the editor uses the raw devicePixelRatio); `resolutionScale` multiplies it.
 */
export function applyRendererSettings(
  renderer: THREE.WebGLRenderer,
  rendering?: RenderScope,
  basePixelRatio = Math.min(window.devicePixelRatio, 2),
): void {
  const settings = resolveRenderSettings(rendering);
  renderer.shadowMap.enabled = Boolean(settings['shadows']);
  const scale = Number(settings['resolutionScale']) || 1;
  renderer.setPixelRatio(basePixelRatio * scale);
}

/**
 * Create ONLY the WebGL renderer. The HOST owns the renderer (see
 * `ThreeHostContext.renderer`); the game/adapter owns the scene/camera/composer it
 * renders into.
 *
 * `rendering` is the scene-level render scope (`env.rendering`); it seeds the
 * reload-only `antialias` option at construction and the live shadow/resolution
 * settings (via {@link applyRendererSettings}). Absent → registry defaults.
 *
 * When `opts` is omitted, construction leaves `alpha` and
 * `preserveDrawingBuffer` at their renderer defaults. The host passes
 * `alpha:true` for every stacked canvas
 * above the bottom one (so its clear-alpha-0 shows the layer below through
 * it) and `preserveDrawingBuffer:true` for every stacked canvas (the
 * recorded capture-tier cost, paid once here rather than re-derived later).
 */
export function createHostRenderer(
  canvas: HTMLCanvasElement,
  width = window.innerWidth,
  height = window.innerHeight,
  rendering?: RenderScope,
  opts?: { alpha?: boolean; preserveDrawingBuffer?: boolean },
): THREE.WebGLRenderer {
  // A newly-shown editor tab can report 0x0 for one layout frame. WebGL render
  // targets cannot have zero-sized attachments, so boot at the smallest valid
  // backing size and let the normal resize path apply the real dimensions.
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const settings = resolveRenderSettings(rendering);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: Boolean(settings['antialias']),
    powerPreference: 'high-performance',
    ...(opts?.alpha ? { alpha: true } : {}),
    ...(opts?.preserveDrawingBuffer ? { preserveDrawingBuffer: true } : {}),
  });
  renderer.setSize(safeWidth, safeHeight);
  applyRendererSettings(renderer, rendering);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = toneMappingModes[DEFAULTS.toneMapping.mode] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DEFAULTS.toneMapping.exposure;
  // The shared KTX2Loader cannot transcode a KHR_texture_basisu texture until
  // some renderer has told it which compressed formats this GPU accepts.
  // Idempotent — see `detectKtx2Support`.
  detectKtx2Support(renderer);
  return renderer;
}

const toneMappingModes: Record<string, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
};

const smaaPresets: Record<string, SMAAPreset> = {
  low: SMAAPreset.LOW,
  medium: SMAAPreset.MEDIUM,
  high: SMAAPreset.HIGH,
  ultra: SMAAPreset.ULTRA,
};

/**
 * Rebuild composer passes from scene environment settings.
 * Scenes without toneMapping default to ACES (the runtime default).
 * Code can further modify the composer after this call.
 *
 * Pass objectMap to enable entity-referencing effects (godRays, outline).
 * Pass entities to resolve tag-based references (outline).
 */
export function applyScenePostProcessing(
  composer: EffectComposer,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  env?: RenderEnvironment,
  objectMap?: Map<string, THREE.Object3D>,
  entityTags?: Map<string, string[]>,
): void {
  // Dispose the existing passes before discarding them — removeAllPasses() just
  // drops the references, so their GPU render targets would otherwise leak on
  // every env edit / scene switch.
  for (const pass of composer.passes) {
    (pass as { dispose?: () => void }).dispose?.();
  }
  composer.removeAllPasses();
  composer.addPass(new RenderPass(scene, camera));

  // ── Tone mapping ──────────────────────────────────────────────────────
  const tm = env?.toneMapping;
  renderer.toneMapping =
    toneMappingModes[tm?.mode ?? DEFAULTS.toneMapping.mode] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = tm?.exposure ?? DEFAULTS.toneMapping.exposure;

  // ── Master switch ─────────────────────────────────────────────────────
  // When post-processing is disabled at the scene/engine level, render the
  // plain scene (the RenderPass added above) and skip every effect pass. The
  // per-effect `enabled` flags below still apply when the master switch is on.
  if (!resolveRenderSettings(env?.rendering as RenderScope | undefined)['postProcessing']) return;

  const pp = env?.postProcessing;
  const d = DEFAULTS.postProcessing;

  // ── Prerequisite passes ───────────────────────────────────────────────

  // NormalPass — needed by SSAO
  let normalPass: NormalPass | undefined;
  if (pp?.ssao?.enabled) {
    normalPass = new NormalPass(scene, camera);
    composer.addPass(normalPass);
  }

  // VelocityDepthNormalPass — needed by SSR, SSGI, MotionBlur
  let velocityPass: VelocityDepthNormalPass | undefined;
  if (pp?.ssr?.enabled || pp?.ssgi?.enabled || pp?.motionBlur?.enabled) {
    velocityPass = new VelocityDepthNormalPass(scene, camera);
    composer.addPass(velocityPass);
  }

  // N8AOPostPass — separate Pass, not an Effect
  if (pp?.n8ao?.enabled) {
    const n8aoPass = new N8AOPostPass(scene, camera as THREE.Camera);
    const cfg = n8aoPass.configuration;
    cfg.aoSamples = pp.n8ao.aoSamples ?? d.n8ao.aoSamples;
    cfg.aoRadius = pp.n8ao.aoRadius ?? d.n8ao.aoRadius;
    cfg.intensity = pp.n8ao.intensity ?? d.n8ao.intensity;
    cfg.denoiseSamples = pp.n8ao.denoiseSamples ?? d.n8ao.denoiseSamples;
    cfg.denoiseRadius = pp.n8ao.denoiseRadius ?? d.n8ao.denoiseRadius;
    cfg.distanceFalloff = pp.n8ao.distanceFalloff ?? d.n8ao.distanceFalloff;
    if (pp.n8ao.screenSpaceRadius !== undefined) cfg.screenSpaceRadius = pp.n8ao.screenSpaceRadius;
    if (pp.n8ao.halfRes !== undefined) cfg.halfRes = pp.n8ao.halfRes;
    if (pp.n8ao.color) cfg.color = new THREE.Color(pp.n8ao.color);
    composer.addPass(n8aoPass);
  }

  // ── Collect Effect instances ──────────────────────────────────────────
  const effects: Effect[] = [];

  // Anti-aliasing
  if (pp?.smaa?.enabled) {
    const preset = smaaPresets[pp.smaa.preset ?? d.smaa.preset] ?? SMAAPreset.HIGH;
    effects.push(new SMAAEffect({ preset }));
  }

  // Ambient occlusion
  if (pp?.ssao?.enabled && normalPass) {
    effects.push(
      new SSAOEffect(camera, normalPass.texture, {
        radius: pp.ssao.radius ?? d.ssao.radius,
        intensity: pp.ssao.intensity ?? d.ssao.intensity,
        bias: pp.ssao.bias ?? d.ssao.bias,
        samples: pp.ssao.samples ?? d.ssao.samples,
        rings: pp.ssao.rings ?? d.ssao.rings,
        fade: pp.ssao.fade ?? d.ssao.fade,
        ...(pp.ssao.color ? { color: new THREE.Color(pp.ssao.color) } : {}),
      }),
    );
  }

  // SSR (realism-effects)
  if (pp?.ssr?.enabled && velocityPass) {
    effects.push(
      new SSREffect(scene, camera, velocityPass, {
        intensity: pp.ssr.intensity ?? d.ssr.intensity,
        exponent: pp.ssr.exponent ?? d.ssr.exponent,
        distance: pp.ssr.distance ?? d.ssr.distance,
        thickness: pp.ssr.thickness ?? d.ssr.thickness,
        maxRoughness: pp.ssr.maxRoughness ?? d.ssr.maxRoughness,
      }),
    );
  }

  // SSGI (realism-effects)
  if (pp?.ssgi?.enabled && velocityPass) {
    effects.push(
      new SSGIEffect(scene, camera, velocityPass, {
        intensity: pp.ssgi.intensity ?? d.ssgi.intensity,
        distance: pp.ssgi.distance ?? d.ssgi.distance,
        thickness: pp.ssgi.thickness ?? d.ssgi.thickness,
        maxRoughness: pp.ssgi.maxRoughness ?? d.ssgi.maxRoughness,
      }),
    );
  }

  // Motion blur (realism-effects)
  if (pp?.motionBlur?.enabled && velocityPass) {
    effects.push(
      new MotionBlurEffect(velocityPass, {
        intensity: pp.motionBlur.intensity ?? d.motionBlur.intensity,
        jitter: pp.motionBlur.jitter ?? d.motionBlur.jitter,
        samples: pp.motionBlur.samples ?? d.motionBlur.samples,
      }),
    );
  }

  // Bloom
  if (pp?.bloom?.enabled) {
    effects.push(
      new BloomEffect({
        intensity: pp.bloom.intensity ?? d.bloom.intensity,
        luminanceThreshold: pp.bloom.luminanceThreshold ?? d.bloom.luminanceThreshold,
        luminanceSmoothing: pp.bloom.luminanceSmoothing ?? d.bloom.luminanceSmoothing,
      }),
    );
  }

  // Depth of field
  if (pp?.depthOfField?.enabled) {
    effects.push(
      new DepthOfFieldEffect(camera, {
        worldFocusDistance: pp.depthOfField.worldFocusDistance ?? d.depthOfField.worldFocusDistance,
        worldFocusRange: pp.depthOfField.worldFocusRange ?? d.depthOfField.worldFocusRange,
        bokehScale: pp.depthOfField.bokehScale ?? d.depthOfField.bokehScale,
        focalLength: pp.depthOfField.focalLength ?? d.depthOfField.focalLength,
      }),
    );
  }

  // Tilt shift
  if (pp?.tiltShift?.enabled) {
    effects.push(
      new TiltShiftEffect({
        offset: pp.tiltShift.offset ?? d.tiltShift.offset,
        rotation: pp.tiltShift.rotation ?? d.tiltShift.rotation,
        focusArea: pp.tiltShift.focusArea ?? d.tiltShift.focusArea,
        feather: pp.tiltShift.feather ?? d.tiltShift.feather,
      }),
    );
  }

  // God rays (needs entity reference)
  if (pp?.godRays?.enabled && pp.godRays.sourceEntity && objectMap) {
    const lightObj = objectMap.get(pp.godRays.sourceEntity);
    if (lightObj instanceof THREE.Mesh || lightObj instanceof THREE.Points) {
      effects.push(
        new GodRaysEffect(camera, lightObj, {
          density: pp.godRays.density ?? d.godRays.density,
          decay: pp.godRays.decay ?? d.godRays.decay,
          weight: pp.godRays.weight ?? d.godRays.weight,
          exposure: pp.godRays.exposure ?? d.godRays.exposure,
          samples: pp.godRays.samples ?? d.godRays.samples,
        }),
      );
    }
  }

  // Outline (needs entity tag references)
  if (pp?.outline?.enabled && objectMap) {
    const outlineEffect = new OutlineEffect(scene, camera, {
      edgeStrength: pp.outline.edgeStrength ?? d.outline.edgeStrength,
      pulseSpeed: pp.outline.pulseSpeed ?? d.outline.pulseSpeed,
      visibleEdgeColor: pp.outline.visibleEdgeColor
        ? new THREE.Color(pp.outline.visibleEdgeColor).getHex()
        : new THREE.Color(d.outline.visibleEdgeColor).getHex(),
      hiddenEdgeColor: pp.outline.hiddenEdgeColor
        ? new THREE.Color(pp.outline.hiddenEdgeColor).getHex()
        : new THREE.Color(d.outline.hiddenEdgeColor).getHex(),
      xRay: pp.outline.xRay ?? false,
    });

    // Add entities matching tags to selection
    const tags = pp.outline.tags ?? [];
    if (tags.length > 0 && entityTags) {
      for (const [entityId, eTags] of entityTags) {
        if (tags.some((t) => eTags.includes(t))) {
          const obj = objectMap.get(entityId);
          if (obj) outlineEffect.selection.add(obj);
        }
      }
    }

    effects.push(outlineEffect);
  }

  // Chromatic aberration
  if (pp?.chromaticAberration?.enabled) {
    effects.push(
      new ChromaticAberrationEffect({
        offset: new THREE.Vector2(
          pp.chromaticAberration.offsetX ?? d.chromaticAberration.offsetX,
          pp.chromaticAberration.offsetY ?? d.chromaticAberration.offsetY,
        ),
        radialModulation: pp.chromaticAberration.radialModulation ?? false,
        modulationOffset:
          pp.chromaticAberration.modulationOffset ?? d.chromaticAberration.modulationOffset,
      }),
    );
  }

  // Lens distortion
  if (pp?.lensDistortion?.enabled) {
    effects.push(
      new LensDistortionEffect({
        distortion: new THREE.Vector2(
          pp.lensDistortion.distortionX ?? d.lensDistortion.distortionX,
          pp.lensDistortion.distortionY ?? d.lensDistortion.distortionY,
        ),
        principalPoint: new THREE.Vector2(0, 0),
        focalLength: new THREE.Vector2(
          pp.lensDistortion.focalLengthX ?? d.lensDistortion.focalLengthX,
          pp.lensDistortion.focalLengthY ?? d.lensDistortion.focalLengthY,
        ),
        skew: pp.lensDistortion.skew ?? d.lensDistortion.skew,
      }),
    );
  }

  // Shock wave
  if (pp?.shockWave?.enabled) {
    effects.push(
      new ShockWaveEffect(
        camera,
        new THREE.Vector3(
          pp.shockWave.positionX ?? 0,
          pp.shockWave.positionY ?? 0,
          pp.shockWave.positionZ ?? 0,
        ),
        {
          speed: pp.shockWave.speed ?? d.shockWave.speed,
          maxRadius: pp.shockWave.maxRadius ?? d.shockWave.maxRadius,
          waveSize: pp.shockWave.waveSize ?? d.shockWave.waveSize,
          amplitude: pp.shockWave.amplitude ?? d.shockWave.amplitude,
        },
      ),
    );
  }

  // Color adjustments
  if (pp?.brightnessContrast?.enabled) {
    effects.push(
      new BrightnessContrastEffect({
        brightness: pp.brightnessContrast.brightness ?? d.brightnessContrast.brightness,
        contrast: pp.brightnessContrast.contrast ?? d.brightnessContrast.contrast,
      }),
    );
  }

  if (pp?.hueSaturation?.enabled) {
    effects.push(
      new HueSaturationEffect({
        hue: pp.hueSaturation.hue ?? d.hueSaturation.hue,
        saturation: pp.hueSaturation.saturation ?? d.hueSaturation.saturation,
      }),
    );
  }

  if (pp?.sepia?.enabled) {
    effects.push(new SepiaEffect({ intensity: pp.sepia.intensity ?? d.sepia.intensity }));
  }

  if (pp?.colorDepth?.enabled) {
    effects.push(new ColorDepthEffect({ bits: pp.colorDepth.bits ?? d.colorDepth.bits }));
  }

  // Film / retro
  if (pp?.noise?.enabled) {
    effects.push(new NoiseEffect({ premultiply: pp.noise.premultiply ?? d.noise.premultiply }));
  }

  if (pp?.scanline?.enabled) {
    effects.push(new ScanlineEffect({ density: pp.scanline.density ?? d.scanline.density }));
  }

  if (pp?.dotScreen?.enabled) {
    effects.push(
      new DotScreenEffect({
        angle: pp.dotScreen.angle ?? d.dotScreen.angle,
        scale: pp.dotScreen.scale ?? d.dotScreen.scale,
      }),
    );
  }

  if (pp?.grid?.enabled) {
    effects.push(
      new GridEffect({
        scale: pp.grid.scale ?? d.grid.scale,
        lineWidth: pp.grid.lineWidth ?? d.grid.lineWidth,
      }),
    );
  }

  if (pp?.pixelation?.enabled) {
    effects.push(new PixelationEffect(pp.pixelation.granularity ?? d.pixelation.granularity));
  }

  if (pp?.glitch?.enabled) {
    effects.push(
      new GlitchEffect({
        delay: new THREE.Vector2(
          pp.glitch.delayX ?? d.glitch.delayX,
          pp.glitch.delayY ?? d.glitch.delayY,
        ),
        duration: new THREE.Vector2(
          pp.glitch.durationX ?? d.glitch.durationX,
          pp.glitch.durationY ?? d.glitch.durationY,
        ),
        strength: new THREE.Vector2(
          pp.glitch.strengthX ?? d.glitch.strengthX,
          pp.glitch.strengthY ?? d.glitch.strengthY,
        ),
        columns: pp.glitch.columns ?? d.glitch.columns,
        ratio: pp.glitch.ratio ?? d.glitch.ratio,
      }),
    );
  }

  // Vignette (last color effect)
  if (pp?.vignette?.enabled) {
    effects.push(
      new VignetteEffect({
        darkness: pp.vignette.darkness ?? d.vignette.darkness,
        offset: pp.vignette.offset ?? d.vignette.offset,
      }),
    );
  }

  // ── Merge all effects into a single EffectPass ────────────────────────
  if (effects.length > 0) {
    composer.addPass(new EffectPass(camera, ...effects));
  }
}

/**
 * Apply every authored scene-level renderer setting through one path.
 *
 * Tone mapping is part of the scene environment, not conditional on the
 * presence of post-processing effects. Keeping renderer settings and the
 * composer rebuild together prevents editor/runtime drift for scenes that
 * only author exposure or a tone-mapping mode.
 */
export function applySceneRenderPipeline(
  composer: EffectComposer,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  env?: RenderEnvironment,
  options?: {
    basePixelRatio?: number;
    objectMap?: Map<string, THREE.Object3D>;
    entityTags?: Map<string, string[]>;
  },
): void {
  applyRendererSettings(
    renderer,
    env?.rendering as RenderScope | undefined,
    options?.basePixelRatio,
  );
  applyScenePostProcessing(
    composer,
    renderer,
    scene,
    camera,
    env,
    options?.objectMap,
    options?.entityTags,
  );
}
