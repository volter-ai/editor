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
  EDITOR_SELECTION_LAYER,
  isInEditorOwnedSubtree,
} from '@volter/editor-threejs/viewport/editor-layers';
import type { OutlineEffect } from 'postprocessing';
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
  const effect = withoutSelectionLayerWarning(
    () =>
      new OutlineEffect(scene, camera, {
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
      }),
  );
  // OutlineEffect temporarily removes layer 0 from selected meshes, renders
  // scene depth, then renders only its selection layer for the mask. The
  // editor camera normally enables ALL layers so it can draw layer-31 gizmos;
  // without this exclusion the selected mesh remains in the depth pass via
  // the effect's own layer and both masks cancel to no visible edge.
  effect.selectionLayer = EDITOR_SELECTION_LAYER;
  camera.layers.disable(EDITOR_SELECTION_LAYER);
  outlineState.set(effect, { colors, roots: 0 });
  return effect;
}

/**
 * `OutlineEffect` constructs its `Selection` with a render layer taken from
 * a module-wide counter, which the editor then overrides
 * (`EDITOR_SELECTION_LAYER`, below). The counter still moves, and after 30
 * constructions in one page — every Object3D document session builds its
 * own effect — the library warns "Layer out of range, resetting to 2" and
 * carries on. For this editor that line is noise: the layer it worries
 * about is replaced before the effect ever renders. The console gate treats
 * every warning as unresolved work, so the one message is held back for
 * exactly the synchronous construction that provokes it; anything else the
 * constructor says still reaches the console.
 */
function withoutSelectionLayerWarning<T>(construct: () => T): T {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args[0] === 'Layer out of range, resetting to 2') return;
    warn.apply(console, args);
  };
  try {
    return construct();
  } finally {
    console.warn = warn;
  }
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
};

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
  const state = outlineState.get(effect);
  if (state && state.roots !== roots.length) {
    state.roots = roots.length;
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
