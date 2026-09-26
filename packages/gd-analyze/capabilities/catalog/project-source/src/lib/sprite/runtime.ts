/**
 * THE RUNTIME HALF — loading a baked atlas and playing a cycle on GAME TIME.
 *
 * This module imports `pixi.js` and `@pixi/react` and NOTHING from the bake
 * side of this capability. That separation is structural, not stylistic: the
 * bake modules pull in a native rasterizer, a polygon clipper and a rectangle
 * packer, none of which may ever reach a shipped game bundle. There is
 * deliberately no barrel re-exporting both halves — an `index.ts` here would
 * make one import of `useSpriteCycle` drag resvg into the browser.
 *
 * Extracted from `examples/top-down-survivor/src/lib/sprites.ts` and
 * `src/lib/sprite-cycle.ts`; the reasoning below is theirs, kept because each
 * line of it is a bug that already happened.
 */

import { useTick } from '@pixi/react';
import {
  type AnimatedSprite,
  Assets,
  BufferImageSource,
  type SCALE_MODE,
  type Spritesheet,
  Texture,
} from 'pixi.js';
import { type RefObject, useEffect, useRef, useState } from 'react';

export interface SpriteAtlas {
  /** Project-public URL of the spritesheet JSON. Pixi resolves the PNG beside it. */
  readonly url: string;
  /** Draw scale that takes a frame baked at `bakeScale` back to on-screen size. */
  readonly drawScale: number;
  /** Load the atlas, once per page. Repeat calls share the first promise. */
  load(): Promise<Spritesheet>;
  /** The loaded sheet, or null while it is still in flight. */
  loaded(): Spritesheet | null;
  /** Subscribe to the load. Returns the sheet synchronously once it is cached. */
  useSheet(): Spritesheet | null;
}

/**
 * One door onto one baked atlas.
 *
 * LOAD-ONCE, and why `useSheet` returns null rather than suspending. Textures
 * arrive a frame or two after the world mounts. Every consumer renders nothing
 * until they do, which is one branch and no Suspense boundary — and it means a
 * story, the editor's design-time board and the running match all reach the
 * same state by the same path.
 *
 * `bakeScale` is the whole reason a cell and a display size are different
 * numbers: art is rendered at a multiple of its on-screen size and drawn back
 * at `1 / bakeScale`, which is what keeps a 36px hero crisp on a 2× display and
 * legible when someone zooms the viewport in to look at it.
 */
export function createSpriteAtlas(options: {
  url: string;
  bakeScale?: number;
  /**
   * The atlas texture's filter. `'nearest'` is REQUIRED for pixel art and is
   * not a preference: the default is linear, which resamples a 12px invader
   * into a blur the moment the world draws it at anything but 1:1 — the pixel
   * look dies of filtering, silently, with the correct pixels in the file.
   */
  scaleMode?: SCALE_MODE;
}): SpriteAtlas {
  const bakeScale = options.bakeScale ?? 1;
  let loadedSheet: Spritesheet | null = null;
  let loading: Promise<Spritesheet> | null = null;

  const load = (): Promise<Spritesheet> => {
    loading ??= Assets.load<Spritesheet>(options.url).then((sheet) => {
      // Every frame of the sheet shares ONE source, so the filter is set once
      // here rather than per sprite — and setting it on the sheet is what
      // makes a story, the editor's preview and the running game agree.
      if (options.scaleMode) sheet.textureSource.scaleMode = options.scaleMode;
      loadedSheet = sheet;
      return sheet;
    });
    return loading;
  };

  return {
    url: options.url,
    drawScale: 1 / bakeScale,
    load,
    loaded: () => loadedSheet,
    useSheet(): Spritesheet | null {
      const [sheet, setSheet] = useState<Spritesheet | null>(loadedSheet);
      useEffect(() => {
        if (sheet) return;
        let alive = true;
        void load().then((ready) => {
          if (alive) setSheet(ready);
        });
        return () => {
          alive = false;
        };
      }, [sheet]);
      return sheet;
    },
  };
}

/**
 * One animation's frames, in cycle order.
 *
 * Throws naming the animation rather than handing back `undefined`: a missing
 * animation means the committed sheet and the project's frame catalogue have
 * drifted, and a silently empty `AnimatedSprite` is the hardest possible way to
 * notice that.
 */
export function animationTextures(sheet: Spritesheet, name: string): Texture[] {
  const textures = sheet.animations[name];
  if (!textures || textures.length === 0) {
    throw new Error(
      `sprite/runtime: the atlas has no animation named "${name}" — it carries ` +
        `[${Object.keys(sheet.animations).join(', ')}]. Re-run the project's sprite bake after ` +
        'changing the frame catalogue.',
    );
  }
  return textures;
}

export interface SpriteCycle {
  /** Attach to the `pixiAnimatedSprite`. */
  readonly ref: RefObject<AnimatedSprite | null>;
  /** The cycle's frames, or null while the atlas is still loading. */
  readonly textures: Texture[] | null;
  /** Pass straight to the sprite's `animationSpeed`. */
  readonly animationSpeed: number;
}

export interface SpriteCycleOptions {
  /** Playback rate in frames per SECOND (the hook converts to Pixi's units). */
  readonly framesPerSecond: number;
  /** Where in the cycle this instance starts, in [0, 1). */
  readonly phase?: number;
}

/**
 * Play one baked animation on GAME TIME, with a per-entity phase offset.
 *
 * Three lines that are all easy to get subtly wrong:
 *
 *  - **`autoUpdate: false`, advanced from `useTick`.** Pixi's own ticker is
 *    wall-clock; the host's is the GAME's, so an animation driven from here
 *    freezes when the match pauses and steps deterministically under
 *    `game.waitSimTime`. An `autoUpdate: true` sprite keeps walking on a paused
 *    level-up screen, which is the bug this exists to prevent.
 *  - **`play()` is required.** `AnimatedSprite.update` returns immediately
 *    unless the sprite is playing, so a manually-driven sprite that was never
 *    started is a still frame with no error anywhere.
 *  - **The phase offset is set once, on mount.** Ninety chasers sharing one
 *    six-frame cycle in lockstep read as a chorus line; offset by a hash of
 *    their id they read as a horde. The offset is fractional — Pixi's
 *    `currentFrame` setter takes a real number — so it desynchronises the swarm
 *    far more finely than six frames alone could.
 */
export function useSpriteCycle(
  atlas: SpriteAtlas,
  animation: string,
  { framesPerSecond, phase = 0 }: SpriteCycleOptions,
): SpriteCycle {
  const sheet = atlas.useSheet();
  const ref = useRef<AnimatedSprite | null>(null);
  const textures = sheet ? animationTextures(sheet, animation) : null;

  // Keyed on the TEXTURE ARRAY, not on its length: the spritesheet hands back
  // the same array for the same animation, so this re-seeds when the cycle
  // actually changes — including between two cycles that happen to have the
  // same number of frames.
  useEffect(() => {
    const sprite = ref.current;
    if (!sprite || !textures || textures.length === 0) return;
    // The setter's domain is [0, totalFrames − 1] INCLUSIVE — it throws on
    // anything past the last frame's index, even though `update` is happy to
    // run past it and wrap. So a phase maps across that span rather than across
    // the cycle's length; the difference is one inter-frame gap, and what this
    // number is for is spreading a horde out, not timing.
    sprite.currentFrame = phase * (textures.length - 1);
    sprite.play();
  }, [textures, phase]);

  useTick((ticker) => ref.current?.update(ticker));

  return { ref, textures, animationSpeed: framesPerSecond / 60 };
}

// ---------------------------------------------------------------------------
// Live grids — art the GAME edits while it plays
// ---------------------------------------------------------------------------

/**
 * A texture backed by a plain RGBA buffer, filtered NEAREST — the door for a
 * `PixelGrid` the game mutates at runtime.
 *
 * The baked atlas covers art that is finished before the match starts. The
 * other kind exists too, and it is a genre in itself: a shield bunker that
 * erodes where it was hit is a grid the SIM edits, cell by cell, and re-uploads.
 * `pixel-grid.ts` is pure arithmetic precisely so that path needs nothing else —
 * `gridRgba(grid, palette)` in, these two functions out, no renderer extract, no
 * canvas element, no second asset.
 *
 * The buffer is allocated ONCE and written in place, so an eroding bunker
 * allocates nothing per hit and the texture's identity never changes (a sprite
 * holding it keeps working).
 */
export function gridTexture(options: { width: number; height: number }): Texture {
  const source = new BufferImageSource({
    resource: new Uint8Array(options.width * options.height * 4),
    width: options.width,
    height: options.height,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    alphaMode: 'premultiply-alpha-on-upload',
  });
  return new Texture({ source });
}

/**
 * Copy fresh pixels into a {@link gridTexture} and re-upload it.
 *
 * Throws on a size mismatch rather than uploading a torn image: the caller's
 * grid and the texture it was made for must be the same shape, and a silently
 * skewed bunker is a bug that reads as an art problem.
 */
export function updateGridTexture(texture: Texture, pixels: Uint8Array): void {
  const source = texture.source as BufferImageSource;
  const buffer = source.resource as Uint8Array;
  if (buffer.length !== pixels.length) {
    throw new Error(
      `sprite/runtime: this texture holds ${buffer.length} bytes and was handed ${pixels.length} — ` +
        'the grid changed size, so make a new texture rather than uploading a torn one.',
    );
  }
  buffer.set(pixels);
  source.update();
}

/**
 * A stable phase in [0, 1) for an entity id — the horde's desynchroniser.
 *
 * An integer hash rather than the id modulo the frame count, because ids are
 * handed out in sequence and a modulo would march the swarm through the cycle
 * in spawn order, which is its own kind of lockstep.
 */
export function phaseFromId(id: number): number {
  let hash = Math.imul(id ^ 0x9e3779b9, 2246822519);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489917);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
