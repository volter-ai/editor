/**
 * `WorldRendererConfig` — what a WORLD may declare about the renderer that
 * draws it, and therefore part of the ROOT CONTRACT: `MountedThreeRoot
 * .rendererConfig` reports it (`./root-adapter.ts`) and
 * `./root-seam-contract.ts` lists it as a contract field.
 *
 * The contract owns the SHAPE and no three.js code: the function that applies
 * it to a live `WebGLRenderer` (and restores what it found on dispose) is the
 * three.js twin's, `@vgai/threejs-runtime/adapter/renderer-config`. The host
 * owns the `WebGLRenderer` (`ThreeHostContext.renderer`) and configures it
 * with this engine's defaults: ACES tone mapping, sRGB output, PCF-soft
 * shadows. Those defaults are right for a world authored against them and
 * WRONG for a world authored against a different engine's pipeline — an
 * imported Godot 3 GLES2 game does gamma-space lighting with no tonemapper at
 * all, so ACES quietly desaturates and darkens every colour its author picked.
 *
 * Three properties of the shape are load-bearing:
 *
 *  - **It is per-renderer, never engine-wide.** Every field is a
 *    `WebGLRenderer` instance property, and a play root gets its own renderer.
 *    Nothing here reaches a module-level three global, so one world's
 *    declaration cannot change how the editor's own viewport, another root, or
 *    a thumbnail bake renders.
 *  - **Absent means "leave the host's value alone".** Every field is optional
 *    and an omitted one is never written, so declaring a tone mapping does not
 *    silently reset the clear colour.
 *  - **It is restored on dispose.** The renderer outlives the mount, so a
 *    world that did not put back what it found would leak its pipeline into
 *    whatever mounts next.
 *
 * This is deliberately NOT a general render-settings system. It carries what a
 * world can honestly state about its own colour pipeline and nothing else; a
 * property the host fixes at CONSTRUCTION (the WebGL context's `antialias`
 * attribute, and therefore the MSAA sample count) cannot be declared here,
 * because there would be no honest moment to apply it.
 */

/** The tone-mapping operators three exposes, named as data rather than as three's numeric enum. */
export type WorldToneMapping =
  | 'none'
  | 'linear'
  | 'reinhard'
  | 'cineon'
  | 'aces'
  | 'agx'
  | 'neutral';

/**
 * The output transfer function the frame is written with.
 *
 *  - `srgb` — three's own default and this engine's: linear lighting, sRGB encode on output.
 *  - `srgb-linear` — NO output transform. This is what a gamma-space renderer needs: the shading
 *    result is already in display space and encoding it a second time washes the frame out.
 */
export type WorldOutputColorSpace = 'srgb' | 'srgb-linear';

/**
 * The shadow-map filter, named as data rather than as three's numeric enum.
 *
 * This is a renderer INSTANCE property (`WebGLRenderer.shadowMap.type`), not a context attribute,
 * so unlike MSAA it has an honest moment at which a world can ask for it — which is the whole test
 * this file's header states. A source engine that declares its own shadow filter (Godot 3's
 * `rendering/quality/shadows/filter_mode`) would otherwise inherit whatever the host built with.
 */
export type WorldShadowMapType = 'basic' | 'pcf' | 'pcf-soft' | 'vsm';

/** What a world may declare about the renderer that draws it. Every field is optional; see header. */
export interface WorldRendererConfig {
  readonly toneMapping?: WorldToneMapping | undefined;
  readonly toneMappingExposure?: number | undefined;
  readonly outputColorSpace?: WorldOutputColorSpace | undefined;
  /**
   * `WebGLRenderer.shadowMap.type`. Writing it after a shadow map has already been built needs
   * `shadowMap.needsUpdate`, which this function sets — three caches the compiled depth material
   * per type and would otherwise keep filtering with the previous one.
   */
  readonly shadowMapType?: WorldShadowMapType | undefined;
  /**
   * The colour the frame is cleared to, as a CSS hex string. The renderer's existing clear ALPHA
   * is preserved: a stacked canvas is transparent on purpose (`create-runtime.ts` gives every
   * non-bottom root `alpha: true`), and forcing it opaque here would hide every layer below.
   */
  readonly clearColor?: string | undefined;
}
