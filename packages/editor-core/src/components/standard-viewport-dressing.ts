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

import { contentWorldBounds } from '@volter/editor-threejs/viewport/content-bounds';
import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import type { StandardEnvironment } from '@volter/editor-threejs/viewport/environment';
import { setUserData } from '@volter/editor-threejs/ecs/user-data';
import * as THREE from 'three';

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
  const observer = new MutationObserver(onChange);
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

/**
 * The room bake's strength on a document stage. NOT the asset-preview lane's
 * `STUDIO_ENVIRONMENT_INTENSITY` (0.45): that lane has no key light, this rig
 * does, and the two are fitted together — with the mesh package's
 * `STUDIO_GREY`, which is the other half of this number.
 *
 * THE FRAME AND THE COORDINATES, so every round compares. Reference:
 * Blender's object-mode cube, `modeling-object-none.png` at its native 2x —
 * front face 111, left 130, top 141, spread 30, read identically at 2x and
 * downscaled to our 1728-wide frame. Ours: a fresh `--template models`
 * scaffold, the Model document on its own default camera, `vgai screenshot
 * editor` at 1x (1728x941), 11x11 medians at (735,505) front, (665,500) left,
 * (710,440) top.
 *
 * THE ROUNDS (albedo, strength -> front/left/top):
 *   #545454, 1.00 -> 108/130/159   reproduces the earlier round exactly
 *   #545454, 0.60 ->  90/100/135
 *   #545454, 0.30 ->  73/ 69/111   what shipped before this — see below
 *   #4f4f4f, 1.04 -> 103/125/154   the min-max alternative; duller by eye
 *   #5a5a5a, 0.85 -> 110/128/159   LANDED
 *
 * WHY 0.30 WAS WRONG: at that strength the cube is not uniformly dark. The
 * left face collapses BELOW the front one (69 against 73), inverting
 * Blender's own order — the left face is almost pure IBL, the front face
 * mostly key — so the narrow spread it bought was the two side faces meeting
 * in the dark, not Blender's shape.
 *
 * WHY THE TOP FACE STAYS ~18 HOT, and why no value here fixes it. This
 * subject has exactly TWO lighting bases, the directional key and the room
 * bake, so face radiance is p*K + q*E; the albedo, the key's intensity and
 * this strength only move p and q (the albedo scales both, adding no third
 * degree of freedom). Split from the rounds above, in scene-linear through
 * ACES: K = 0.044 / 0.020 / 0.070 and E = 0.069 / 0.134 / 0.161
 * (front/left/top). The model predicted 89/100/136 at strength 0.6 against
 * 90/100/135 measured, so it holds — and it says Blender's three faces need a
 * NEGATIVE p or q. Solving front+left exactly leaves the top at 161; the best
 * min-max anywhere in the family is 101/123/151, ten off on all three and
 * still 50 of spread. The residual is the RoomEnvironment's
 * ceiling-to-floor gradient against Blender's camera-following studio light:
 * closing it needs a different environment or a key from the camera's side,
 * not a different number here. So this is fitted on the two faces that ARE
 * reachable, which carry 74% of the cube's pixels (front 54%, left 20%,
 * top 26%).
 *
 * The host applies this to the CONTENT scene it creates (`StageHost.tsx`),
 * the one place the per-draw mirror cannot overwrite it.
 */
export const STANDARD_ENVIRONMENT_INTENSITY = 0.85;

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
    // NEUTRAL, not warm. It was `0xfff3dd` — (255,243,221), a 15% warm bias —
    // and that is what made every document's subject read warm against the
    // reference: measured live on the Model document's cube, our three faces
    // came out (124,123,120), (145,145,145), (172,171,169) — R−B of +4/0/+3 —
    // where Blender's object-mode cube (`modeling-object-none.png` at 2x) is
    // (111,112,113), (129,131,131), (141,143,145), COOL by 2 to 4. White key,
    // and every face measures R−B of 0. The INTENSITY is unchanged: measured
    // across four rounds, halving and thirding it moved the faces 6–8 levels
    // and barely touched the spread between them, so it is not what this
    // difference was made of and every other document surface keeps its
    // definition.
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
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
