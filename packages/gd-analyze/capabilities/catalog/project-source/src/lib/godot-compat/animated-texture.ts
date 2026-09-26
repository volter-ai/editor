/** Godot 3/4 AnimatedTexture as one stable native Pixi Texture whose source advances in place. */
import { Rectangle, Texture, Ticker } from 'pixi.js';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { GodotConnection } from './signal';
import { bindGodotTexture2DCanvasApi } from './texture-2d';

export interface GodotAnimatedTexture extends Texture {
  frames: number; current_frame: number; pause: boolean; oneshot: boolean; fps: number;
  one_shot: boolean; speed_scale: number;
  set_frame_texture(frame: number, texture: Texture | null): void;
  get_frame_texture(frame: number): Texture | null;
  set_frame_delay(frame: number, delay: number): void;
  get_frame_delay(frame: number): number;
  set_frame_duration(frame: number, duration: number): void;
  get_frame_duration(frame: number): number;
  set_frames(frames: number): void;
  get_frames(): number;
  set_current_frame(frame: number): void;
  get_current_frame(): number;
  set_pause(paused: boolean): void;
  get_pause(): boolean;
  set_oneshot(enabled: boolean): void;
  get_oneshot(): boolean;
  set_one_shot(enabled: boolean): void;
  get_one_shot(): boolean;
  set_fps(value: number): void;
  get_fps(): number;
  set_speed_scale(value: number): void;
  get_speed_scale(): number;
}
interface Frame { texture: Texture | null; delay: number; changed: GodotConnection | null }
function frameIndex(value: unknown, count: number, member: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= count) throw new RangeError(`AnimatedTexture.${member} frame is outside 0..${count - 1}.`);
  return value as number;
}
export function createGodotAnimatedTexture(major: 3 | 4 = 3): GodotAnimatedTexture {
  const native = new Texture({ source: Texture.EMPTY.source, frame: new Rectangle(0, 0, 1, 1), dynamic: true }) as GodotAnimatedTexture;
  let frameCount = 1, current = 0, paused = false, oneShot = false, fps = major === 3 ? 4 : 1, elapsed = 0;
  let subscribed = false;
  // AnimatedTexture owns MAX_FRAMES slots regardless of the active `frames` count. Godot keeps
  // values written above that count when it shrinks and exposes them again when it grows.
  const values: Frame[] = Array.from(
    { length: 256 },
    () => ({ texture: null, delay: major === 3 ? 0 : 1, changed: null }),
  );
  const present = (): void => {
    const source = values[current]?.texture ?? Texture.EMPTY;
    native.source = source.source; native.frame.copyFrom(source.frame); native.orig.copyFrom(source.orig);
    native.trim.copyFrom(source.trim); native.update(); godotResourceEmitChanged(native);
  };
  const durationAt = (frame: number): number => major === 3
    ? (fps === 0 ? 0 : 1 / fps) + (values[frame]?.delay ?? 0)
    : (values[frame]?.delay ?? 1) * (fps === 0 ? 0 : Math.abs(1 / fps));
  const syncSubscription = (): void => {
    const active = !paused && frameCount > 1;
    if (active === subscribed) return;
    subscribed = active;
    if (active) Ticker.shared.add(tick);
    else Ticker.shared.remove(tick);
  };
  const tick = (ticker: Ticker): void => {
    elapsed += ticker.deltaMS / 1000;
    // This is AnimatedTexture::_update_proxy's bounded loop: intentionally no cycle modulo.
    // A large delta may leave time banked after MAX `frame_count` transitions for the next update.
    const direction = major === 4 ? (fps > 0 ? 1 : -1) : 1;
    let transitioned = false;
    for (let advanced = 0; advanced < frameCount; advanced += 1) {
      const frameLimit = durationAt(current);
      if (!(elapsed > frameLimit)) break;
      let next = current + direction;
      if (next < 0 || next >= frameCount) {
        next = oneShot ? (direction > 0 ? frameCount - 1 : 0) : (next + frameCount) % frameCount;
      }
      elapsed -= frameLimit;
      current = next;
      transitioned = true;
    }
    // Godot updates the proxy RID once after the bounded batch, not for each intermediate frame.
    if (transitioned) present();
  };
  const setFrameTexture = (frame: number, texture: Texture | null): void => {
    const index = frameIndex(frame, 256, 'set_frame_texture');
    if (texture !== null && !(texture instanceof Texture)) {
      throw new TypeError('AnimatedTexture frame texture must be a native Pixi Texture or null.');
    }
    const retained = values[index]!;
    if (retained.texture === texture) return;
    retained.changed?.disconnect();
    retained.texture = texture;
    retained.changed = texture === null ? null : godotResourceChangedSignal(texture).connect(() => {
      if (index === current) present();
      else godotResourceEmitChanged(native);
    });
    if (index === current) present();
    else godotResourceEmitChanged(native);
  };
  const setDelay = (frame: number, delay: number, member: string): void => {
    const index = frameIndex(frame, 256, member);
    if (!Number.isFinite(delay) || delay < 0) {
      throw new RangeError(`AnimatedTexture.${member} requires a finite non-negative duration.`);
    }
    if (values[index]!.delay === delay) return;
    values[index]!.delay = delay;
    elapsed = 0;
    godotResourceEmitChanged(native);
  };
  const destroy = native.destroy.bind(native);
  Object.defineProperties(native, {
    frames: { enumerable: true, get: () => frameCount, set: (value: number) => { if (!Number.isSafeInteger(value) || value < 1 || value > 256) throw new RangeError('AnimatedTexture.frames must be an integer from 1 through 256.'); if (value === frameCount) return; frameCount = value; current = Math.min(current, value - 1); elapsed = 0; present(); syncSubscription(); } },
    current_frame: { enumerable: true, get: () => current, set: (value: number) => { current = frameIndex(value, frameCount, 'current_frame'); elapsed = 0; present(); } },
    pause: { enumerable: true, get: () => paused, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('AnimatedTexture.pause must be bool.'); if (value === paused) return; paused = value; syncSubscription(); godotResourceEmitChanged(native); } },
    oneshot: { enumerable: true, get: () => oneShot, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('AnimatedTexture.oneshot must be bool.'); if (value === oneShot) return; oneShot = value; godotResourceEmitChanged(native); } },
    one_shot: { enumerable: true, get: () => oneShot, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('AnimatedTexture.one_shot must be bool.'); if (value === oneShot) return; oneShot = value; godotResourceEmitChanged(native); } },
    fps: { enumerable: true, get: () => fps, set: (value: number) => { if (!Number.isFinite(value) || value < 0 || value >= 1000) throw new RangeError('AnimatedTexture.fps must be finite in [0, 1000).'); if (value === fps) return; fps = value; elapsed = 0; godotResourceEmitChanged(native); } },
    speed_scale: { enumerable: true, get: () => fps, set: (value: number) => { if (!Number.isFinite(value) || value < -1000 || value >= 1000) throw new RangeError('AnimatedTexture.speed_scale must be finite in [-1000, 1000).'); if (value === fps) return; fps = value; elapsed = 0; godotResourceEmitChanged(native); } },
    set_frame_texture: { value: setFrameTexture },
    get_frame_texture: { value: (frame: number) => values[frameIndex(frame, 256, 'get_frame_texture')]!.texture },
    set_frame_delay: { value: (frame: number, delay: number) => setDelay(frame, delay, 'set_frame_delay') },
    get_frame_delay: { value: (frame: number) => values[frameIndex(frame, 256, 'get_frame_delay')]!.delay },
    set_frame_duration: { value: (frame: number, duration: number) => setDelay(frame, duration, 'set_frame_duration') },
    get_frame_duration: { value: (frame: number) => values[frameIndex(frame, 256, 'get_frame_duration')]!.delay },
    set_frames: { value: (value: number): void => { native.frames = value; } },
    get_frames: { value: (): number => native.frames },
    set_current_frame: { value: (value: number): void => { native.current_frame = value; } },
    get_current_frame: { value: (): number => native.current_frame },
    set_pause: { value: (value: boolean): void => { native.pause = value; } },
    get_pause: { value: (): boolean => native.pause },
    set_oneshot: { value: (value: boolean): void => { native.oneshot = value; } },
    get_oneshot: { value: (): boolean => native.oneshot },
    set_one_shot: { value: (value: boolean): void => { native.one_shot = value; } },
    get_one_shot: { value: (): boolean => native.one_shot },
    set_fps: { value: (value: number): void => { native.fps = value; } },
    get_fps: { value: (): number => native.fps },
    set_speed_scale: { value: (value: number): void => { native.speed_scale = value; } },
    get_speed_scale: { value: (): number => native.speed_scale },
    destroy: { value: (...args: Parameters<Texture['destroy']>) => { if (subscribed) { subscribed = false; Ticker.shared.remove(tick); } for (const frame of values) { frame.changed?.disconnect(); frame.changed = null; } destroy(...args); } },
  });
  registerGodotObjectIdentity(native, 'AnimatedTexture');
  present();
  return bindGodotTexture2DCanvasApi(bindGodotResourceProtocol(native, {
    createDuplicate(source) {
      const copy = createGodotAnimatedTexture(major);
      copy.frames = source.frames;
      copy.current_frame = source.current_frame;
      copy.pause = source.pause;
      copy.oneshot = source.oneshot;
      if (major === 3) copy.fps = source.fps;
      else copy.speed_scale = source.speed_scale;
      for (let index = 0; index < 256; index += 1) {
        copy.set_frame_texture(index, source.get_frame_texture(index));
        if (major === 3) copy.set_frame_delay(index, source.get_frame_delay(index));
        else copy.set_frame_duration(index, source.get_frame_duration(index));
      }
      return copy;
    },
    populateDuplicate(source, target, subresources, memo) {
      if (!subresources) return;
      for (let index = 0; index < 256; index += 1) {
        target.set_frame_texture(
          index,
          duplicateGodotSubresource(source.get_frame_texture(index), memo),
        );
      }
    },
  }));
}
