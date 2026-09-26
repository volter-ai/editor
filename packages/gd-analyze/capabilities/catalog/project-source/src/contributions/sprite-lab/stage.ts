/**
 * THE STAGE, IN PLAIN PIXI — one `Application`, one ground, one sprite, driven
 * by props. No React lives in this file, and that is the point.
 *
 * ## Why this is not `@pixi/react`
 *
 * Sprite Lab is a workspace DOCUMENT: it renders inside the EDITOR's own React
 * tree, not inside the game. On a packaged editor the editor's tree and the
 * project's module graph are two graphs with two Reacts (the shell ships its
 * own, prebuilt; the project's is served by its own Vite), and the editor
 * publishes ITS React to project contributions so their hooks match the tree
 * reconciling them. `@pixi/react` cannot ride that door: it is a bare
 * dependency, so it is prebundled against the PROJECT's React and its
 * `<Application>`/`useTick` hooks read a different dispatcher than the tree
 * they render in. Measured, on `node dist-server/packaged.mjs` against an
 * example that ships this kit: `[tools] src/tools/sprite-lab.document.tsx
 * crashed while rendering: Minified React error #321` (invalid hook call), and
 * the document never drew.
 *
 * Handing the document the editor's `@pixi/react` instead would only move the
 * split: it drags the EDITOR's `pixi.js` with it, while the frames' own
 * `Texture`s come from the project's `pixi.js` (`sprite-lab/subjects.ts`) —
 * one renderer looking at another renderer's textures.
 *
 * `pixi.js` calls no React hooks, so it crosses nothing: this module holds the
 * project's own Pixi objects, built from the project's own textures, and the
 * document drives it from an effect. That is the same shape the editor uses for
 * every Pixi surface it owns itself (`mount-isolated-pixi-screen.ts`,
 * `canvas-design-mount.ts`) — and the game-time lane is untouched, because
 * `lib/sprite/runtime.ts`'s `useSpriteCycle` still renders inside the GAME's
 * own React with the game's own `@pixi/react`.
 *
 * ## What this file owns, and what it does not
 *
 * It owns the Pixi objects and their arithmetic (the box, the ground, the
 * playhead push/pull). It owns no policy: the frame rate, the grounds' meaning
 * and the zoom choices are the document's, passed in as {@link SpriteStageView}
 * every commit.
 */

import { AnimatedSprite, Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';

/**
 * THE THREE GROUNDS, and why the default is the checker.
 *
 * `checker` is the alpha checkerboard every DCC shows behind a sprite, and it
 * is the only ground on which TRANSPARENCY reads as transparency rather than
 * as "the colour behind it". A stray semi-opaque halo, a fill that should have
 * been cut out, a shadow baked into the alpha — every one of them is obvious
 * here and invisible over a flat fill.
 *
 * `dark` and `light` are the pair the kit's own contact sheets use
 * (`lib/sprite/preview.ts`): art tuned only against the game's near-black
 * floor hides a missing outline, and art tuned only against white hides a
 * shadow the same value as the ground.
 */
export type StageGround = 'checker' | 'dark' | 'light';

/** The flat grounds' colours. The document paints the DOM half of the same
 *  ground behind its filmstrip thumbnails, so the values live here once. */
export const STAGE_GROUNDS: Record<Exclude<StageGround, 'checker'>, number> = {
  dark: 0x0b0e1a,
  light: 0xe9edf5,
};
export const CHECKER_DARK = 0x2a2e36;
export const CHECKER_LIGHT = 0x3b414b;

/**
 * The checker's square, in SCREEN pixels, and it is fixed on purpose: a
 * checker that scaled with the sprite would put giant squares behind an 8×
 * frame and read as the ART's own pixels. The ground belongs to the viewer,
 * never to the subject.
 */
export const CHECKER_SIZE = 8;

/**
 * THE STAGE BOX HUGS THE ART, and the ground is painted ONLY under the art.
 *
 * Both halves are one rule: a preview must not invent area the sprite does
 * not occupy. A fixed box painted edge to edge did invent it three ways —
 * a 96px cell sat in the middle of a 200px slab (most of the panel was
 * ground, and the eye read the slab as the asset's bounds), the ground's
 * flat fill made the sprite look like it had an opaque card behind it
 * rather than transparency, and at 4×/8× the art grew PAST the fixed box
 * and was silently CROPPED — a zoom that hides the thing you zoomed in on.
 *
 * So the box is `cell × scale`, floored at a size that keeps the two panels a
 * usable row when the art is glyph-sized. It is a pure function of the props
 * on purpose: the document reserves the same number for its wrapper, which is
 * what keeps a screenshot agreeing with the screen.
 */
export const MIN_STAGE_BOX = 96;

/** The art's own square, in screen pixels. */
export function stageArt(cell: number, scale: number): number {
  return Math.max(1, Math.round(cell * scale));
}

/** The box the stage reserves — see {@link MIN_STAGE_BOX}. */
export function stageBox(cell: number, scale: number): number {
  return Math.max(MIN_STAGE_BOX, stageArt(cell, scale));
}

/** Everything the stage draws, recomputed by the document every commit. */
export interface SpriteStageView {
  /** The animation's frames, in order. Identity matters: a new array is read
   *  as a new animation and rewinds the sprite. */
  readonly textures: readonly Texture[];
  /** The frame on screen. */
  readonly frameIndex: number;
  /** The frame ghosted under it, or `null` for no ghost. */
  readonly ghostIndex: number | null;
  /** Advance the playhead from this stage's ticker (driven stages only). */
  readonly playing: boolean;
  /** Whether THIS stage owns the playhead. A document shows the same animation
   *  on two stages; only one may advance it, or they fight over the frame. */
  readonly driven: boolean;
  readonly ground: StageGround;
  readonly scale: number;
  /** Square cell edge in BAKED pixels. */
  readonly cell: number;
  /** The viewer's playback rate — the document's policy, not the sheet's. */
  readonly framesPerSecond: number;
}

export interface SpriteStage {
  /** Apply a new view. Cheap enough to call on every React commit. */
  update(view: SpriteStageView): void;
  /** Draw now, rather than waiting for the next ticker frame. */
  render(): void;
  destroy(): void;
}

const GHOST_ALPHA = 0.35;

/**
 * Build the stage inside `host` and return the handle that drives it.
 *
 * ASYNC because `Application.init` is: the caller's effect must therefore
 * handle being torn down before this resolves (the returned stage is destroyed
 * immediately in that case), which is why `destroy()` is idempotent.
 *
 * `preserveDrawingBuffer` is what makes this stage PHOTOGRAPHABLE. The editor
 * screenshots a document by `drawImage`-ing every canvas it holds, and a WebGL
 * drawing buffer is discarded after compositing unless it is preserved — so
 * without it the capture is blank whenever it lands between renders,
 * intermittently, which reads as flakiness rather than as a setting. It is the
 * same reason the engine sets it on every stacked host canvas.
 */
export async function createSpriteStage(
  host: HTMLElement,
  initial: SpriteStageView,
  onFrame: (index: number) => void,
): Promise<SpriteStage> {
  const app = new Application();
  const box = stageBox(initial.cell, initial.scale);
  await app.init({
    backgroundAlpha: 0,
    height: box,
    preserveDrawingBuffer: true,
    width: box,
  });
  app.canvas.style.display = 'block';
  host.appendChild(app.canvas);

  const ground = new Graphics();
  ground.label = 'ground';
  const content = new Container();
  const ghost = new Sprite();
  ghost.label = 'onion';
  ghost.anchor.set(0.5);
  ghost.alpha = GHOST_ALPHA;
  // `autoUpdate: false` + `play()` + `update(ticker)` is the same three-line
  // discipline `useSpriteCycle` documents for game time: without `play()` the
  // sprite is a still frame with no error anywhere. A stage that does not own
  // the playhead simply never calls `update`.
  const sprite = new AnimatedSprite([...initial.textures], false);
  sprite.anchor.set(0.5);
  content.addChild(ghost, sprite);
  app.stage.addChild(ground, content);

  let view = initial;
  let drawnTextures: readonly Texture[] | null = null;
  let drawnGround: string | null = null;
  let destroyed = false;

  const applyTextures = () => {
    if (drawnTextures === view.textures) return;
    drawnTextures = view.textures;
    // Assigning `.textures` STOPS the sprite and rewinds it to frame 0, so
    // `play()` is required again after every swap — without it the animation
    // sits on its first frame forever while every other part of the UI looks
    // correct.
    sprite.textures = [...view.textures];
    sprite.play();
  };

  const drawGround = () => {
    const art = stageArt(view.cell, view.scale);
    const size = stageBox(view.cell, view.scale);
    const inset = Math.round((size - art) / 2);
    const key = `${view.ground}:${art}:${inset}`;
    if (drawnGround === key) return;
    drawnGround = key;
    ground.clear();
    if (view.ground !== 'checker') {
      ground.rect(inset, inset, art, art).fill({ color: STAGE_GROUNDS[view.ground] });
      return;
    }
    ground.rect(inset, inset, art, art).fill({ color: CHECKER_DARK });
    for (let y = 0; y < art; y += CHECKER_SIZE) {
      for (let x = 0; x < art; x += CHECKER_SIZE) {
        if ((x / CHECKER_SIZE + y / CHECKER_SIZE) % 2 === 0) {
          ground.rect(
            inset + x,
            inset + y,
            Math.min(CHECKER_SIZE, art - x),
            Math.min(CHECKER_SIZE, art - y),
          );
        }
      }
    }
    ground.fill({ color: CHECKER_LIGHT });
  };

  const layOut = () => {
    const size = stageBox(view.cell, view.scale);
    if (app.renderer.width !== size || app.renderer.height !== size)
      app.renderer.resize(size, size);
    // The ground is drawn INSIDE the stage and UNSCALED, which is what keeps
    // the checker's square a screen measurement. See CHECKER_SIZE.
    content.scale.set(view.scale);
    content.position.set(size / 2, size / 2);
  };

  const apply = () => {
    applyTextures();
    drawGround();
    layOut();
    sprite.animationSpeed = view.framesPerSecond / 60;
    const frames = view.textures.length;
    const index = frames > 0 ? Math.min(view.frameIndex, frames - 1) : 0;
    // An external seek (a filmstrip click, a step button) is pushed INTO the
    // sprite; the tick below pulls its own advance back out.
    if (frames > 0 && Math.floor(sprite.currentFrame) !== index) sprite.currentFrame = index;
    const ghostFrame = view.ghostIndex === null ? undefined : view.textures[view.ghostIndex];
    ghost.visible = ghostFrame !== undefined;
    if (ghostFrame) ghost.texture = ghostFrame;
  };

  app.ticker.add((ticker) => {
    if (destroyed) return;
    if (view.driven && view.playing && view.textures.length > 1) sprite.update(ticker);
    const current = Math.floor(sprite.currentFrame);
    if (view.driven && current !== view.frameIndex) onFrame(current);
  });

  apply();
  app.render();

  return {
    update(next) {
      if (destroyed) return;
      view = next;
      apply();
      // RENDER ON COMMIT, never only on the ticker. Pixi's ticker is rAF, and
      // rAF STOPS in a hidden tab — so a stage that only rendered from the
      // ticker is a blank rectangle for every agent capture taken while the
      // editor tab is backgrounded, and for the first frame after any remount.
      app.render();
    },
    render() {
      if (!destroyed) app.render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // The textures belong to the SUBJECT (an atlas the document may still be
      // showing on another stage), so only this stage's own objects go.
      app.destroy({ removeView: true }, { children: true, texture: false });
    },
  };
}
