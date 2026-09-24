/**
 * Restricting a scene for the duration of ONE environment capture, and asking
 * a renderer whether it can run one at all.
 *
 * A cube capture renders the live scene into an offscreen target, so whatever
 * it must exclude has to be turned off and turned back on around that single
 * render — never left flipped, and never flipped through a renderer-wide
 * switch (see {@link withCaptureShadows} for the measured reason). Both
 * helpers restore in a `finally`, so a capture that throws does not leave the
 * game altered.
 *
 * Consumers today: the `reflections` capability's native probe system, and
 * `godot-compat`'s versioned Godot `ReflectionProbe` binding.
 *
 * The Godot lane is ARCHIVED off main — `git fetch origin archive/godot-lane`, tag `archive/godot-lane-2026-09-19`.
 */
import type { Light, Object3D, Scene, WebGLRenderer } from 'three';

/**
 * Hide everything a capture's cull mask excludes, for exactly one capture.
 *
 * The object's side of the test is three's OWN `Object3D.layers.mask`, never a
 * parallel `userData` copy. An engine whose own per-object visibility layers
 * are a 32-bit mask (Godot's `VisualInstance.layers` is the worked case) writes
 * the authored mask straight onto the object and this reads it back. Both
 * default an unannotated object to `1`, which no default mask excludes, so an
 * ordinary scene is untouched.
 */
export function withCaptureMask(scene: Scene, mask: number, capture: () => void): void {
  const hidden: { object: Object3D; visible: boolean }[] = [];
  scene.traverse((object) => {
    if ((object.layers.mask & mask) !== 0) return;
    hidden.push({ object, visible: object.visible });
    object.visible = false;
  });
  try {
    capture();
  } finally {
    for (const entry of hidden) entry.object.visible = entry.visible;
  }
}

/**
 * Suppress every shadow-casting light for the duration of ONE capture — as
 * per-light `LightShadow.intensity`, never as `renderer.shadowMap.enabled`.
 *
 * **The distinction is not stylistic; the global flag silently deletes every
 * shadow in the game.** `renderer.shadowMap.enabled` is a program PARAMETER
 * (`WebGLPrograms.getParameters` → `shadowMapEnabled`), and
 * `WebGLRenderer.setProgram`'s `needsProgramChange` list does NOT watch it —
 * three requires a material version bump for a flip to reach a material that is
 * already compiled. So flipping it around the capture does nothing for compiled
 * materials and everything for the one material compiling INSIDE the window —
 * and a probe system installing a shader override sets `material.needsUpdate =
 * true` in the same `update()` call that runs the capture, so every patched
 * material links with `USE_SHADOWMAP` absent and keeps that program for the
 * rest of the run.
 *
 * Measured on the real Godot 3.6 binary against that lane's emitted port (a
 * white ground, a floating box, one straight-down `DirectionalLight`,
 * PanoramaSky ambient, Filmic white 6): with NO probe the port's shadow pixel
 * is `92,109,181` against Godot's `92,109,181`; adding ONE `ReflectionProbe`
 * moved the port's shadow pixel to `218,222,232` — byte-identical to its own
 * LIT ground, i.e. the shadow was gone — while Godot's moved to `109,146,201`.
 * Asking the capture not to touch shadows at all restored `108,146,200`, which
 * is what named the mechanism. The defect was Godot-shaped; the mechanism is a
 * three.js contract, which is why the fix lives here.
 *
 * `LightShadow.intensity` is a UNIFORM (`shadowmap_pars_fragment`:
 * `mix(1.0, shadow, shadowIntensity)`), refreshed from the light on every
 * `renderer.render()`, so zeroing it for the capture costs no recompile and
 * cannot outlive the `finally` that restores it.
 */
export function withCaptureShadows(scene: Scene, enabled: boolean, capture: () => void): void {
  if (enabled) {
    capture();
    return;
  }
  const restored: { shadow: { intensity: number }; intensity: number }[] = [];
  scene.traverse((object) => {
    const light = object as Light & { shadow?: { intensity: number } };
    if (!light.isLight || light.shadow === undefined) return;
    restored.push({ shadow: light.shadow, intensity: light.shadow.intensity });
    light.shadow.intensity = 0;
  });
  try {
    capture();
  } finally {
    for (const entry of restored) entry.shadow.intensity = entry.intensity;
  }
}

/**
 * Include or suppress the scene's global sky/environment for one cube capture.
 *
 * This is renderer plumbing rather than a Godot policy: the caller decides whether the capture is
 * interior. Clearing both properties is necessary because Three uses `background` for the cube's
 * visible pixels and `environment` for the materials being photographed. Restoring only one makes
 * a nominally isolated capture retain half of the outside lighting.
 */
export function withCaptureSceneEnvironment(
  scene: Scene,
  enabled: boolean,
  capture: () => void,
): void {
  if (enabled) {
    capture();
    return;
  }
  const background = scene.background;
  const environment = scene.environment;
  scene.background = null;
  scene.environment = null;
  try {
    capture();
  } finally {
    scene.background = background;
    scene.environment = environment;
  }
}

/**
 * Whether this renderer can run an environment capture at all.
 *
 * The editor's still design-time tree and headless runtimes deliberately supply
 * no GPU. They must keep the authored scene and gameplay; only the
 * renderer-owned capture is unavailable, so a probe system asks this and skips
 * the capture rather than refusing to mount.
 */
export function canCaptureEnvironment(renderer: WebGLRenderer): boolean {
  const candidate = renderer as WebGLRenderer & { compile?: unknown; coordinateSystem?: unknown };
  return typeof candidate.compile === 'function' && candidate.coordinateSystem !== undefined;
}
