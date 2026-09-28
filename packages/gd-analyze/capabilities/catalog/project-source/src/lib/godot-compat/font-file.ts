/**
 * @godot-class FontFile
 * @role BINDING
 *
 * Godot 4.7's `FontFile` (`scene/resources/font.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the `font_data_dynamic` importer makes it: the
 * font file's bytes (`ResourceImporterDynamicFont::import` sets them as its data,
 * `resource_importer_dynamic_font.cpp:179`). Here the file is copied beside the app; the page
 * draws in it as a `FontFace` of its own family, and compat's text server (`font.ts`) measures it
 * from the same bytes, with the importer defaults it measures the default theme's font with.
 */

import { use } from 'react';
import { type GodotFont, godot_font_load } from './font';
import { godot_resource_loader_track } from './resource-loader';

export interface FontFile {
  /** The page's font family the file is registered as, which a Label draws in. */
  readonly family: string;
}

/** Each loaded file's face, which compat's text server measures. */
const FACES = new WeakMap<FontFile, GodotFont>();

let families = 0;

function made(): FontFile {
  families += 1;
  return { family: `godot-font-file-${String(families)}` };
}

/**
 * The face compat's text server measures the file with (`font.ts`), once it has loaded.
 *
 * @godot FontFile (protocol)
 * @source scene/resources/font.cpp:2115
 */
export function godot_font_file_face(self: FontFile): GodotFont {
  const face = FACES.get(self);
  if (face === undefined) throw new Error(`godot-compat: the font file ${self.family} has not loaded`);
  return face;
}

/** The copied file at `url`: registered with the page as the font's family, and read for measuring. */
async function read(self: FontFile, url: string): Promise<void> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const page = (globalThis as { readonly document?: Document }).document;
  if (page?.fonts !== undefined && typeof FontFace === 'function') {
    page.fonts.add(await new FontFace(self.family, bytes.slice(0)).load());
  }
  FACES.set(self, godot_font_load(new Uint8Array(bytes)));
}

/**
 * `load()` of an imported font file: the FontFile now, its data once the copied file at `url` has
 * loaded; the load is tracked so the scenes mount after it.
 *
 * @godot FontFile (protocol)
 * @source scene/resources/font.cpp:2115
 */
export function godot_font_file_load(url: string, _options: Readonly<Record<string, never>> = {}): FontFile {
  const self = made();
  godot_resource_loader_track(read(self, url));
  return self;
}

const SCENE_LOADS = new Map<string, { readonly file: FontFile; readonly loaded: Promise<void> }>();

/**
 * A scene's imported font file, as a component loads it: the FontFile of the copied file at `url`,
 * once for every scene that uses it (Godot's resource cache), the component suspended until it loads.
 *
 * @godot FontFile (protocol)
 * @source core/io/resource_loader.cpp:725
 */
export function useGodotFontFile(url: string, _options: Readonly<Record<string, never>> = {}): FontFile {
  let load = SCENE_LOADS.get(url);
  if (load === undefined) {
    const file = made();
    load = { file, loaded: read(file, url) };
    SCENE_LOADS.set(url, load);
  }
  use(load.loaded);
  return load.file;
}
