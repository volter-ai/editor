/**
 * @godot-class FontFile
 * @role BINDING
 *
 * Godot 4.7's `FontFile` (`scene/resources/font.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`), as the `font_data_dynamic` importer makes it from a
 * font file (`resource_importer_dynamic_font.cpp:179`), bound onto a browser `FontFace`: the file is
 * copied beside the app and registered with the page as a family of its own, which is the `Font`
 * (`font.ts`) text is measured and drawn in.
 */

import { use } from 'react';
import { type GodotFont, godot_font_register } from './font';
import { godot_resource_loader_track } from './resource-loader';

export type FontFile = GodotFont;

let families = 0;

function made(): FontFile {
  families += 1;
  return { family: `godot-font-file-${String(families)}` };
}

/**
 * `load()` of an imported font file: the FontFile now, registered with the page once the copied
 * file at `url` has loaded; the load is tracked so the scenes mount after it.
 *
 * @godot FontFile (protocol)
 * @source scene/resources/font.cpp:2115
 */
export function godot_font_file_load(url: string, _options: Readonly<Record<string, never>> = {}): FontFile {
  const self = made();
  godot_resource_loader_track(godot_font_register(self, url));
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
    load = { file, loaded: godot_font_register(file, url) };
    SCENE_LOADS.set(url, load);
  }
  use(load.loaded);
  return load.file;
}
