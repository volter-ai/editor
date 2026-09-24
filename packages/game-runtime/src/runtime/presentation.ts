/**
 * runtime/presentation.ts — how a game with a DECLARED resolution is presented in a host panel.
 *
 * `vgai.project.json`'s `resolution` is the game's own LOGICAL size: the coordinate space its
 * cameras frame, its DOM overlay lays out in, and its 2D worlds author positions against. A host
 * panel is whatever size the user dragged it to, and the two are not the same number.
 *
 * The rule, and it is the whole module:
 *
 *   **A declared resolution is rendered AT that resolution, and the RESULT is scaled uniformly to
 *   fit the panel, centered, letterboxed.**
 *
 * That is presentation scaling — an OS scaling a game window — and deliberately NOT a stretch mode.
 * Nothing here reflows the game, changes a camera's aspect, or re-anchors a HUD: the game renders
 * one shape and the host draws that shape smaller or larger. Every presented root of one project
 * (a three canvas, a pixi canvas, a dom overlay) therefore shares ONE scaled rect, which is what
 * keeps a HUD registered over the world beneath it.
 *
 * A project that declares no `resolution` is unchanged: the game fills the panel and its cameras
 * follow the panel's aspect ({@link PRESENTATION_FILL}).
 *
 * The math is here, alone and pure, because it had already been written twice inline (the Game
 * panel's device-preview branch and the story preview's artboard) and a third copy would have been
 * the one that drifted.
 */

/** A width/height pair in whatever unit the caller is working in. */
export interface PresentationSize {
  readonly width: number;
  readonly height: number;
}

/** Where a logical rect lands inside a container, scaled uniformly and centered. */
export interface PresentationRect {
  /** Uniform logical→container scale factor. Always finite and > 0. */
  readonly scale: number;
  /** The scaled rect's size in container units. */
  readonly width: number;
  readonly height: number;
  /** The letterbox margins — how far in from the container's top-left the scaled rect starts. */
  readonly offsetX: number;
  readonly offsetY: number;
}

function positiveOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Fit `logical` inside `container`, preserving aspect and centering the result.
 *
 * `allowUpscale` is the difference between the two callers this replaces and it is not cosmetic.
 * A DEVICE PREVIEW must never upscale — the point is to see the device's own pixels, so a phone
 * frame in a big panel stays phone-sized. A game's DECLARED resolution must upscale, or a 720x540
 * game sits as a postage stamp in the middle of a maximized panel and the feature reads as broken.
 *
 * A degenerate input (zero, negative, NaN — a panel mid-collapse, a manifest with a 0) yields
 * `scale: 1` and a zero-offset rect rather than an Infinity that would propagate into a CSS
 * transform.
 */
export function fitPresentation(
  container: PresentationSize,
  logical: PresentationSize,
  options: { readonly allowUpscale?: boolean } = {},
): PresentationRect {
  const cw = positiveOrZero(container.width);
  const ch = positiveOrZero(container.height);
  const lw = positiveOrZero(logical.width);
  const lh = positiveOrZero(logical.height);
  if (cw === 0 || ch === 0 || lw === 0 || lh === 0) {
    return { scale: 1, width: lw, height: lh, offsetX: 0, offsetY: 0 };
  }
  const raw = Math.min(cw / lw, ch / lh);
  const scale = options.allowUpscale === true ? raw : Math.min(raw, 1);
  const width = lw * scale;
  const height = lh * scale;
  return {
    scale,
    width,
    height,
    offsetX: (cw - width) / 2,
    offsetY: (ch - height) / 2,
  };
}

/** The game fills its panel: no declared resolution, no device preset, today's behaviour. */
export interface PresentationFill {
  readonly kind: 'fill';
}

/** The game renders at a fixed logical size and the host scales the result. */
export interface PresentationLogical {
  readonly kind: 'logical';
  readonly width: number;
  readonly height: number;
  /** `device` — a preview preset the user picked; `manifest` — the project's own `resolution`. */
  readonly source: 'device' | 'manifest';
  /** Device previews never upscale; a declared resolution does. See {@link fitPresentation}. */
  readonly allowUpscale: boolean;
}

export type PresentedSize = PresentationFill | PresentationLogical;

export const PRESENTATION_FILL: PresentationFill = { kind: 'fill' };

/**
 * Decide what size a game is presented at, from the two things that can ask for one.
 *
 * PRECEDENCE: an explicitly PICKED device resolution wins over the manifest's declared one. The
 * pick is a live act by whoever is looking at the panel ("show me this on a phone"), and a project
 * setting must not silently override it — otherwise every declared-resolution project would make
 * the device-preview picker do nothing.
 */
export function resolvePresentedSize(
  picked: { readonly width: number | null; readonly height: number | null },
  declared?: PresentationSize | undefined,
): PresentedSize {
  if (picked.width !== null && picked.height !== null) {
    return {
      kind: 'logical',
      width: picked.width,
      height: picked.height,
      source: 'device',
      allowUpscale: false,
    };
  }
  if (
    declared !== undefined &&
    positiveOrZero(declared.width) > 0 &&
    positiveOrZero(declared.height) > 0
  ) {
    return {
      kind: 'logical',
      width: declared.width,
      height: declared.height,
      source: 'manifest',
      allowUpscale: true,
    };
  }
  return PRESENTATION_FILL;
}
