/** CanvasItem texture filtering projected onto per-drawable native Pixi sampler state. */
import { Container, Texture, TextureSource } from 'pixi.js';

const FILTERS = new WeakMap<Container, number>();
const REPEATS = new WeakMap<Container, number>();
const FILTERED_TEXTURES = new WeakMap<Container, {
  base: Texture;
  filtered: Texture;
  source: TextureSource;
}>();

function retainedFilter(node: Container): number {
  let current: Container | null = node;
  while (current !== null) {
    const filter = FILTERS.get(current) ?? 0;
    if (filter !== 0) return filter;
    current = current.parent;
  }
  return 2;
}

function retainedRepeat(node: Container): number {
  let current: Container | null = node;
  while (current !== null) {
    const repeat = REPEATS.get(current) ?? 0;
    if (repeat !== 0) return repeat;
    current = current.parent;
  }
  return 1;
}

function cloneSource(texture: Texture): TextureSource {
  const original = texture.source;
  if (original.resource === undefined || original.resource === null) {
    throw new Error(
      'CanvasItem.texture_filter cannot isolate a native sampler for a texture source without retained image data.',
    );
  }
  const Source = original.constructor as unknown as new (
    options: Readonly<Record<string, unknown>>,
  ) => TextureSource;
  try {
    return new Source({
      resource: original.resource,
      resolution: original._resolution,
      format: original.format,
      alphaMode: original.alphaMode,
      dimensions: original.dimension,
      viewDimension: original.viewDimension,
      arrayLayerCount: original.arrayLayerCount,
      antialias: original.antialias,
      addressModeU: original.style.addressModeU,
      addressModeV: original.style.addressModeV,
      addressModeW: original.style.addressModeW,
      autoGenerateMipmaps: original.autoGenerateMipmaps,
      label: `${original.label || 'Godot CanvasItem texture'} sampler`,
    });
  } catch (cause) {
    throw new Error(
      'CanvasItem.texture_filter could not create the per-CanvasItem native Pixi sampler required to avoid mutating a shared Texture resource.',
      { cause },
    );
  }
}

function cloneTexture(texture: Texture, source: TextureSource): Texture {
  return new Texture({
    source,
    frame: texture.frame,
    orig: texture.orig,
    ...(texture.trim === undefined || texture.trim === null ? {} : { trim: texture.trim }),
    ...(texture.defaultAnchor === undefined ? {} : { defaultAnchor: texture.defaultAnchor }),
    ...(texture.defaultBorders === undefined ? {} : { defaultBorders: texture.defaultBorders }),
    rotate: texture.rotate,
    dynamic: texture.dynamic,
    label: `${texture.source.label || 'Godot CanvasItem texture'} filtered`,
  });
}

function filteredTexture(node: Container, base: Texture): Readonly<{
  base: Texture;
  filtered: Texture;
  source: TextureSource;
}> {
  const existing = FILTERED_TEXTURES.get(node);
  if (existing?.base === base) return existing;
  if (existing !== undefined) {
    existing.filtered.destroy(false);
    existing.source.destroy();
  }
  const source = cloneSource(base);
  const retained = { base, filtered: cloneTexture(base, source), source };
  FILTERED_TEXTURES.set(node, retained);
  return retained;
}

function applyTexture(node: Container, filter: number): void {
  const current = Reflect.get(node, 'texture');
  if (!(current instanceof Texture)) return;
  if (node.children.some((child) => Reflect.get(child, 'texture') === current)) return;
  const previous = FILTERED_TEXTURES.get(node);
  const base = previous?.filtered === current ? previous.base : current;
  const retained = filteredTexture(node, base);
  const nearest = filter === 1 || filter === 3 || filter === 5;
  retained.source.autoGenerateMipmaps = filter >= 3;
  retained.source.style.maxAnisotropy = filter >= 5 ? 16 : 1;
  retained.source.style.magFilter = nearest ? 'nearest' : 'linear';
  retained.source.style.minFilter = nearest ? 'nearest' : 'linear';
  retained.source.style.mipmapFilter = nearest ? 'nearest' : 'linear';
  retained.source.style.lodMinClamp = 0;
  retained.source.style.lodMaxClamp = filter >= 3 ? 32 : 0;
  const repeat = retainedRepeat(node);
  const address = repeat === 2 ? 'repeat' : repeat === 3 ? 'mirror-repeat' : 'clamp-to-edge';
  retained.source.style.addressModeU = address;
  retained.source.style.addressModeV = address;
  retained.source.style.update();
  Reflect.set(node, 'texture', retained.filtered);
}

function refreshSubtree(node: Container): void {
  applyTexture(node, retainedFilter(node));
  for (const child of node.children) if (child instanceof Container) refreshSubtree(child);
}

export function setCanvasItemTextureFilter(node: Container, mode: number): void {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 6) {
    throw new RangeError('CanvasItem.texture_filter must be a TextureFilter value in [0, 6].');
  }
  FILTERS.set(node, mode);
  refreshSubtree(node);
}

export function getCanvasItemTextureFilter(node: Container): number {
  return FILTERS.get(node) ?? 0;
}

export function setCanvasItemTextureRepeat(node: Container, mode: number): void {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 3) throw new RangeError('CanvasItem.texture_repeat must be a TextureRepeat value in [0, 3].');
  REPEATS.set(node, mode);
  refreshSubtree(node);
}

export function getCanvasItemTextureRepeat(node: Container): number { return REPEATS.get(node) ?? 0; }

export function syncCanvasItemTextureRepeat(node: Container): void { applyTexture(node, retainedFilter(node)); }

/** Apply a retained/inherited filter after a CanvasItem receives a new native texture. */
export function syncCanvasItemTextureFilter(node: Container): void {
  applyTexture(node, retainedFilter(node));
}

/** Preserve the authored Texture Resource identity behind the native per-CanvasItem sampler clone. */
export function getCanvasItemSourceTexture(node: Container, nativeTexture: Texture): Texture {
  const retained = FILTERED_TEXTURES.get(node);
  return retained?.filtered === nativeTexture ? retained.base : nativeTexture;
}
