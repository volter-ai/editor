/**
 * `node-image` — the image substrate three's GLTF exporter and loader
 * assume a BROWSER provides, supplied for the headless bake.
 *
 * WHY THIS FILE EXISTS. A material map only reaches a GLB through
 * `GLTFExporter.processImage`, which draws the texture into a 2D canvas
 * and asks that canvas for PNG bytes; the re-import reverses it, fetching
 * those bytes as a blob and handing them to `createImageBitmap`. Node has
 * neither a canvas nor an image decoder, so without this the bake either
 * throws (`document is not defined`) or — worse — silently exports a
 * material with no texture at all.
 *
 * WHAT IT DELIBERATELY IS NOT. Not a canvas: every method below exists
 * because a specific line of `GLTFExporter` calls it (`fillRect` and
 * `drawImage` for the metalness/roughness composite, `putImageData` for
 * the `DataTexture` path, `getImageData` for both), and anything else
 * throws rather than pretending. Not an image library either: PNG is the
 * only format, 8-bit RGBA the only layout, and the compression is the
 * platform's own `CompressionStream`/`DecompressionStream` — the same
 * deflate a `zlib` dependency would have called, available in Node and in
 * browsers, so nothing here is a hand-rolled codec beyond PNG's chunk
 * framing and scanline filters.
 *
 * DECODING FILE IMAGES (a PNG a game AUTHOR supplies, rather than one this
 * module just wrote) is a strictly larger problem — palettes, 16-bit,
 * interlacing, JPEG — and is out of scope by decision: procedural
 * `DataTexture` sources only. The decoder below refuses anything it was
 * not built for, by name, instead of guessing.
 */

/** A decoded 8-bit RGBA raster: the shape `ImageData`, `DataTexture.image`
 *  and our `ImageBitmap` stand-in all share, and the only pixel layout
 *  anything in this file handles. */
export interface RgbaRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A `Blob` over a copy of `bytes`. The copy is not incidental: a
 *  `Uint8Array`'s buffer is `ArrayBufferLike` (possibly SHARED), which is
 *  not a `BlobPart`, and a view into a larger buffer would otherwise hand
 *  the whole buffer over. */
function blobOf(bytes: Uint8Array, type?: string): Blob {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy.buffer], type === undefined ? undefined : { type });
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = blobOf(bytes).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = blobOf(bytes).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One PNG chunk: length, type, payload, CRC over type+payload. */
function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(payload.length + 8, crc32(out.subarray(4, payload.length + 8)));
  return out;
}

/** Encode an 8-bit RGBA raster as a PNG (color type 6, no interlacing,
 *  filter 0 on every scanline — the layout a rasterizer produces and the
 *  one glTF embeds). */
export async function encodePng(
  raster: RgbaRaster,
  options: { readonly alpha?: boolean } = {},
): Promise<Uint8Array> {
  const { width, height, data } = raster;
  // THREE CHANNELS OR FOUR. Blender writes colour type 2 for an RGB image
  // setting and type 6 for RGBA, and a reader can tell: the two files differ in
  // every byte. The incoming raster is always RGBA; dropping alpha is a copy,
  // not a conversion.
  const alpha = options.alpha !== false;
  const channels = alpha ? 4 : 3;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    const at = y * (stride + 1) + 1;
    if (alpha) {
      raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), at);
    } else {
      for (let x = 0; x < width; x++) {
        const from = (y * width + x) * 4;
        raw[at + x * 3] = data[from]!;
        raw[at + x * 3 + 1] = data[from + 1]!;
        raw[at + x * 3 + 2] = data[from + 2]!;
      }
    }
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = options.alpha !== false ? 6 : 2; // truecolour with alpha, or without
  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** Undo PNG's per-scanline filters in place (spec §9.2). Four bytes per
 *  pixel, so the "corresponding byte of the pixel to the left" is `x - 4`. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the five filter types are one spec table; splitting them hides the shared left/up/upLeft window.
function unfilter(raw: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const stride = width * 4;
  const out = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[source + x] as number;
      const left = x >= 4 ? (out[target + x - 4] as number) : 0;
      const up = y > 0 ? (out[target - stride + x] as number) : 0;
      const upLeft = y > 0 && x >= 4 ? (out[target - stride + x - 4] as number) : 0;
      let restored: number;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const dLeft = Math.abs(p - left);
        const dUp = Math.abs(p - up);
        const dUpLeft = Math.abs(p - upLeft);
        restored = value + (dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft);
      } else throw new Error(`decodePng: unknown scanline filter ${filter} on row ${y}.`);
      out[target + x] = restored & 0xff;
    }
  }
  return out;
}

/** Decode an 8-bit RGBA PNG. Refuses — by name — every variant this
 *  deliberately does not implement, rather than returning wrong pixels. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one chunk walk plus the refusals it must make while walking; every branch is a named PNG variant.
export async function decodePng(bytes: Uint8Array): Promise<RgbaRaster> {
  for (const [i, expected] of PNG_SIGNATURE.entries()) {
    if (bytes[i] !== expected) {
      throw new Error(
        'decodePng: not a PNG. The headless bake embeds and reads back PNG only; a JPEG or ' +
          'another format needs a real image decoder, which this deliberately is not.',
      );
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const [depth, colorType, , , interlace] = [...payload.subarray(8, 13)];
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(
          `decodePng: only 8-bit RGBA non-interlaced PNG is supported (got bit depth ${depth}, ` +
            `color type ${colorType}, interlace ${interlace}).`,
        );
      }
    } else if (type === 'IDAT') idat.push(payload);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  if (width === 0 || height === 0) throw new Error('decodePng: PNG carries no IHDR dimensions.');
  const packed = new Uint8Array(idat.reduce((total, part) => total + part.length, 0));
  let packedOffset = 0;
  for (const part of idat) {
    packed.set(part, packedOffset);
    packedOffset += part.length;
  }
  const raw = await inflate(packed);
  const expected = (width * 4 + 1) * height;
  if (raw.length < expected) {
    throw new Error(`decodePng: IDAT holds ${raw.length} bytes, expected ${expected}.`);
  }
  return { width, height, data: unfilter(raw, width, height) };
}

/** `ImageData`, as `GLTFExporter` uses it: a constructor over an existing
 *  RGBA buffer, and a `data`/`width`/`height` triple to read back. */
export class NodeImageData implements RgbaRaster {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

/** `#rgb` / `#rrggbb` only — the exporter's one fill is the literal
 *  `'#00ffff'`, and a silently-misparsed color would be an invisible
 *  wrong-metalness bug. */
function parseCssHex(color: string): readonly [number, number, number] {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (short)
    return [0, 1, 2].map((i) =>
      Number.parseInt(`${short[i + 1]}${short[i + 1]}`, 16),
    ) as unknown as readonly [number, number, number];
  if (long) {
    return [0, 1, 2].map((i) => Number.parseInt(long[i + 1] as string, 16)) as unknown as readonly [
      number,
      number,
      number,
    ];
  }
  throw new Error(
    `NodeCanvas2DContext: only '#rgb'/'#rrggbb' fill styles are supported, got '${color}'.`,
  );
}

/** The subset of `CanvasRenderingContext2D` the exporter calls. */
class NodeCanvas2DContext {
  fillStyle = '#000000';
  #canvas: NodeOffscreenCanvas;
  /** `scale(1, -1)` + `translate(0, h)` is the exporter's flipY idiom. A
   *  real `putImageData` IGNORES the transform (spec: it writes device
   *  pixels), so only `drawImage` honours this — matching a browser
   *  exactly, including for the `DataTexture` path where the flip
   *  therefore does nothing. */
  #flipY = false;

  constructor(canvas: NodeOffscreenCanvas) {
    this.#canvas = canvas;
  }

  translate(): void {
    // Recorded by `scale`; the exporter only ever translates to set up a flip.
  }

  scale(_x: number, y: number): void {
    if (y < 0) this.#flipY = !this.#flipY;
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    const [r, g, b] = parseCssHex(this.fillStyle);
    const target = this.#canvas.pixels;
    for (let row = Math.max(0, y); row < Math.min(this.#canvas.height, y + height); row++) {
      for (
        let column = Math.max(0, x);
        column < Math.min(this.#canvas.width, x + width);
        column++
      ) {
        const offset = (row * this.#canvas.width + column) * 4;
        target[offset] = r;
        target[offset + 1] = g;
        target[offset + 2] = b;
        target[offset + 3] = 255;
      }
    }
  }

  getImageData(x: number, y: number, width: number, height: number): NodeImageData {
    const out = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      const sourceRow = y + row;
      if (sourceRow < 0 || sourceRow >= this.#canvas.height) continue;
      for (let column = 0; column < width; column++) {
        const sourceColumn = x + column;
        if (sourceColumn < 0 || sourceColumn >= this.#canvas.width) continue;
        const from = (sourceRow * this.#canvas.width + sourceColumn) * 4;
        const to = (row * width + column) * 4;
        for (let c = 0; c < 4; c++) out[to + c] = this.#canvas.pixels[from + c] as number;
      }
    }
    return new NodeImageData(out, width, height);
  }

  putImageData(image: RgbaRaster, dx: number, dy: number): void {
    for (let row = 0; row < image.height; row++) {
      const targetRow = dy + row;
      if (targetRow < 0 || targetRow >= this.#canvas.height) continue;
      for (let column = 0; column < image.width; column++) {
        const targetColumn = dx + column;
        if (targetColumn < 0 || targetColumn >= this.#canvas.width) continue;
        const from = (row * image.width + column) * 4;
        const to = (targetRow * this.#canvas.width + targetColumn) * 4;
        for (let c = 0; c < 4; c++) this.#canvas.pixels[to + c] = image.data[from + c] as number;
      }
    }
  }

  /** Nearest-neighbour blit of any RGBA raster (a decoded bitmap or
   *  another canvas). The exporter only ever scales a whole image into a
   *  whole canvas, which is the metalness/roughness composite path. */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one nested sampling loop with its bounds and flip guards inline; extracting them costs a call per pixel.
  drawImage(source: unknown, dx: number, dy: number, dw?: number, dh?: number): void {
    const raster = source as Partial<RgbaRaster> & { pixels?: Uint8ClampedArray };
    const data = raster.data ?? raster.pixels;
    if (!data || !raster.width || !raster.height) {
      throw new Error(
        'NodeCanvas2DContext.drawImage: only RGBA rasters produced by this module ' +
          '(a decoded bitmap, a DataTexture image, or another canvas) can be drawn headlessly.',
      );
    }
    const width = dw ?? raster.width;
    const height = dh ?? raster.height;
    for (let row = 0; row < height; row++) {
      const targetRow = dy + (this.#flipY ? height - 1 - row : row);
      if (targetRow < 0 || targetRow >= this.#canvas.height) continue;
      const sourceRow = Math.min(raster.height - 1, Math.floor((row * raster.height) / height));
      for (let column = 0; column < width; column++) {
        const targetColumn = dx + column;
        if (targetColumn < 0 || targetColumn >= this.#canvas.width) continue;
        const sourceColumn = Math.min(
          raster.width - 1,
          Math.floor((column * raster.width) / width),
        );
        const from = (sourceRow * raster.width + sourceColumn) * 4;
        const to = (targetRow * this.#canvas.width + targetColumn) * 4;
        for (let c = 0; c < 4; c++) this.#canvas.pixels[to + c] = data[from + c] as number;
      }
    }
  }
}

/** `OffscreenCanvas`, as `GLTFExporter.getCanvas()` expects to find it when
 *  `document` is undefined: sized after construction, one 2D context, and
 *  `convertToBlob` for the PNG bytes that become the GLB's image
 *  bufferView. */
export class NodeOffscreenCanvas {
  #width = 1;
  #height = 1;
  #pixels = new Uint8ClampedArray(4);
  #context: NodeCanvas2DContext | undefined;

  constructor(width = 1, height = 1) {
    this.width = width;
    this.height = height;
  }

  get width(): number {
    return this.#width;
  }

  set width(value: number) {
    this.#width = value;
    this.#resize();
  }

  get height(): number {
    return this.#height;
  }

  set height(value: number) {
    this.#height = value;
    this.#resize();
  }

  /** The RGBA backing store, transparent black until something draws. */
  get pixels(): Uint8ClampedArray {
    return this.#pixels;
  }

  #resize(): void {
    this.#pixels = new Uint8ClampedArray(Math.max(0, this.#width * this.#height * 4));
  }

  getContext(kind: string): NodeCanvas2DContext {
    if (kind !== '2d') {
      throw new Error(
        `NodeOffscreenCanvas: only the '2d' context exists headlessly, got '${kind}'.`,
      );
    }
    this.#context ??= new NodeCanvas2DContext(this);
    return this.#context;
  }

  async convertToBlob(options: { type?: string } = {}): Promise<Blob> {
    const type = options.type ?? 'image/png';
    if (type !== 'image/png') {
      throw new Error(
        `NodeOffscreenCanvas.convertToBlob: the headless bake encodes PNG only, got '${type}'.`,
      );
    }
    const png = await encodePng({ width: this.#width, height: this.#height, data: this.#pixels });
    return blobOf(png, type);
  }
}

let warnedAboutUndecodableImage = false;

/**
 * `createImageBitmap`, as `ImageBitmapLoader` calls it on the re-import
 * side: decode the blob and hand back something three can hang on a
 * `Texture` — with its pixels still readable, which is what makes a
 * round-trip texel assertion possible at all.
 *
 * An image this cannot decode (a JPEG in someone's downloaded clip-source
 * GLB, say) REJECTS. `GLTFLoader` catches that and prints its own
 * `Couldn't load texture <url>`, which says nothing about why, so the
 * reason is printed once per process here. The alternative — the empty
 * object this used to return — left the material holding a texture with
 * nothing behind it, which is worse in every direction.
 */
export async function createImageBitmapFromBlob(
  source: Blob | ArrayBuffer | Uint8Array,
): Promise<RgbaRaster & { close(): void }> {
  const bytes =
    source instanceof Uint8Array
      ? source
      : new Uint8Array(source instanceof ArrayBuffer ? source : await source.arrayBuffer());
  try {
    const raster = await decodePng(bytes);
    return { ...raster, close() {} };
  } catch (error) {
    if (!warnedAboutUndecodableImage) {
      warnedAboutUndecodableImage = true;
      console.warn(
        'headless bake: an embedded image could not be decoded, so its texture is dropped on ' +
          'import (the geometry and animations are unaffected). Only PNG is decodable outside a ' +
          `browser — see lib/bake/node-image.ts. ${(error as Error).message}`,
      );
    }
    throw error;
  }
}
