/**
 * Native Three selection presentation for editor-owned authoring viewports.
 *
 * A transform box answers where an object's editable bounds are; it does not
 * answer which pixels belong to the selected object. Unity and Unreal draw
 * both for that reason. This module supplies the geometry-following half with
 * postprocessing's real OutlineEffect, while EditorViewport keeps native
 * helpers for cameras, lights, bones and other nodes that draw no geometry.
 *
 * The effect is presentation only. It never enters a project render pipeline,
 * changes source, or adds an authoring-data format.
 */

import {
  EDITOR_LAYER,
  EDITOR_SELECTION_LAYER,
  isInEditorOwnedSubtree,
} from '@volter/editor-threejs/viewport/editor-layers';
import type { EffectPass, OutlineEffect } from 'postprocessing';
import type * as THREE from 'three';

/**
 * The three postprocessing bindings {@link createThreeSelectionOutline} needs,
 * passed in rather than statically imported.
 *
 * `postprocessing` is ~200 kB of shaders and passes, and the surfaces this
 * module serves do not all want it: `editor-viewport.ts` imports only
 * {@link collectThreeSelectionOutlineTargets} (a pure traversal), and the
 * Asset Lab 3D document builds its composer on its FIRST frame, not at module
 * load. A static import here put the whole library in both closures
 * eagerly. A caller that already loaded postprocessing for its own composer
 * hands over its own bindings (`the world root's stage`); one that has not opens the
 * lazy door {@link loadThreeSelectionOutline}.
 */
export interface ThreeSelectionOutlineEffects {
  readonly OutlineEffect: typeof import('postprocessing').OutlineEffect;
  readonly BlendFunction: typeof import('postprocessing').BlendFunction;
  readonly KernelSize: typeof import('postprocessing').KernelSize;
}

/**
 * Build the editor's real postprocessing effect. A half-resolution medium
 * blur resolves to a stable 3–4 CSS-pixel silhouette on both 1x and HiDPI
 * displays instead of a driver-dependent hairline; pulse is deliberately
 * disabled because selection is state, not an alert.
 */
export function createThreeSelectionOutline(
  { BlendFunction, KernelSize, OutlineEffect }: ThreeSelectionOutlineEffects,
  scene: THREE.Scene,
  camera: THREE.Camera,
  colors: OutlineColors,
): OutlineEffect {
  const effect = new OutlineEffect(scene, camera, {
    // Alpha keeps the selection color legible over both black and white
    // materials. The effect's default screen blend washes out on pale assets.
    blendFunction: BlendFunction.ALPHA,
    visibleEdgeColor: colors.visible,
    hiddenEdgeColor: colors.hidden,
    edgeStrength: 5,
    pulseSpeed: 0,
    blur: true,
    kernelSize: KernelSize.MEDIUM,
    resolutionScale: 0.5,
    xRay: true,
  });
  // OutlineEffect temporarily removes layer 0 from selected meshes, renders
  // scene depth, then renders only its selection layer for the mask. The
  // editor camera normally enables ALL layers so it can draw layer-31 gizmos;
  // without this exclusion the selected mesh remains in the depth pass via
  // the effect's own layer and both masks cancel to no visible edge.
  effect.selectionLayer = EDITOR_SELECTION_LAYER;
  camera.layers.disable(EDITOR_SELECTION_LAYER);
  // A CRISP LINE NEEDS ITS COLOUR UNSCALED. postprocessing's composite multiplies the edge colour
  // by the edge value and uses that value again as alpha, so a partial edge darkens (Blender's
  // orange read brown) and a strength above one pushes the colour past itself (it read white).
  // Under `vgaiCrisp` the colour is divided back out of the edge value, leaving only the alpha
  // to follow the edge; the editor's own halo keeps the library's composite. And the library
  // draws an edge only OUTSIDE the silhouette (it scales the edge by the mask, which is zero on
  // the selection); Blender's detect marks the pixels on both sides of it, so a crisp line keeps
  // its inner half.
  const shader = effect.getFragmentShader();
  const stock = 'vec3 color=edge.x*visibleEdgeColor+edge.y*hiddenEdgeColor;';
  const outsideOnly = 'edge*=(edgeStrength*mask.x*pulse);';
  if (shader.includes(stock) && shader.includes(outsideOnly)) {
    (effect as unknown as { setFragmentShader(source: string): void }).setFragmentShader(
      shader
        .replace('uniform float edgeStrength;', 'uniform float edgeStrength;uniform float vgaiCrisp;')
        .replace(outsideOnly, 'edge*=(edgeStrength*(vgaiCrisp>0.5?1.0:mask.x)*pulse);')
        .replace(
          stock,
          `${stock}if(vgaiCrisp>0.5){float vgaiSum=edge.x+edge.y;if(vgaiSum>0.0)color/=vgaiSum;edge=min(edge,vec2(1.0));}`,
        ),
    );
    // Any `{ value }` is a uniform to three; no runtime three import in this module.
    effect.uniforms.set('vgaiCrisp', { value: 0 } as THREE.Uniform<number>);
  }
  // THE EDITOR'S OWN OVERLAYS DO NOT HIDE THE SELECTION. The effect measures what stands in
  // front of the selected object with a depth pass under an override material, which writes
  // depth for everything the camera sees — the floor grid included, though it writes none
  // itself — so the grid hid the outline's lower half wherever it crossed the object (measured
  // on Unity's look). Its layer is off the camera for the effect's update only; the effect
  // saves and restores the camera's mask around its own mask pass.
  const update = effect.update.bind(effect);
  effect.update = (renderer, inputBuffer, deltaTime) => {
    const current = (effect as unknown as { camera: THREE.Camera }).camera;
    const editorLayerOn = current.layers.isEnabled(EDITOR_LAYER);
    current.layers.disable(EDITOR_LAYER);
    try {
      update(renderer, inputBuffer, deltaTime);
    } finally {
      if (editorLayerOn) current.layers.enable(EDITOR_LAYER);
    }
  };
  outlineState.set(effect, { colors, roots: 0 });
  paintOutline(effect);
  return effect;
}

/**
 * ONE EFFECT PER RENDERER, REUSED. `OutlineEffect` constructs its `Selection`
 * with a render layer from a module-wide counter that warns "Layer out of
 * range, resetting to 2" on its 30th construction in a page; the editor
 * overrides that layer, but built one effect per document session and per
 * world pipeline rebuild, the warning sat on every session's console as
 * unresolved work. A released effect goes back to its renderer's pool — its
 * render targets belong to that renderer's context — and the next surface on
 * that renderer re-points it at its own scene and camera. Constructions are
 * bounded by the surfaces open at once.
 */
const pooled = new WeakMap<object, OutlineEffect[]>();

/** An outline for `renderer`: a released one re-pointed at `scene` and `camera`, or a new one. */
export function acquireThreeSelectionOutline(
  effects: ThreeSelectionOutlineEffects,
  renderer: object,
  scene: THREE.Scene,
  camera: THREE.Camera,
  colors: OutlineColors,
): OutlineEffect {
  const effect = pooled.get(renderer)?.pop();
  if (!effect) return createThreeSelectionOutline(effects, scene, camera, colors);
  effect.mainScene = scene;
  effect.mainCamera = camera;
  camera.layers.disable(EDITOR_SELECTION_LAYER);
  outlineState.set(effect, { colors, roots: 0 });
  paintOutline(effect);
  return effect;
}

/**
 * Give `effect` back to `renderer`'s pool, detached from `pass` so the pass's
 * disposal leaves it intact. Its selection is cleared first: a `Selection`
 * owns temporary render-layer bits on every object in it.
 */
export function releaseThreeSelectionOutline(
  renderer: object,
  effect: OutlineEffect,
  pass: EffectPass | null,
): void {
  effect.selection.clear();
  // `setEffects` is the pass's own (protected) way to let go of its effects.
  (pass as unknown as { setEffects(effects: never[]): void } | null)?.setEffects([]);
  const free = pooled.get(renderer) ?? [];
  if (!free.includes(effect)) free.push(effect);
  pooled.set(renderer, free);
}

/** THE LAZY DOOR: load `postprocessing` on demand and build the effect. For a
 *  caller with no composer of its own, so the library arrives with the
 *  silhouette rather than with the surface. Repeat calls are free — the module
 *  is cached after the first. */
export async function loadThreeSelectionOutline(
  scene: THREE.Scene,
  camera: THREE.Camera,
  colors: OutlineColors,
): Promise<OutlineEffect> {
  const { BlendFunction, KernelSize, OutlineEffect } = await import('postprocessing');
  return createThreeSelectionOutline(
    { BlendFunction, KernelSize, OutlineEffect },
    scene,
    camera,
    colors,
  );
}

type OutlineColors = {
  readonly visible: number;
  readonly hidden: number;
  readonly active?: { readonly visible: number; readonly hidden: number };
  readonly outline?: { readonly style: 'soft' | 'crisp'; readonly width: number | null; readonly hidden: boolean };
};

/**
 * BLENDER'S OUTLINE DETECT (`overlay_outline_detect_frag.glsl`), over our selection mask instead
 * of its object-id buffer: a pixel is outline when the mask changes along an axis within the
 * reach, looked for at one pixel and, with `do_thick_outlines`, two, on both sides of the
 * silhouette. Only the axes are looked along, which is why Blender's convex corner leaves its
 * one diagonal pixel dark. Blender's later line anti-aliasing is not transcribed: diagonal edges
 * step where its are smoothed. Visibility is the stock material's: the least visible of the
 * pixels looked at.
 */
const BLENDER_OUTLINE_DETECT = /* glsl */ `uniform lowp sampler2D inputBuffer;uniform vec2 texelSize;uniform float vgaiReach;
varying vec2 vUv0;varying vec2 vUv1;varying vec2 vUv2;varying vec2 vUv3;
void main(){
  vec2 uv=(vUv0+vUv1)*0.5;
  vec2 c=texture2D(inputBuffer,uv).rg;
  float edge=0.0;float visibility=1.0;
  for(int i=1;i<=2;i++){
    if(float(i)>vgaiReach||edge>0.0)break;
    vec2 o=texelSize*float(i);
    vec2 s0=texture2D(inputBuffer,uv+vec2(o.x,0.0)).rg;vec2 s1=texture2D(inputBuffer,uv-vec2(o.x,0.0)).rg;
    vec2 s2=texture2D(inputBuffer,uv+vec2(0.0,o.y)).rg;vec2 s3=texture2D(inputBuffer,uv-vec2(0.0,o.y)).rg;
    if(abs(s0.x-c.x)>0.5||abs(s1.x-c.x)>0.5||abs(s2.x-c.x)>0.5||abs(s3.x-c.x)>0.5)edge=1.0;
    visibility=min(min(s0.y,s1.y),min(s2.y,s3.y));
  }
  gl_FragColor.rg=(1.0-visibility>0.001)?vec2(edge,0.0):vec2(0.0,edge);
}`;

/** The detect material's own shader, kept to put back when a look turns the crisp form off. */
const stockDetect = new WeakMap<THREE.ShaderMaterial, string>();

/** Each effect's palette colours and how many roots it last outlined, so a selection change
 *  and a palette change each paint the right one. */
const outlineState = new WeakMap<OutlineEffect, { colors: OutlineColors; roots: number }>();

/**
 * THE ACTIVE OBJECT'S OUTLINE: a lone selected object is the active one, and a palette that
 * names an active colour draws it in that (Blender's light orange over its darker selection
 * orange, `modeling-object-selected.png`). Several selected objects draw in the selection
 * colour; which of them is active is not yet told apart.
 */
function paintOutline(effect: OutlineEffect): void {
  const state = outlineState.get(effect);
  if (!state) return;
  const colors = state.roots === 1 && state.colors.active ? state.colors.active : state.colors;
  effect.visibleEdgeColor.setHex(colors.visible);
  effect.hiddenEdgeColor.setHex(colors.hidden);
  // THE LOOK'S FORM. The editor's own is the soft halo `createThreeSelectionOutline` builds (a
  // half-resolution mask under a medium blur). A crisp line is Blender's: the mask at full
  // resolution, edge-detected by `BLENDER_OUTLINE_DETECT` and not blurred, so its band is hard
  // and its corners square.
  const form = state.colors.outline;
  const crisp = form?.style === 'crisp';
  const width = form?.width ?? 2;
  effect.resolution.scale = crisp ? 1 : 0.5;
  effect.blurPass.enabled = !crisp;
  effect.blurPass.kernelSize = 2;
  const detect = (effect as unknown as { outlinePass: { fullscreenMaterial: THREE.ShaderMaterial } }).outlinePass
    .fullscreenMaterial;
  const stock = stockDetect.get(detect) ?? detect.fragmentShader;
  stockDetect.set(detect, stock);
  const fragment = crisp ? BLENDER_OUTLINE_DETECT : stock;
  if (detect.fragmentShader !== fragment) {
    detect.fragmentShader = fragment;
    detect.needsUpdate = true;
  }
  // Half the width on each side of the silhouette's edge: Blender's 4 device px is its
  // `do_thick_outlines` reach of 2.
  detect.uniforms['vgaiReach'] = { value: Math.max(1, Math.round(width / 2)) } as THREE.IUniform<number>;
  effect.edgeStrength = crisp ? 8 : 5;
  const crispUniform = effect.uniforms.get('vgaiCrisp');
  if (crispUniform) crispUniform.value = crisp ? 1 : 0;
  effect.xRay = form?.hidden ?? true;
}

/** Apply supplied renderer-ready colors without rebuilding GPU pass resources. */
export function setThreeSelectionOutlineColors(effect: OutlineEffect, colors: OutlineColors): void {
  outlineState.set(effect, { colors, roots: outlineState.get(effect)?.roots ?? 0 });
  paintOutline(effect);
}

function isOutlineRenderable(object: THREE.Object3D): boolean {
  if ((object as THREE.Bone).isBone) return false;
  return (
    (object as THREE.Mesh).isMesh ||
    (object as THREE.Line).isLine ||
    (object as THREE.Points).isPoints ||
    (object as THREE.Sprite).isSprite
  );
}

/**
 * Expand selected semantic roots to the actual renderables postprocessing can
 * mask. Selection rows commonly name a Group/component root, while an outline
 * effect can only paint its Mesh/Line/Points/Sprite descendants.
 */
export function collectThreeSelectionOutlineTargets(
  selectedRoots: Iterable<THREE.Object3D>,
): THREE.Object3D[] {
  const targets: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();
  for (const root of selectedRoots) {
    // A bone has its own native joint highlight. Walking through it to a
    // skinned/accessory descendant would make selecting the joint look like
    // selecting the model instead.
    if ((root as THREE.Bone).isBone) continue;
    // Select what the component actually DRAWS, including implementation
    // children folded out of the hierarchy. Unlike an AABB measurement, the
    // mask pass cannot be poisoned by pooled/template geometry that is not
    // currently rendered; it only paints pixels the subtree draws now.
    root.traverse((object) => {
      if (seen.has(object) || isInEditorOwnedSubtree(object) || !isOutlineRenderable(object)) {
        return;
      }
      seen.add(object);
      targets.push(object);
    });
  }
  return targets;
}

/** Update only when the concrete renderable set changed, avoiding layer churn. */
export function syncThreeSelectionOutline(
  effect: OutlineEffect,
  selectedRoots: Iterable<THREE.Object3D>,
): void {
  const roots = [...selectedRoots];
  // A bone draws its own joint highlight and is never outlined, so it is not an object here.
  const objects = roots.filter((root) => !(root as THREE.Bone).isBone).length;
  const state = outlineState.get(effect);
  if (state && state.roots !== objects) {
    state.roots = objects;
    paintOutline(effect);
  }
  const targets = collectThreeSelectionOutlineTargets(roots);
  if (
    effect.selection.size === targets.length &&
    targets.every((target) => effect.selection.has(target))
  ) {
    return;
  }
  effect.selection.set(targets);
}
