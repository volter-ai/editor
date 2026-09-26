/**
 * The display objects a canvas world creates, as its create dialog lists them: Pixi's own class
 * tree (every one of them is a Container) and a line on what each is, from Pixi's API reference.
 */

import type { CreatableKind } from '@volter/editor-project/adapter';

export const PIXI_CREATABLE_KINDS: readonly CreatableKind[] = [
  {
    kind: 'container',
    label: 'Container',
    description: 'A general-purpose display object that holds children, and transforms and draws them together.',
  },
  {
    kind: 'sprite',
    label: 'Sprite',
    extends: 'container',
    description: 'Draws one texture: an image, or a frame of a spritesheet.',
  },
  {
    kind: 'text',
    label: 'Text',
    extends: 'container',
    description: 'Draws a string with a text style (font, size, fill, wrapping).',
  },
  {
    kind: 'graphics',
    label: 'Graphics',
    extends: 'container',
    description: 'Draws vector shapes (rectangles, circles, paths) from its draw callback.',
  },
];
