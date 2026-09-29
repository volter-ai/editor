/**
 * The images a document embeds (read decodes, docs/GODOT.md row 2): each `Image` sub-resource's
 * `data` (`Image::_set_data`, `core/io/image.cpp:3930`), its width, height, format and pixels,
 * decoded into a PNG the page loads as it loads an imported image. The formats the page's PNG
 * holds as they are (`L8`, `LA8`, `RGB8`, `RGBA8`) are carried; any other format, or pixels of the
 * wrong length, is left out, and the texture naming it refuses at plan time by name.
 */
import { encode } from 'fast-png';
import type { GodotValue } from './godot-value';

/** An image a document embeds, as a PNG: the document and the Image's id, its size and bytes. */
export interface GodotEmbeddedImage {
  readonly owner: string;
  readonly id: string;
  readonly size: readonly [number, number];
  readonly png: Uint8Array;
}

/** `Image::Format` by the name `_set_data` writes, as PNG channels. */
const CHANNELS: Readonly<Record<string, number>> = { L8: 1, LA8: 2, RGB8: 3, RGBA8: 4 };

function entry(value: GodotValue | undefined, key: string): GodotValue | undefined {
  return value?.kind === 'dict' ? value.entries.find((item) => item.key === key)?.value : undefined;
}

/** A PackedByteArray as its bytes: base64 as the binary reader writes it, or numbers as text does. */
function bytesOf(value: GodotValue | undefined): Uint8Array | undefined {
  if (value?.kind !== 'ctor' || value.name !== 'PackedByteArray') return undefined;
  const [first] = value.args;
  if (value.args.length === 1 && first?.kind === 'string') return new Uint8Array(Buffer.from(first.value, 'base64'));
  const numbers = value.args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
  return numbers.every((number): number is number => number !== undefined) ? Uint8Array.from(numbers) : undefined;
}

/** The images the documents embed, decoded. */
export function godotEmbeddedImages(
  documents: readonly { readonly resPath: string; readonly subResources: readonly { readonly id: string | number; readonly type: string; readonly properties: Readonly<Record<string, GodotValue>> }[] }[],
): GodotEmbeddedImage[] {
  const images: GodotEmbeddedImage[] = [];
  for (const document of documents) {
    for (const sub of document.subResources) {
      if (sub.type !== 'Image') continue;
      const data = sub.properties['data'];
      const width = entry(data, 'width');
      const height = entry(data, 'height');
      const format = entry(data, 'format');
      const pixels = bytesOf(entry(data, 'data'));
      const channels = format?.kind === 'string' ? CHANNELS[format.value] : undefined;
      if (width?.kind !== 'number' || height?.kind !== 'number' || channels === undefined || pixels === undefined) continue;
      // The first mipmap level, where the image carries its chain (`mipmaps`).
      const length = width.value * height.value * channels;
      if (pixels.length < length) continue;
      const png = encode({ width: width.value, height: height.value, data: pixels.subarray(0, length), channels, depth: 8 });
      images.push({ owner: document.resPath, id: String(sub.id), size: [width.value, height.value], png });
    }
  }
  return images;
}
