/**
 * The STANDARD VIEWPORT dressing — the ONE chrome-and-dressing definition every
 * 3D document viewport inherits (owner-ratified contract). A document surface
 * (`Object3DDocumentViewport` and everything mounted on it: the 3D board,
 * story turntables, model/entity asset documents) gets the editor's standard
 * look from this module instead of instantiating its own background/lighting:
 *
 *  - `scene.environment` baked from three's own `RoomEnvironment` through
 *    `PMREMGenerator`, so PBR materials actually read;
 *  - a subtle dark vertical-gradient backdrop (never a flat hex);
 *  - one NEUTRAL directional key light for definition (it was warm; see the
 *    measurement where it is constructed);
 *  - an optional ground grid following the Scene viewport's grid conventions
 *    (1 m cells, `0x999999`, `EDITOR_LAYER` — see `editor-viewport.ts`),
 *    centred on the content and fading out with distance so it never
 *    degenerates into convergence-line artifacts at the horizon.
 *
 * Everything created here is EDITOR CHROME: marked per `editor-layers.ts`'s
 * conventions (`userData.editorHelper`, and `EDITOR_LAYER` for the grid) so no
 * hierarchy walk, pick, or export ever mistakes it for content — and it is
 * never serialized, never touching project data (the anti-shim rule). It
 * exists only inside the document viewport's scene at view time.
 *
 * Ownership: {@link applyStandardViewportDressing} owns every object and
 * texture it creates, INCLUDING the {@link StandardEnvironment} handed to it
 * (PMREM render targets leak if not disposed). Its returned `dispose` is the
 * one teardown path; it is idempotent.
 *
 * The environment bake lives in `@volter/editor-threejs/viewport/environment`
 * because it is the one GL-bound step — it needs a live `WebGLRenderer`,
 * where the rest of the dressing is plain scene-graph work.
 */

import { invalidateStages } from '../stage-invalidation';
import { contentWorldBounds } from '@volter/editor-threejs/viewport/content-bounds';
import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import { loadEnvironmentImage, type StandardEnvironment } from '@volter/editor-threejs/viewport/environment';
import { setUserData } from '@volter/editor-threejs/ecs/user-data';
import * as THREE from 'three';
import { environmentImage } from '@volter/editor-sdk/kit/environment-images';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import {
  studioPreset,
  type StudioLight,
  type SceneTakeover,
  type StudioPreset,
  type ViewportPresentation,
} from '@volter/editor-sdk/kit/viewport-presentation';

/**
 * Front-right three-quarter view for project-owned R3F components. Their
 * gameplay-forward convention is −Z, so the camera belongs on that side of
 * the subject. The 3D board and an opened story must never show opposite
 * faces of the same prefab.
 */
export const STANDARD_COMPONENT_CAMERA_DIRECTION = [0.8, 0.5, -1] as const;

/** The standard backdrop, dark at the ground line and lifting toward the top.
 *  These are the STUDIO tints; the painted stops blend them with the active
 *  palette (see {@link paletteBackdropStops}) so a document stage follows the
 *  editor's palette the way the Asset Lab's CSS studio stage does. */
const GRADIENT_BOTTOM = new THREE.Color(0x1e2530);
const GRADIENT_TOP = new THREE.Color(0x4c5b70);

export interface BackdropStops {
  readonly bottom: THREE.Color;
  readonly top: THREE.Color;
}

/**
 * The backdrop's stops for the ACTIVE PALETTE: the ground line is the
 * palette's panel surface and the top is its raised surface, each blended
 * with the studio tint and lifted for ACES. Measured under the Blender
 * palette (panel #303030, raised #3d3d3d) the stage reads as Blender's grey
 * ground instead of a black void; under Classic Graphite it stays within a
 * few steps of the studio constants. Falls back to the studio constants
 * where no palette is installed (a bounded host, headless).
 */
export function paletteBackdropStops(): BackdropStops {
  const root =
    typeof document === 'undefined' ? null : document.querySelector('[data-vgai-palette]');
  if (!root) return { bottom: GRADIENT_BOTTOM.clone(), top: GRADIENT_TOP.clone() };
  const style = getComputedStyle(root);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  const read = (name: string, fallback: THREE.Color): THREE.Color => {
    const value = style.getPropertyValue(name).trim();
    if (!context || !value || !CSS.supports('color', value)) return fallback.clone();
    // Palette surfaces may be translucent (Glass). Let the browser composite
    // their CSS colors over the shell; Three.Color has no alpha channel.
    context.fillStyle = fallback.getStyle();
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = style.getPropertyValue('--vgai-surface-shell').trim();
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return new THREE.Color().setRGB(r! / 255, g! / 255, b! / 255, THREE.SRGBColorSpace);
  };
  const panel = read('--vgai-surface-panel', GRADIENT_BOTTOM);
  const raised = read('--vgai-surface-raised', GRADIENT_TOP);
  // A background texture is not tone-mapped, so what is authored here is
  // what the screen shows. The small lift keeps the ground a step above the
  // panel it sits beside (Blender's viewport is lighter than its editors).
  // Measured on screen under the Blender palette: ground #40, top #50, beside
  // Blender's own #3f–#4e.
  const bottom = panel.lerp(GRADIENT_BOTTOM, 0.25).lerp(new THREE.Color(0xffffff), 0.03);
  const top = raised.lerp(GRADIENT_TOP, 0.25).lerp(new THREE.Color(0xffffff), 0.04);
  return { bottom, top };
}

/**
 * Fires when the palette the backdrop follows changes. The theme installer
 * stamps its root with `data-vgai-palette` / `data-vgai-material` on every
 * switch, so the DOM is the contract here — a document stage never imports
 * the shell's preference store (its closure is pinned,
 * `scripts/validate-editor-closure.mjs`). Returns the unsubscribe.
 */
export function watchPaletteBackdrop(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const root = document.querySelector('[data-vgai-palette]');
  if (!root) return () => {};
  const observer = new MutationObserver(() => {
    onChange();
    invalidateStages();
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-vgai-palette', 'data-vgai-material'],
  });
  return () => observer.disconnect();
}

/** One 1×N vertical-gradient strip; the renderer stretches it full-frame. */
export function createGradientBackgroundTexture(
  stops: BackdropStops = paletteBackdropStops(),
): THREE.DataTexture {
  const height = 128;
  const data = new Uint8Array(height * 4);
  const color = new THREE.Color();
  for (let row = 0; row < height; row++) {
    // Row 0 is the BOTTOM of the texture, so the gradient runs ground → sky.
    // `Color` holds LINEAR components under colour management while the
    // texture below is declared sRGB, so the bytes are encoded on the way
    // out — written raw, every stop rendered several steps darker than
    // authored (measured: the stage read #050506 for a #1e2530 stop).
    color
      .copy(stops.bottom)
      .lerp(stops.top, row / (height - 1))
      .convertLinearToSRGB();
    data[row * 4] = Math.round(color.r * 255);
    data[row * 4 + 1] = Math.round(color.g * 255);
    data[row * 4 + 2] = Math.round(color.b * 255);
    data[row * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 1, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Grid frame for this scene's content: the Scene viewport's 50 m floor grown
 * in 10 m steps so a large layout (the 3D board's districts) never hangs past
 * its own ground reference — and CENTRED on the content's ground footprint, so
 * an off-origin layout (the board grows into one quadrant) still sits inside
 * the grid's crisp middle rather than out on its fading rim.
 */
function gridFrameForScene(scene: THREE.Object3D): { size: number; centre: [number, number] } {
  const bounds = contentWorldBounds(scene);
  if (bounds.isEmpty()) return { size: 50, centre: [0, 0] };
  const extent = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
  return {
    size: Math.min(Math.max(Math.ceil(extent / 10) * 10 + 20, 50), 1000),
    centre: [(bounds.min.x + bounds.max.x) / 2, (bounds.min.z + bounds.max.z) / 2],
  };
}

/** The Scene grid's 1 m cells, coarsening in 1/2/5/10 m steps once the extent
 *  would put more than ~60 lines on screen — denser reads as moiré noise, not
 *  as a ground reference. */
function gridDivisions(size: number): number {
  for (const cell of [1, 2, 5, 10]) {
    if (size / cell <= 60) return Math.round(size / cell);
  }
  return Math.round(size / 10);
}

/**
 * Fade the grid out with DISTANCE, in the grid's own shader.
 *
 * A finite grid drawn hard to its edge degenerates at grazing angles: the far
 * lines compress toward the horizon into harsh convergence/moiré artifacts,
 * and the grid ends on an abrupt square rim. Multiplying the fragment alpha by
 * a smoothstep over the fragment's radial distance from the grid's centre
 * dissolves both — near cells stay a crisp ground reference, the outer band
 * (which is exactly what sits at the horizon in a low shot) melts into the
 * backdrop before it can alias. The fade is anchored to the grid's OWN extent
 * rather than to the camera, so no zoom level ever dissolves the whole
 * reference; the band scales with `gridFrameForScene`, which already tracks
 * the content. Injection at `color_fragment` is where `LineBasicMaterial` has
 * `diffuseColor` in scope.
 *
 * Exported because the dressing OWNS the grid treatment: `editor-viewport.ts`
 * applies the same fade to its own editing grid, so no viewport anywhere ends
 * a grid on a hard aliasing rim.
 */
export function applyGridDistanceFade(material: THREE.Material, gridSize: number): void {
  // The band ends at the grid's own extent: it exists so the floor never ends
  // on a hard rim, not to shrink the floor. The old 0.18/0.42 band was tuned
  // for a camera standing close — a document that opens further back (the
  // Model document's `openingFit`) photographed a floor with NO visible grid
  // at all, measured against Blender's uniform lattice.
  //
  // `gridSize` is `GridHelper`'s size, which is the grid's DIAMETER — it spans
  // ±size/2 — while the shader below compares against a RADIUS
  // (`length(vGridPlanePosition)`). Comparing the two directly put the whole
  // band outside the geometry: on a 400 m grid the fade started at 220 m when
  // the farthest point along either axis is 200 m, so alpha never left 1.0 and
  // the floor ended on exactly the hard rim this function exists to prevent
  // (measured against Blender: our horizon stepped from #3f3f3f to #4f4f4f in
  // four scanlines across the full stage width, Blender's held #3f3f3f-#41
  // throughout). The band is a fraction of the RADIUS, so it reaches zero at
  // the grid's edge, where the fade belongs.
  const gridRadius = gridSize / 2;
  const fadeStart = gridRadius * 0.55;
  const fadeEnd = gridRadius;
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uGridFadeStart'] = { value: fadeStart };
    shader.uniforms['uGridFadeEnd'] = { value: fadeEnd };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGridPlanePosition;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGridPlanePosition = position.xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vGridPlanePosition;\nuniform float uGridFadeStart;\nuniform float uGridFadeEnd;',
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(uGridFadeStart, uGridFadeEnd, length(vGridPlanePosition));',
      );
  };
  // Distinct fade bands must not share one cached program.
  material.customProgramCacheKey = () => `vgai-grid-fade:${fadeStart}:${fadeEnd}`;
}

export interface StandardViewportDressingOptions {
  /**
   * The baked IBL from `@volter/editor-threejs/viewport/environment`; `null` opts the
   * scene out of an environment entirely. Ownership transfers here.
   */
  readonly environment: StandardEnvironment | null;
  /** Apply the vertical-gradient backdrop. Default `true`; a host whose
   *  backdrop lives elsewhere (the Asset Lab's alpha-canvas studio stage, an
   *  explicit SDK-contributed background) opts out. */
  readonly background?: boolean;
  /** Add the warm directional key light. Default `true`; a source that
   *  authors its own lights opts out — authored lighting always wins. */
  readonly keyLight?: boolean;
  /** Add the ground grid (content standing on y=0 by design). Default `false`. */
  readonly grid?: boolean;
  readonly content?: THREE.Object3D;
}

export interface StandardViewportDressing {
  /** The gradient applied to `scene.background`, or `null` when opted out —
   *  hosts hand it on (e.g. as a document session's neutral background). */
  readonly backgroundTexture: THREE.Texture | null;
  /** The dressing's lights, for hosts whose lighting presets retune them. */
  readonly lights: readonly THREE.Light[];
  frameContent(content: THREE.Object3D): void;
  /** The ONE teardown path for everything this dressing created. Idempotent. */
  dispose(): void;
}

/** Apply the standard dressing to one document viewport scene. */
export function applyStandardViewportDressing(
  scene: THREE.Scene,
  options: StandardViewportDressingOptions,
): StandardViewportDressing {
  const { environment, background = true, keyLight = true, grid = false } = options;
  const chrome: THREE.Object3D[] = [];
  const lights: THREE.Light[] = [];
  let backgroundTexture: THREE.DataTexture | null = null;

  if (environment) scene.environment = environment.texture;

  if (background) {
    backgroundTexture = createGradientBackgroundTexture();
    scene.background = backgroundTexture;
  }

  if (keyLight) {
    // The kit's own key, warm, as the kit studio preset states it (`KIT_STUDIO_PRESET`). A
    // document stage is lit by its view's presentation instead (`StagePresentationRig`, and
    // `StageHost` turns this key off); a stage without a presentation still gets this one.
    const key = new THREE.DirectionalLight(0xfff3dd, 1.9);
    key.name = 'vgai:standard-dressing-key';
    key.position.set(6, 10, -4);
    key.castShadow = true;
    // `userData.editorHelper` keeps it out of hierarchy walks and picks;
    // layers stay default so it lights layer-0 content under any camera.
    setUserData(key, 'editorHelper', true);
    scene.add(key);
    chrome.push(key);
    lights.push(key);
  }

  let gridHelper: THREE.GridHelper | null = null;
  let gridFrame = '';
  const frameContent = (content: THREE.Object3D) => {
    if (!grid) return;
    const { size, centre } = gridFrameForScene(content);
    const frame = `${size}:${centre.join(':')}`;
    if (frame === gridFrame) return;
    gridFrame = frame;
    if (gridHelper) {
      gridHelper.removeFromParent();
      gridHelper.dispose();
      chrome.splice(chrome.indexOf(gridHelper), 1);
    }
    // The Scene viewport's grid color (`editor-viewport.ts`), softened with
    // transparency so it reads as a ground reference under the gradient
    // rather than competing with the content.
    const helper = new THREE.GridHelper(size, gridDivisions(size), 0x999999, 0x999999);
    gridHelper = helper;
    const gridMaterial = helper.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.35;
    gridMaterial.depthWrite = false;
    applyGridDistanceFade(gridMaterial, size);
    helper.name = 'vgai:standard-dressing-grid';
    // Just below the ground line so content standing exactly on y=0 never
    // z-fights the grid lines; centred on the content's own footprint.
    helper.position.set(centre[0], -0.02, centre[1]);
    helper.layers.set(EDITOR_LAYER);
    setUserData(helper, 'editorHelper', true);
    scene.add(helper);
    chrome.push(helper);
  };
  frameContent(options.content ?? scene);

  let disposed = false;
  return {
    backgroundTexture,
    lights,
    frameContent,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const object of chrome) {
        object.removeFromParent();
        // GridHelper frees its geometry+material; Light frees its shadow map.
        (object as { dispose?: () => void }).dispose?.();
      }
      if (environment) {
        if (scene.environment === environment.texture) scene.environment = null;
        environment.dispose();
      }
      if (backgroundTexture) {
        if (scene.background === backgroundTexture) scene.background = null;
        backgroundTexture.dispose();
      }
    },
  };
}

/**
 * THE STAGE'S LIGHTING, FROM ITS PRESENTATION — the Three half of
 * `@volter/editor-sdk/kit/viewport-presentation`. A 3D document stage owns one rig; it draws
 * the view's `studio` lighting (a preset's lights, world-fixed or camera-locked, and its
 * ambient), sets the renderer's tone mapper and exposure, and answers the image-based light's
 * strength. It replaces the lights that were fixed in code: the dressing's key and the
 * viewport's own ambient and directional (`docs/VIEWPORT-STAGE.md` §The ruling). It moves to
 * `@volter/editor-threejs` with the rest of the assembled viewport (ARCHITECTURE.md, the plan,
 * unit 3).
 *
 * A `studio` draw lights by its preset alone: the stage darkens the content's own lights for
 * that draw and restores them after it (`Object3DDocumentHost.darkenContentLights`). The
 * `document` preset is the document's own view-locked studio (Blender's Solid lights), which the
 * document manages together with its scene's lights.
 *
 * Not yet: the `preview` source (a sun and a sky) draws nothing, and a Blender document's
 * `scene` source draws unlit, because Blender's render lighting lives in the Blender engine
 * (`BlenderRuntimeView.setRendered`) rather than as lights in the document's content.
 */
const LIGHT_DISTANCE = 12;

/**
 * GODOT'S FILMIC CURVE as three's one custom tone mapper: John Hable's curve with Godot's
 * exposure bias of 2, divided by the curve at the white point so white stays white
 * (`servers/rendering/renderer_rd/shaders/effects/tonemap.glsl`, `tonemap_filmic`, at
 * Godot's default `tonemap_white` of 1.0). three's own curves map white to about 0.8, which
 * drew Godot's sun grey. Installed once, into three's `CustomToneMapping` slot, which nothing
 * else on the page fills.
 */
const GODOT_FILMIC = /* glsl */ `
vec3 vgaiHable( vec3 x ) {
	const float A = 0.22 * 4.0;
	const float B = 0.30 * 2.0;
	const float C = 0.10;
	const float D = 0.20;
	const float E = 0.01;
	const float F = 0.30;
	return ( ( x * ( A * x + C * B ) + D * E ) / ( x * ( A * x + B ) + D * F ) ) - E / F;
}
vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return clamp( vgaiHable( max( vec3( 0.0 ), color ) ) / vgaiHable( vec3( 1.0 ) ), 0.0, 1.0 );
}`;
{
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const stock = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (chunk.includes(stock)) THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stock, GODOT_FILMIC);
}

const TONE_MAPPERS: Record<ViewportPresentation['lighting']['tone']['mapper'], THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  filmic: THREE.CustomToneMapping,
};

export class StagePresentationRig {
  private readonly group = new THREE.Group();
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0);
  private lights: { readonly light: THREE.DirectionalLight; readonly spec: StudioLight }[] = [];
  private preset: StudioPreset | null = null;
  private presentation: ViewportPresentation | null = null;
  private source: 'studio' | 'preview' | 'scene' = 'studio';
  /** The `preview` source's sun (Godot's preview sun). */
  private readonly previewGroup = new THREE.Group();
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  /** The preview sky, built from its three colours: the background drawn behind the scene and
   *  the environment that lights it, rebuilt only when the colours change. */
  private sky: { key: string; background: THREE.Texture; environment: THREE.Texture } | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private readonly direction = new THREE.Vector3();
  /** The environment image being fetched (its sky key), so a second apply does not fetch it again. */
  private loadingImage: string | null = null;
  /** The environment's turn about the vertical axis, radians. */
  private rotation = 0;
  private disposed = false;

  /** `onReady`: an environment image arrived after the apply that asked for it; draw again. */
  constructor(scene: THREE.Scene, private readonly onReady?: () => void) {
    this.group.name = 'vgai:stage-presentation-rig';
    // Kept out of hierarchy walks and picks, like every editor helper.
    this.group.userData['editorHelper'] = true;
    this.group.add(this.ambient);
    scene.add(this.group);
    this.previewGroup.name = 'vgai:stage-preview-rig';
    this.previewGroup.userData['editorHelper'] = true;
    this.sun.name = 'vgai:preview-sun';
    this.sun.userData['editorHelper'] = true;
    this.previewGroup.add(this.sun, this.sun.target);
    this.previewGroup.visible = false;
    scene.add(this.previewGroup);
  }

  /** Apply a view's presentation. `toneMapping` is the document's own mapper when it states one
   *  (a document's dressing), which outranks the view's. */
  apply(
    presentation: ViewportPresentation,
    renderer: THREE.WebGLRenderer,
    documentToneMapping?: THREE.ToneMapping,
    options: { readonly tone?: boolean } = {},
  ): void {
    this.presentation = presentation;
    const { lighting } = presentation;
    const preset = studioPreset(lighting.studioPreset);
    if (preset !== this.preset) this.build(preset);
    this.source = lighting.source;
    this.group.visible = lighting.source === 'studio';
    // A stage whose render pipeline owns the tone (the game world's) passes `tone: false`.
    if (options.tone !== false) {
      renderer.toneMapping = documentToneMapping ?? TONE_MAPPERS[lighting.tone.mapper];
      renderer.toneMappingExposure = lighting.tone.exposure;
    }
    // The preview sun: Godot's, placed by altitude and azimuth (clockwise from north, -Z).
    const { sun, environment } = lighting.preview;
    const altitude = THREE.MathUtils.degToRad(sun.altitude);
    const azimuth = THREE.MathUtils.degToRad(sun.azimuth);
    this.sun.color.set(sun.color);
    // Godot's energy as three's intensity, unscaled: the unit mapping is measured against
    // Godot's own frames, not assumed.
    this.sun.intensity = sun.enabled ? sun.energy : 0;
    this.sun.position
      .set(Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude), -Math.cos(azimuth) * Math.cos(altitude))
      .multiplyScalar(LIGHT_DISTANCE);
    this.sun.castShadow = sun.enabled && sun.shadowDistance > 0;
    const reach = Math.min(Math.max(sun.shadowDistance, 1), 50) / 2;
    Object.assign(this.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    this.rotation = THREE.MathUtils.degToRad(environment.rotation);
    const wantsSky =
      environment.enabled && (lighting.source === 'preview' || presentation.backdrop.source === 'environment');
    if (!wantsSky) return;
    // An image the view names but no integration has registered (yet, or in this product) leaves
    // the procedural sky in place; the image is built when it registers (the stage re-applies).
    const image = environment.image === null ? null : environmentImage(environment.image);
    if (image) this.buildImage(image, renderer);
    else {
      this.loadingImage = null;
      this.buildSky(environment.sky, renderer, sun.enabled ? { direction: this.sun.position.clone().normalize(), color: sun.color, energy: sun.energy } : null);
    }
  }

  /**
   * AN ENVIRONMENT IMAGE as the preview's sky: the panorama drawn behind the scene and,
   * prefiltered, the light, exactly where the procedural strip would be. Read as half float for
   * the same reason as the strip (a bright sun past white; linear filtering on phones). The last
   * sky stays drawn while the image loads.
   */
  private buildImage(
    image: NonNullable<ReturnType<typeof environmentImage>>,
    renderer: THREE.WebGLRenderer,
  ): void {
    const key = `image|${image.id}|${image.url}`;
    if (this.sky?.key === key || this.loadingImage === key) return;
    this.loadingImage = key;
    loadEnvironmentImage(image.url, image.format)
      .then((texture) => {
        if (this.disposed || this.loadingImage !== key) {
          texture.dispose();
          return;
        }
        this.loadingImage = null;
        this.disposeSky();
        this.pmrem ??= new THREE.PMREMGenerator(renderer);
        this.sky = { key, background: texture, environment: this.pmrem.fromEquirectangular(texture).texture };
        this.onReady?.();
      })
      .catch((error: unknown) => {
        if (this.loadingImage === key) this.loadingImage = null;
        editorConsole.error(`Environment image "${image.id}" (${image.url}) did not load: ${String(error)}`, 'viewport');
      });
  }

  /**
   * THE PREVIEW SKY, Godot's `ProceduralSkyMaterial`: above the horizon the horizon colour runs
   * to the top colour on the sky's top curve (Godot's 0.15), below it to the ground colour on its
   * ground curve (Godot's 0.02), mixed in linear light (`scene/resources/3d/sky_material.cpp`). THE SUN in
   * it follows the same material: inside the light's disc the sky is the sun's colour at its
   * energy, and out to `sun_angle_max` (30°) it returns to the sky on a curve of `sun_curve`
   * (0.15). A light with no angular size draws a half-degree disc.
   *
   * Drawn into a HALF-FLOAT equirectangular strip, because the sun is brighter than white: an 8-bit
   * strip clipped it to 1.0, which the tone curve draws as grey 202 (measured) where Godot's
   * sun blows out. Half, not full, float: a full-float strip cannot be linearly filtered where
   * `OES_texture_float_linear` is missing (common on phones) and would draw black. The strip is
   * both the backdrop and, prefiltered, the light; 1024 across,
   * because the sun's bright core is about 3° wide and drew as two pixels at 256. Placed by
   * three's equirectangular mapping (`atan(z, x)`, `asin(y)`); row 0 is straight down.
   */
  private buildSky(
    colours: ViewportPresentation['lighting']['preview']['environment']['sky'],
    renderer: THREE.WebGLRenderer,
    sun: { readonly direction: THREE.Vector3; readonly color: string; readonly energy: number } | null,
  ): void {
    const sunKey = sun
      ? `${sun.direction.toArray().map((value) => value.toFixed(4)).join(',')}|${sun.color}|${sun.energy}`
      : 'none';
    const key = `${colours.top}|${colours.horizon}|${colours.ground}|${colours.topCurve}|${colours.groundCurve}|${sunKey}`;
    if (this.sky?.key === key) return;
    this.disposeSky();
    const width = 1024;
    const height = 512;
    const DISC = THREE.MathUtils.degToRad(0.5);
    const GLOW = THREE.MathUtils.degToRad(30);
    const SUN_CURVE = 0.15;
    const top = new THREE.Color(colours.top);
    const horizon = new THREE.Color(colours.horizon);
    const ground = new THREE.Color(colours.ground);
    const light = sun ? new THREE.Color(sun.color).multiplyScalar(sun.energy) : null;
    const data = new Uint16Array(width * height * 4);
    // Half-float's range: three warns on every value past it, which a bright sun reaches.
    const half = (value: number) => THREE.DataUtils.toHalfFloat(Math.min(value, 65504));
    // A curve of zero divides by zero at the horizon row.
    const topCurve = Math.max(colours.topCurve, 0.001);
    const groundCurve = Math.max(colours.groundCurve, 0.001);
    const band = new THREE.Color();
    const pixel = new THREE.Color();
    const direction = new THREE.Vector3();
    for (let row = 0; row < height; row++) {
      const elevation = ((row + 0.5) / height - 0.5) * Math.PI;
      const angle = Math.PI / 2 - elevation; // 0 = straight up, PI = straight down
      if (angle <= Math.PI / 2) {
        const c = 1 - angle / (Math.PI / 2);
        band.copy(horizon).lerp(top, THREE.MathUtils.clamp(1 - Math.pow(1 - c, 1 / topCurve), 0, 1));
      } else {
        const c = (angle - Math.PI / 2) / (Math.PI / 2);
        band.copy(horizon).lerp(ground, THREE.MathUtils.clamp(1 - Math.pow(1 - c, 1 / groundCurve), 0, 1));
      }
      for (let column = 0; column < width; column++) {
        pixel.copy(band);
        if (light && sun && elevation > -Math.PI / 2) {
          const longitude = ((column + 0.5) / width - 0.5) * Math.PI * 2;
          direction.set(
            Math.cos(longitude) * Math.cos(elevation),
            Math.sin(elevation),
            Math.sin(longitude) * Math.cos(elevation),
          );
          const toSun = direction.angleTo(sun.direction);
          if (toSun < DISC) pixel.copy(light);
          else if (toSun < GLOW) {
            const c = (toSun - DISC) / (GLOW - DISC);
            pixel.copy(light).lerp(band, THREE.MathUtils.clamp(1 - Math.pow(1 - c, 1 / SUN_CURVE), 0, 1));
          }
        }
        const at = (row * width + column) * 4;
        data[at] = half(pixel.r);
        data[at + 1] = half(pixel.g);
        data[at + 2] = half(pixel.b);
        data[at + 3] = half(1);
      }
    }
    const background = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    background.mapping = THREE.EquirectangularReflectionMapping;
    background.colorSpace = THREE.LinearSRGBColorSpace;
    background.magFilter = THREE.LinearFilter;
    background.minFilter = THREE.LinearFilter;
    background.needsUpdate = true;
    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    const environment = this.pmrem.fromEquirectangular(background).texture;
    this.sky = { key, background, environment };
  }

  private disposeSky(): void {
    this.sky?.background.dispose();
    this.sky?.environment.dispose();
    this.sky = null;
  }

  /** The environment this draw lights by: the studio's own at the preset's strength, the
   *  preview sky at its energy, or `null` when the scene's own decides. */
  environment(): { readonly texture: THREE.Texture | null; readonly intensity: number; readonly rotation: number } | null {
    const lighting = this.presentation?.lighting;
    if (!lighting) return null;
    if (this.source === 'studio') return { texture: null, intensity: this.preset?.environmentIntensity ?? 0, rotation: 0 };
    if (this.source === 'preview') {
      return lighting.preview.environment.enabled
        ? { texture: this.sky?.environment ?? null, intensity: lighting.preview.environment.energy, rotation: this.rotation }
        : { texture: null, intensity: 0, rotation: 0 };
    }
    return null;
  }

  /**
   * What this draw shows behind the scene, or `'keep'` for the stage's own backdrop (the look's
   * fill, and a scene's own background as the stage already mirrors it).
   */
  backdrop():
    | 'keep'
    | {
        readonly value: THREE.Color | THREE.Texture | null;
        readonly blur: number;
        readonly intensity: number;
        readonly rotation: number;
      } {
    const backdrop = this.presentation?.backdrop;
    if (!backdrop || backdrop.source === 'fill' || backdrop.source === 'scene') return 'keep';
    if (backdrop.source === 'transparent') return { value: null, blur: 0, intensity: 1, rotation: 0 };
    if (backdrop.source === 'color') return { value: new THREE.Color(backdrop.color), blur: 0, intensity: 1, rotation: 0 };
    // `environment`: the preview sky drawn behind the scene, at the view's opacity and blur.
    return this.sky
      ? { value: this.sky.background, blur: backdrop.blur, intensity: backdrop.opacity, rotation: this.rotation }
      : 'keep';
  }

  /**
   * Before every draw: the source this draw lights by, given what the scene holds. A view whose
   * lighting is `auto` gives way to the scene's own when the scene has any of its `takeover`
   * (the kit's rule, Godot's preview); without `auto` the view's source stands (Blender, Unity).
   */
  resolveSource(scene: Readonly<Partial<Record<SceneTakeover, boolean>>>): 'studio' | 'preview' | 'scene' {
    const lighting = this.presentation?.lighting;
    let source: 'studio' | 'preview' | 'scene' = lighting?.source ?? 'studio';
    if (lighting?.auto && source !== 'scene' && lighting.auto.takeover.some((part) => scene[part] === true)) {
      source = 'scene';
    }
    this.source = source;
    this.group.visible = source === 'studio';
    this.previewGroup.visible = source === 'preview';
    return source;
  }

  /** The rig's objects in its scene, for a stage that moves its editor objects between scenes. */
  roots(): readonly THREE.Object3D[] {
    return [this.group, this.previewGroup];
  }

  /** Whether the preset's own lights are showing. */
  lightsVisible(): boolean {
    return this.group.visible && this.lights.length > 0;
  }

  /** The studio preset the view names. */
  presetId(): string | null {
    return this.preset?.id ?? null;
  }


  /** Before every draw: point the camera-locked lights along the camera. */
  update(camera: THREE.Camera): void {
    if (!this.group.visible) return;
    for (const { light, spec } of this.lights) {
      this.direction.set(...spec.direction).normalize();
      if (spec.space === 'camera') this.direction.applyQuaternion(camera.quaternion);
      light.position.copy(this.direction).multiplyScalar(-LIGHT_DISTANCE);
      light.target.position.set(0, 0, 0);
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearLights();
    this.group.removeFromParent();
    this.previewGroup.removeFromParent();
    this.sun.dispose();
    this.disposeSky();
    this.pmrem?.dispose();
  }

  private build(preset: StudioPreset): void {
    this.clearLights();
    this.preset = preset;
    this.ambient.color.set(preset.ambient.color);
    this.ambient.intensity = preset.ambient.intensity;
    for (const spec of preset.lights) {
      const light = new THREE.DirectionalLight(spec.color, spec.intensity);
      light.name = `vgai:studio-light:${preset.id}`;
      light.castShadow = spec.castShadow === true;
      light.userData['editorHelper'] = true;
      this.group.add(light);
      this.group.add(light.target);
      this.lights.push({ light, spec });
    }
    // World lights never move again; camera lights move every draw.
    this.direction.set(0, 0, 0);
    for (const { light, spec } of this.lights) {
      if (spec.space !== 'world') continue;
      this.direction.set(...spec.direction).normalize();
      light.position.copy(this.direction).multiplyScalar(-LIGHT_DISTANCE);
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
    }
  }

  private clearLights(): void {
    for (const { light } of this.lights) {
      light.removeFromParent();
      light.target.removeFromParent();
      light.dispose();
    }
    this.lights = [];
  }
}
