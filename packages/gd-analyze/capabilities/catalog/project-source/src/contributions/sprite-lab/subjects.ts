/**
 * WHAT SPRITE LAB IS LOOKING AT — the two subjects, loaded into one shape.
 *
 * The document's mental model is the material/shader split, and these are the
 * two halves of it:
 *
 *  - a SHEET is the material — declarative committed data (`public/sprites/
 *    *.json` plus its atlas PNG), loaded through the kit's own runtime loader,
 *    the exact bytes the game plays;
 *  - the RIG PROGRAM is the shader — `src/tools/sprite-bake/rigs.ts`, a program
 *    whose output is rendered LIVE here, and which you edit at its source. Its
 *    frames never touch disk: each one is `poseToSvg` handed to an `Image` and
 *    a canvas, which is the browser's own rasterizer standing in for the bake's
 *    resvg. (resvg is a native Node addon and must never be imported here —
 *    that split is why `runtime.ts` exists as a separate module from
 *    `atlas.ts`/`raster.ts`, and this module sits on the same side of it.)
 *
 * Both arrive as {@link LabAnimation}s carrying real Pixi `Texture`s plus the
 * image rect the filmstrip paints from, so everything downstream is blind to
 * which craft drew a frame — the same claim the atlas makes about the game.
 */

import { Texture } from 'pixi.js';
import { createSpriteAtlas, type SpriteAtlas } from '../../lib/sprite/runtime';
import { poseToSvg, type SpriteBakeSpec } from '../../lib/sprite/svg-rig';

/** One frame: the texture the stage draws, and the rect the filmstrip paints. */
export interface LabFrame {
  readonly texture: Texture;
  /** Image URL the thumbnail samples — an atlas PNG, or this frame's own data URL. */
  readonly imageUrl: string;
  /** Size of that image, for the thumbnail's `background-size`. */
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** This frame's rect inside it. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LabAnimation {
  readonly name: string;
  readonly frames: readonly LabFrame[];
  /** Square cell edge in BAKED pixels. */
  readonly cell: number;
  /**
   * Where the rig's (0, 0) sits in its cell. A sheet does not record it — the
   * spritesheet format has no pivot field — so a sheet subject says so rather
   * than guessing `center`.
   */
  readonly origin: 'center' | 'top-left' | null;
}

export interface LabSubject {
  readonly id: string;
  readonly label: string;
  readonly kind: 'program' | 'sheet';
  /** The one line under the picker: where these pixels come from. */
  readonly sourceLine: string;
  readonly animations: readonly LabAnimation[];
  /** Project-relative atlas PNG this subject bakes to / loads from. */
  readonly imagePath: string | null;
}

/** A subject before it is loaded — what the picker lists. */
export interface LabSubjectRef {
  readonly id: string;
  readonly label: string;
  readonly kind: 'program' | 'sheet';
  readonly sourceLine: string;
  /** Sheet subjects only: the URL the runtime loader is pointed at. */
  readonly url?: string;
  /** Sheet subjects only: project-relative path of the spritesheet JSON. */
  readonly path?: string;
}

/**
 * The project's own files, served VERBATIM.
 *
 * `/project-game-static/<project-relative path>` is the editor's untransformed
 * project-file route — the same one a mounted game reaches its own data
 * through. It matters that it is this and not `/sprites/…`: the editor page's
 * root-absolute requests are only redirected into the project by a fallback,
 * and a spritesheet JSON that got transformed into an ES module instead of
 * staying JSON is precisely the failure that route exists to prevent.
 */
function projectFileUrl(projectRelative: string): string {
  return `/project-game-static/${projectRelative}`;
}

// ---------------------------------------------------------------------------
// Sheets — the committed artifact
// ---------------------------------------------------------------------------

/** Where a project's baked sheets live, by the bake tool's own convention. */
const SHEET_DIRECTORY = 'public/sprites';

interface AssetEntry {
  name: string;
  type: 'file' | 'directory';
}

/** Every spritesheet JSON committed under `public/sprites/`. */
export async function discoverSheetRefs(): Promise<LabSubjectRef[]> {
  const response = await fetch('/__editor/assets?dir=sprites');
  if (!response.ok) return [];
  const body = (await response.json()) as { entries?: AssetEntry[] };
  return (body.entries ?? [])
    .filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
    .map((entry) => {
      const path = `${SHEET_DIRECTORY}/${entry.name}`;
      return {
        id: `sheet:${path}`,
        label: entry.name,
        kind: 'sheet' as const,
        sourceLine: path,
        url: projectFileUrl(path),
        path,
      };
    });
}

/**
 * The atlas door, memoized per URL.
 *
 * `createSpriteAtlas` already shares one in-flight promise per instance, so the
 * only thing kept here is the INSTANCE — re-picking a sheet in the picker must
 * not re-download an atlas the page already holds. `'nearest'` is set for the
 * same reason the game sets it: linear filtering turns a 12px invader into a
 * blur the moment anything draws it off 1:1, which is exactly what the zoom
 * view does.
 */
const atlasByUrl = new Map<string, SpriteAtlas>();

function atlasFor(url: string): SpriteAtlas {
  const existing = atlasByUrl.get(url);
  if (existing) return existing;
  const atlas = createSpriteAtlas({ url, scaleMode: 'nearest' });
  atlasByUrl.set(url, atlas);
  return atlas;
}

/** The subset of the spritesheet document this module reads. */
interface SheetData {
  frames?: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  animations?: Record<string, string[]>;
  meta?: { image?: string; size?: { w: number; h: number } };
}

export async function loadSheetSubject(ref: LabSubjectRef): Promise<LabSubject> {
  const url = ref.url ?? '';
  const sheet = await atlasFor(url).load();
  const data = sheet.data as unknown as SheetData;
  const imageUrl = new URL(data.meta?.image ?? '', new URL(url, window.location.href)).href;
  const imageWidth = data.meta?.size?.w ?? sheet.textureSource.width;
  const imageHeight = data.meta?.size?.h ?? sheet.textureSource.height;
  const animations: LabAnimation[] = [];
  for (const [name, keys] of Object.entries(data.animations ?? {})) {
    const textures = sheet.animations[name] ?? [];
    const frames: LabFrame[] = keys.map((key, index) => {
      const rect = data.frames?.[key]?.frame ?? { x: 0, y: 0, w: 0, h: 0 };
      return {
        texture: textures[index] ?? Texture.EMPTY,
        imageUrl,
        imageWidth,
        imageHeight,
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
      };
    });
    animations.push({
      name,
      frames,
      cell: frames[0]?.width ?? 0,
      origin: null,
    });
  }
  animations.sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: ref.id,
    label: ref.label,
    kind: 'sheet',
    sourceLine: ref.sourceLine,
    animations,
    imagePath: data.meta?.image ? `${SHEET_DIRECTORY}/${data.meta.image}` : null,
  };
}

// ---------------------------------------------------------------------------
// The rig program — rendered live, in the browser
// ---------------------------------------------------------------------------

/**
 * One posed frame, rasterized by the BROWSER.
 *
 * An SVG document in a data URL through an `Image` is the whole rasterizer: no
 * dependency, no worker, and — the reason it is an `Image` rather than an
 * inline `<svg>` — a decoded bitmap a canvas and therefore a `Texture` can
 * take. `imageSmoothingEnabled = false` matters even at 1:1 because the SVG is
 * drawn at exactly its declared size only when the browser agrees about
 * fractional device pixels; a pixel plan that got resampled here would look
 * like an art bug and be a viewer bug.
 */
async function rasterizeSvg(svg: string, size: number): Promise<HTMLCanvasElement> {
  const image = new Image(size, size);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('sprite-lab: this browser gave no 2D context to render rigs into.');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, size, size);
  return canvas;
}

/**
 * The rig program's animations, posed and rasterized frame by frame.
 *
 * Every frame is one `poseToSvg` at phase `i / frames` — the SAME call the bake
 * makes, so what is on screen here is what the atlas will contain, and a rig
 * that looks wrong here is wrong in the game.
 */
export async function loadProgramSubject(
  spec: SpriteBakeSpec,
  sourcePath: string,
): Promise<LabSubject> {
  const animations: LabAnimation[] = [];
  for (const plan of spec.animations) {
    const frames: LabFrame[] = [];
    for (let index = 0; index < plan.frames; index++) {
      const canvas = await rasterizeSvg(
        poseToSvg(plan.rig, index / plan.frames, { cell: plan.cell }),
        plan.cell,
      );
      const texture = Texture.from(canvas);
      texture.source.scaleMode = 'nearest';
      frames.push({
        texture,
        imageUrl: canvas.toDataURL('image/png'),
        imageWidth: plan.cell,
        imageHeight: plan.cell,
        x: 0,
        y: 0,
        width: plan.cell,
        height: plan.cell,
      });
    }
    animations.push({ name: plan.name, frames, cell: plan.cell, origin: plan.rig.origin });
  }
  return {
    id: 'program',
    label: 'Rig program',
    kind: 'program',
    sourceLine: sourcePath,
    animations,
    imagePath: spec.image,
  };
}

// ---------------------------------------------------------------------------
// Provenance — display only
// ---------------------------------------------------------------------------

export interface AtlasProvenance {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly createdAt: string;
  /** The registered callable that wrote it, and the file it came from. */
  readonly operation: string;
  readonly source: string;
}

interface ProvenanceLedger {
  operations?: Record<
    string,
    {
      createdAt?: string;
      operation?: { name?: string; source?: string };
      outputs?: { path?: string; sha256?: string; bytes?: number }[];
    }
  >;
}

/**
 * The LAST record naming this atlas, from the project's own ledger.
 *
 * Read-only, and deliberately not compared against the bytes on disk: whether
 * the committed atlas is STALE relative to the rig program is a real question
 * with a real owner elsewhere, and a viewer that guessed at it would be
 * inventing a verdict from the one thing it cannot see (whether the source
 * changed since the bake).
 */
export async function loadAtlasProvenance(imagePath: string): Promise<AtlasProvenance | null> {
  const response = await fetch('/__editor/vgai-file?path=.vgai/provenance.json');
  if (!response.ok) return null;
  let ledger: ProvenanceLedger;
  try {
    ledger = JSON.parse(await response.text()) as ProvenanceLedger;
  } catch {
    return null;
  }
  const records = Object.values(ledger.operations ?? {}).flatMap((record) =>
    (record.outputs ?? [])
      .filter((output) => output.path === imagePath)
      .map(
        (output): AtlasProvenance => ({
          path: imagePath,
          sha256: output.sha256 ?? '',
          bytes: output.bytes ?? 0,
          createdAt: record.createdAt ?? '',
          operation: record.operation?.name ?? '',
          source: record.operation?.source ?? '',
        }),
      ),
  );
  // ISO-8601 sorts lexically, so `createdAt` needs no parsing to order.
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return records.at(-1) ?? null;
}
