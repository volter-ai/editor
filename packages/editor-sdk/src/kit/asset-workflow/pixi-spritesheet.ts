/**
 * Pixi's native spritesheet sidecar — TexturePacker hash/array JSON, the
 * same document AssetPack writes as `image.png.json`. The game loads THAT
 * file (`Assets.load('images/game-screen.png.json')`); the PNG is the atlas
 * page, not the authored unit.
 */

export interface PixiSpritesheetFrame {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotated: boolean;
  /** Untrimmed sprite canvas — Unity/Aseprite's document size. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Where the packed pixels sit inside that canvas. */
  readonly trimX: number;
  readonly trimY: number;
}

export interface PixiSpritesheet {
  readonly image: string;
  readonly frames: readonly PixiSpritesheetFrame[];
}

export function spritesheetResolutionRank(name: string): number {
  if (/@[0-9.]+x\./i.test(name)) return 1;
  if (/\.webp\.json$/i.test(name)) return 2;
  if (/\.png\.json$/i.test(name)) return 3;
  return 0;
}

export function spritesheetFamilyKey(path: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash < 0 ? '' : path.slice(0, slash);
  const file = slash < 0 ? path : path.slice(slash + 1);
  const stem = file
    .replace(/@[0-9.]+x/i, '')
    .replace(/\.(png|webp|jpe?g)\.json$/i, '')
    .replace(/\.json$/i, '');
  return dir ? `${dir}/${stem}` : stem;
}

export function parsePixiSpritesheet(source: string): PixiSpritesheet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as {
    frames?: unknown;
    meta?: { image?: unknown };
  };
  const image = typeof record.meta?.image === 'string' ? fileName(record.meta.image) : '';
  const frames = readFrames(record.frames);
  if (!image || frames.length === 0) return null;
  return { image, frames };
}

/** Content/open path: `assets/images/game-screen.png#satellite`. */
export function splitSpritesheetAssetPath(path: string): {
  readonly sheetPath: string;
  readonly frameName: string | null;
} {
  const trimmed = path.replace(/^\//, '');
  const hash = trimmed.lastIndexOf('#');
  if (hash < 0) return { sheetPath: trimmed, frameName: null };
  return { sheetPath: trimmed.slice(0, hash), frameName: trimmed.slice(hash + 1) || null };
}

/** Tab title: the frame name, never `game-screen.png#satellite`. */
export function spritesheetFrameTitle(path: string): string {
  const { sheetPath, frameName } = splitSpritesheetAssetPath(path);
  return frameName ?? sheetPath.split('/').pop() ?? path;
}

export function sidecarPathForSheet(sheetPath: string): string {
  return `${sheetPath.replace(/^\//, '')}.json`;
}

export function sheetVariantsFor(image: string): readonly string[] {
  const ext = image.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
  const stem = image.slice(0, image.length - ext.length);
  return [
    image,
    `${stem}.png`,
    `${stem}.webp`,
    `${stem}.jpg`,
    `${stem}@0.5x${ext}`,
    `${stem}@0.5x.png`,
    `${stem}@0.5x.webp`,
    `${stem}@2x${ext}`,
    `${stem}@2x.png`,
    `${stem}@2x.webp`,
  ];
}

function readFrames(frames: unknown): PixiSpritesheetFrame[] {
  if (!frames || typeof frames !== 'object') return [];
  if (Array.isArray(frames)) {
    return frames.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as FrameRecord;
      const name = typeof row.filename === 'string' ? row.filename : '';
      const parsed = readFrame(row);
      if (!name || !parsed) return [];
      return [{ name: stripFrameExt(name), ...parsed }];
    });
  }
  return Object.entries(frames as Record<string, unknown>).flatMap(([name, entry]) => {
    if (!entry || typeof entry !== 'object') return [];
    const parsed = readFrame(entry as FrameRecord);
    if (!parsed) return [];
    return [{ name: stripFrameExt(name), ...parsed }];
  });
}

interface FrameRecord {
  filename?: unknown;
  frame?: unknown;
  rotated?: unknown;
  sourceSize?: unknown;
  spriteSourceSize?: unknown;
}

function readFrame(row: FrameRecord): Omit<PixiSpritesheetFrame, 'name'> | null {
  const box = readBox(row.frame);
  if (!box) return null;
  const source = readSize(row.sourceSize) ?? { width: box.width, height: box.height };
  const trim = readPoint(row.spriteSourceSize);
  return {
    ...box,
    rotated: row.rotated === true,
    sourceWidth: source.width,
    sourceHeight: source.height,
    trimX: trim?.x ?? 0,
    trimY: trim?.y ?? 0,
  };
}

function readBox(frame: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!frame || typeof frame !== 'object') return null;
  const box = frame as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
  if (
    typeof box.x !== 'number' ||
    typeof box.y !== 'number' ||
    typeof box.w !== 'number' ||
    typeof box.h !== 'number'
  ) {
    return null;
  }
  return { x: box.x, y: box.y, width: box.w, height: box.h };
}

function readSize(value: unknown): { width: number; height: number } | null {
  if (!value || typeof value !== 'object') return null;
  const size = value as { w?: unknown; h?: unknown };
  if (typeof size.w !== 'number' || typeof size.h !== 'number') return null;
  return { width: size.w, height: size.h };
}

function readPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as { x?: unknown; y?: unknown };
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return null;
  return { x: point.x, y: point.y };
}

/**
 * Packed rect Pixi samples. A rotated TexturePacker frame stores the
 * unrotated size in `frame` and occupies the swapped rect on the page.
 */
export function packedFrameRect(
  frame: Pick<PixiSpritesheetFrame, 'x' | 'y' | 'width' | 'height' | 'rotated'>,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return frame.rotated
    ? { x: frame.x, y: frame.y, width: frame.height, height: frame.width }
    : { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}

function fileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

function stripFrameExt(name: string): string {
  return name.replace(/\.(png|webp|jpe?g)$/i, '');
}
