/**
 * @godot-class ViewportTexture
 * @role BINDING
 *
 * Godot 4.7's `ViewportTexture` (`scene/main/viewport.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a texture showing a SubViewport's image
 * (`sub-viewport.ts`), as three's `CanvasTexture` over the viewport's canvas, sRGB as Godot's 2D is.
 * A scene's ViewportTexture finds its viewport from the node its `viewport_path` names in the
 * resource's local scene (`_setup_local_to_scene`, `:211`), which the scene hands as that node's
 * ref; until the scene has mounted it shows nothing.
 */

import { useEffect, useState } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { godot_node_entity } from './node';
import { godot_sub_viewport_image } from './sub-viewport';

/** A texture with no image yet: a transparent pixel. */
function blank(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * A ViewportTexture with no viewport (`ViewportTexture.new()`): it shows nothing.
 *
 * @godot ViewportTexture.ViewportTexture
 * @source scene/main/viewport.cpp:243
 */
export function construct(): CanvasTexture {
  return blank();
}

/**
 * A scene's ViewportTexture: its SubViewport's image once the scene has mounted `viewport` (read
 * in the scene's effect, so the node may come after the texture's users in the scene), told each
 * time the viewport draws it.
 *
 * @godot ViewportTexture (protocol)
 * @source scene/main/viewport.cpp:211
 */
export function useGodotViewportTexture(viewport: () => object | null): CanvasTexture {
  const [texture] = useState(blank);
  useEffect(() => {
    const held = viewport();
    if (held === null) throw new Error('godot-compat: the SubViewport a ViewportTexture shows was not mounted.');
    texture.image = godot_sub_viewport_image(godot_node_entity(held), texture);
    texture.needsUpdate = true;
  }, [texture]);
  return texture;
}
