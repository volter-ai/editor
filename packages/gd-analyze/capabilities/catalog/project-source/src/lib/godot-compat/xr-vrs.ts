/** Godot XRVRS foveation-mask generation as a native Three byte DataTexture. */
import {
  DataTexture,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
} from 'three';
import { registerGodotObjectIdentity } from './object';
import type { GodotRect2i } from './rect2';
import type { Vector2 } from './vector2';

export interface GodotXRVrsTexture extends DataTexture {
  readonly godotTargetSize: Vector2;
  readonly godotEyeFoci: readonly Vector2[];
  readonly godotRenderRegion: GodotRect2i;
}

function finite(value: number, owner: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${owner} requires a finite number.`);
  return value;
}

function size(value: Vector2, owner: string): Vector2 {
  if (typeof value !== 'object' || value === null ||
      !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError(`${owner} requires Vector2.`);
  }
  const width = Math.floor(value.x);
  const height = Math.floor(value.y);
  if (width < 1 || height < 1) throw new RangeError(`${owner} requires a positive target size.`);
  return { x: width, y: height };
}

function rect(value: GodotRect2i, owner: string): GodotRect2i {
  if (typeof value !== 'object' || value === null ||
      !Number.isFinite(value.position?.x) || !Number.isFinite(value.position?.y) ||
      !Number.isFinite(value.size?.x) || !Number.isFinite(value.size?.y)) {
    throw new TypeError(`${owner} requires Rect2i.`);
  }
  const position = { x: Math.floor(value.position.x), y: Math.floor(value.position.y) };
  const dimensions = { x: Math.floor(value.size.x), y: Math.floor(value.size.y) };
  return {
    position,
    size: dimensions,
    get end() { return { x: this.position.x + this.size.x, y: this.position.y + this.size.y }; },
    set end(end: Vector2) {
      this.size = { x: Math.floor(end.x - this.position.x), y: Math.floor(end.y - this.position.y) };
    },
  };
}

function defaultRegion(): GodotRect2i {
  return rect({ position: { x: 0, y: 0 }, size: { x: 0, y: 0 }, end: { x: 0, y: 0 } }, 'XRVRS');
}

export class GodotXRVRS {
  private minimumRadius = 20;
  private strength = 1;
  private renderRegion = defaultRegion();

  constructor() { registerGodotObjectIdentity(this, 'XRVRS'); }

  get_vrs_min_radius(): number { return this.minimumRadius; }
  set_vrs_min_radius(value: number): void {
    finite(value, 'XRVRS.vrs_min_radius');
    if (value < 0) throw new RangeError('XRVRS.vrs_min_radius must be non-negative.');
    this.minimumRadius = value;
  }
  get_vrs_strength(): number { return this.strength; }
  set_vrs_strength(value: number): void {
    finite(value, 'XRVRS.vrs_strength');
    if (value < 0) throw new RangeError('XRVRS.vrs_strength must be non-negative.');
    this.strength = value;
  }
  get_vrs_render_region(): GodotRect2i { return rect(this.renderRegion, 'XRVRS.vrs_render_region'); }
  set_vrs_render_region(value: GodotRect2i): void {
    const next = rect(value, 'XRVRS.vrs_render_region');
    if (next.size.x < 0 || next.size.y < 0) {
      throw new RangeError('XRVRS.vrs_render_region size must be non-negative.');
    }
    this.renderRegion = next;
  }

  make_vrs_texture(targetSize: Vector2, eyeFoci: Iterable<Vector2>): GodotXRVrsTexture {
    const target = size(targetSize, 'XRVRS.make_vrs_texture target_size');
    const foci = [...eyeFoci].map((focus) => ({
      x: finite(focus.x, 'XRVRS eye focus x'),
      y: finite(focus.y, 'XRVRS eye focus y'),
    }));
    const region = this.effectiveRegion(target);
    const tileSize = 16;
    const width = Math.max(1, Math.ceil(region.size.x / tileSize));
    const height = Math.max(1, Math.ceil(region.size.y / tileSize));
    const bytes = new Uint8Array(width * height);
    const fallbackFoci = foci.length === 0
      ? [{ x: target.x * 0.5, y: target.y * 0.5 }]
      : foci;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sampleX = region.position.x + (x + 0.5) * tileSize;
        const sampleY = region.position.y + (y + 0.5) * tileSize;
        let nearest = Number.POSITIVE_INFINITY;
        for (const focus of fallbackFoci) {
          nearest = Math.min(nearest, Math.hypot(sampleX - focus.x, sampleY - focus.y));
        }
        bytes[y * width + x] = this.rateForDistance(nearest);
      }
    }

    const texture = new DataTexture(bytes, width, height, RedFormat, UnsignedByteType) as GodotXRVrsTexture;
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    Object.defineProperties(texture, {
      godotTargetSize: { value: { ...target }, enumerable: true },
      godotEyeFoci: { value: fallbackFoci.map((focus) => ({ ...focus })), enumerable: true },
      godotRenderRegion: { value: rect(region, 'XRVRS texture region'), enumerable: true },
    });
    registerGodotObjectIdentity(texture, 'Texture2DRD');
    return texture;
  }

  get vrs_min_radius(): number { return this.get_vrs_min_radius(); }
  set vrs_min_radius(value: number) { this.set_vrs_min_radius(value); }
  get vrs_strength(): number { return this.get_vrs_strength(); }
  set vrs_strength(value: number) { this.set_vrs_strength(value); }
  get vrs_render_region(): GodotRect2i { return this.get_vrs_render_region(); }
  set vrs_render_region(value: GodotRect2i) { this.set_vrs_render_region(value); }

  private effectiveRegion(target: Vector2): GodotRect2i {
    const authored = this.renderRegion;
    if (authored.size.x === 0 || authored.size.y === 0) {
      return rect({
        position: { x: 0, y: 0 }, size: { ...target }, end: { ...target },
      }, 'XRVRS target region');
    }
    const x0 = Math.max(0, Math.min(target.x, authored.position.x));
    const y0 = Math.max(0, Math.min(target.y, authored.position.y));
    const x1 = Math.max(x0, Math.min(target.x, authored.position.x + authored.size.x));
    const y1 = Math.max(y0, Math.min(target.y, authored.position.y + authored.size.y));
    return rect({
      position: { x: x0, y: y0 }, size: { x: x1 - x0, y: y1 - y0 }, end: { x: x1, y: y1 },
    }, 'XRVRS clipped region');
  }

  private rateForDistance(distance: number): number {
    if (distance <= this.minimumRadius || this.strength === 0) return 0;
    const normalized = (distance - this.minimumRadius) / Math.max(1, this.minimumRadius);
    const rate = Math.floor(normalized * this.strength);
    return Math.max(0, Math.min(3, rate));
  }
}

export function createGodotXRVRS(): GodotXRVRS { return new GodotXRVRS(); }
