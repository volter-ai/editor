/**
 * The display objects a canvas world creates, as its create dialog lists them: Pixi's own class
 * tree (every one of them is a Container) and a line on what each is, from Pixi's API reference.
 */

import type { CreatableKind } from '@volter/project/adapter';

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
    kind: 'animatedSprite',
    label: 'AnimatedSprite',
    extends: 'sprite',
    description: 'Plays a list of textures as frames at an animation speed.',
  },
  {
    kind: 'tilingSprite',
    label: 'TilingSprite',
    extends: 'container',
    description: 'Repeats one texture across its width and height, scrollable by its tile position.',
  },
  {
    kind: 'nineSliceSprite',
    label: 'NineSliceSprite',
    extends: 'container',
    description: 'Stretches a texture without stretching its corners: the nine-slice panel of a UI.',
  },
  {
    kind: 'text',
    label: 'Text',
    extends: 'container',
    description: 'Draws a string with a text style (font, size, fill, wrapping).',
  },
  {
    kind: 'bitmapText',
    label: 'BitmapText',
    extends: 'container',
    description: 'Draws a string from a bitmap font: fast to change every frame.',
  },
  {
    kind: 'htmlText',
    label: 'HTMLText',
    extends: 'container',
    description: 'Draws a string of HTML and CSS markup.',
  },
  {
    kind: 'graphics',
    label: 'Graphics',
    extends: 'container',
    description: 'Draws vector shapes (rectangles, circles, paths) from its draw callback.',
  },
  {
    kind: 'meshPlane',
    label: 'MeshPlane',
    extends: 'container',
    description: 'A textured grid of vertices that can be bent and deformed.',
  },
  {
    kind: 'perspectiveMesh',
    label: 'PerspectiveMesh',
    extends: 'meshPlane',
    description: 'A texture drawn in perspective between four corner points.',
  },
  {
    kind: 'particleContainer',
    label: 'ParticleContainer',
    extends: 'container',
    description: 'Draws many lightweight particles in one batch, added from code with addParticle.',
  },
];
