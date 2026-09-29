import { createHash } from 'node:crypto';
import { encode } from 'fast-png';
import type { GodotValue } from '../read/godot-value';
import type { BoundGodotResourceData, BoundGodotTextureDocument } from './bound-project';

/** Where an `ImageTexture` a document embeds is carried: a PNG beside the document, by its sub-resource id. */
export function godotEmbeddedImagePath(documentResPath: string, id: string): string {
  return `${documentResPath}.${id}.png`;
}

/** `Image::Format`'s 8-bit formats (`core/io/image.h:74`) by the name a resource stores, as channels. */
const CHANNELS: Readonly<Record<string, 1 | 2 | 3 | 4>> = { L8: 1, LA8: 2, RGB8: 3, RGBA8: 4 };

function entry(value: GodotValue | undefined, key: string): GodotValue | undefined {
  return value?.kind === 'dict' ? value.entries.find((item) => item.key === key)?.value : undefined;
}

/**
 * The image of an `Image` resource's `data` (`Image::_set_data`, `core/io/image.cpp:3497`): its
 * width, height, 8-bit format and the base level of its bytes; undefined for another format.
 */
function imageOf(image: BoundGodotResourceData): { readonly width: number; readonly height: number; readonly channels: 1 | 2 | 3 | 4; readonly data: Uint8Array } | undefined {
  const data = image.properties['data'];
  const width = entry(data, 'width');
  const height = entry(data, 'height');
  const format = entry(data, 'format');
  const bytes = entry(data, 'data');
  const channels = format?.kind === 'string' ? CHANNELS[format.value] : undefined;
  if (width?.kind !== 'number' || height?.kind !== 'number' || channels === undefined) return undefined;
  const base64 = bytes?.kind === 'ctor' && bytes.name === 'PackedByteArray' && bytes.args[0]?.kind === 'string' ? bytes.args[0].value : undefined;
  if (base64 === undefined) return undefined;
  const all = Uint8Array.from(Buffer.from(base64, 'base64'));
  const size = width.value * height.value * channels;
  if (all.length < size) return undefined;
  return { width: width.value, height: height.value, channels, data: all.slice(0, size) };
}

/**
 * The `ImageTexture`s documents embed (a binary `.material`'s or a scene's): each image written as
 * a PNG the game carries and loads as it loads an imported image, with no mipmaps, as an
 * `ImageTexture` of an image without them draws.
 */
export function embeddedImageTextures(documents: readonly { readonly resPath: string; readonly subResources: readonly BoundGodotResourceData[] }[]): BoundGodotTextureDocument[] {
  return documents.flatMap((document) =>
    document.subResources.flatMap((resource) => {
      if (resource.type !== 'ImageTexture') return [];
      const reference = resource.properties['image'];
      const id = reference?.kind === 'ctor' && reference.name === 'SubResource' && reference.args[0]?.kind === 'string' ? reference.args[0].value : undefined;
      const image = id === undefined ? undefined : document.subResources.find((entry) => String(entry.id) === id);
      const decoded = image === undefined ? undefined : imageOf(image);
      if (decoded === undefined) return [];
      const bytes = encode({ width: decoded.width, height: decoded.height, data: decoded.data, channels: decoded.channels, depth: 8 });
      return [
        {
          resPath: godotEmbeddedImagePath(document.resPath, String(resource.id)),
          sourceDigest: createHash('sha256').update(bytes).digest('hex'),
          bytes,
          importParams: { mipmapsGenerate: false },
          embeddedIn: { resPath: document.resPath, id: String(resource.id) },
        },
      ];
    }),
  );
}
