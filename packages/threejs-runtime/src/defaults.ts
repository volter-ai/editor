/**
 * Single source of truth for default values the engine's factories read.
 *
 * A group belongs here only while a FACTORY reads it. A default with no
 * reader is dead documentation: it looks authoritative, nothing consults it,
 * and it drifts from the value the code actually uses. Restating a library's
 * own constructor values (THREE's `Object3D` transform, say) is the same
 * mistake in a different shape — the library is already the source of truth.
 * So when a factory goes, its group goes with it.
 */
export const DEFAULTS = {
  material: {
    type: 'standard' as const,
    color: '#888888',
    metalness: 0,
    roughness: 0.5,
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    transparent: false,
    side: 'front' as const,
    flatShading: false,
    clearcoat: { clearcoat: 1, clearcoatRoughness: 0 },
    transmission: { transmission: 1, ior: 1.5, thickness: 0.5 },
    sheen: { sheen: 1, sheenColor: '#ffffff', sheenRoughness: 0.5 },
    iridescence: {
      iridescence: 1,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [100, 400] as [number, number],
    },
    displacementScale: 1,
    displacementBias: 0,
  },

  light: {
    color: '#ffffff',
    intensity: 1,
    groundColor: '#000000',
    distance: 0,
    decay: 2,
    angle: Math.PI / 6,
    penumbra: 0,
    // three.js's own RectAreaLight constructor defaults (area lights only).
    width: 10,
    height: 10,
  },

  camera: {
    fov: 60,
    near: 0.1,
    far: 1000,
    orthoSize: 5,
    width: 1920,
    height: 1080,
  },

  collider: {
    cuboid: { halfExtents: [0.5, 0.5, 0.5] as [number, number, number] },
    ball: { radius: 0.5 },
    capsule: { radius: 0.25, halfHeight: 0.5 },
  },

  toneMapping: {
    // T1.13: the effective renderer default is ACES (see
    // setup-renderer.ts's `createHostRenderer` + `applyScenePostProcessing`,
    // which both hardcode `THREE.ACESFilmicToneMapping`/'aces' as the
    // fallback when a scene omits `environment.toneMapping`) — NOT 'none'.
    // This used to say 'none', silently disagreeing with the runtime and
    // with the editor's Tone Mapping inspector dropdown.
    mode: 'aces' as const,
    exposure: 1.0,
  },

  postProcessing: {
    bloom: { intensity: 1.0, luminanceThreshold: 0.9, luminanceSmoothing: 0.025 },
    vignette: { darkness: 0.5, offset: 0.5 },
    brightnessContrast: { brightness: 0, contrast: 0 },
    hueSaturation: { hue: 0, saturation: 0 },
    sepia: { intensity: 1.0 },
    colorDepth: { bits: 16 },
    chromaticAberration: { offsetX: 0.002, offsetY: 0.002, modulationOffset: 0.15 },
    lensDistortion: { distortionX: 0, distortionY: 0, focalLengthX: 1, focalLengthY: 1, skew: 0 },
    depthOfField: { worldFocusDistance: 10, worldFocusRange: 5, bokehScale: 3, focalLength: 0.04 },
    tiltShift: { offset: 0, rotation: 0, focusArea: 0.4, feather: 0.3 },
    noise: { premultiply: false },
    scanline: { density: 1.25 },
    dotScreen: { angle: 1.57, scale: 1.0 },
    grid: { scale: 1.0, lineWidth: 0.0 },
    pixelation: { granularity: 6 },
    glitch: {
      delayX: 1.5,
      delayY: 3.5,
      durationX: 0.6,
      durationY: 1.0,
      strengthX: 0.3,
      strengthY: 1.0,
      columns: 0.05,
      ratio: 0.85,
    },
    shockWave: { speed: 2, maxRadius: 1, waveSize: 0.2, amplitude: 0.05 },
    smaa: { preset: 'high' as const },
    ssao: { radius: 0.05, intensity: 2.0, bias: 0.025, samples: 16, rings: 7, fade: 0.01 },
    n8ao: {
      aoSamples: 16,
      aoRadius: 5.0,
      intensity: 5,
      denoiseSamples: 8,
      denoiseRadius: 12,
      distanceFalloff: 1.0,
    },
    godRays: { density: 0.96, decay: 0.93, weight: 0.4, exposure: 0.6, samples: 60 },
    outline: {
      edgeStrength: 3,
      pulseSpeed: 0,
      visibleEdgeColor: '#ffffff',
      hiddenEdgeColor: '#22090a',
    },
    ssr: { intensity: 1, exponent: 1, distance: 10, thickness: 10, maxRoughness: 1 },
    ssgi: { intensity: 1, distance: 10, thickness: 10, maxRoughness: 1 },
    motionBlur: { intensity: 1, jitter: 1, samples: 16 },
  },

  navigation: {
    cellSize: 0.3,
    cellHeight: 0.2,
    walkableSlopeAngle: 45,
    walkableHeight: 2,
    walkableClimb: 1,
    walkableRadius: 0.5,
    maxEdgeLen: 12,
    maxSimplificationError: 1.3,
    minRegionArea: 8,
    mergeRegionArea: 20,
  },
} as const;
