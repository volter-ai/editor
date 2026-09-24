/**
 * ONE rule for "which portable-story args are editable, and as what" —
 * extracted verbatim from `authoring/react-world-authoring-adapter.ts`'s
 * private `portableStoryArgDescriptors` (the Storybook-Controls semantic it has
 * always applied to a story node in the React hierarchy), so the three-story
 * board's per-story document describes its args the SAME way instead of
 * inventing a second answer.
 *
 * Storybook's own Controls semantic: a story's arg is editable when it carries
 * a primitive value the author can meaningfully type; anything else (a
 * callback, a symbol, an unset arg) stays out of the visual form while
 * remaining present in the complete args object the composed story is rendered
 * with. Non-primitive OBJECT/array values are surfaced as `json`, which is what
 * the generic inspector's JSON widget is for.
 */

import type { PropertyDescriptor } from '@volter/editor-project/adapter';

/**
 * Descriptors for one composed story's args, under `pathPrefix`.
 *
 * `pathPrefix` is the caller's, because the path namespace belongs to whoever
 * owns the inspector node the descriptors are read back through — the React
 * world adapter keys its story nodes under `story.arg.`, and the three-story
 * document uses its own.
 */
export function storyArgPropertyDescriptors(
  args: Record<string, unknown>,
  pathPrefix: string,
): PropertyDescriptor[] {
  return Object.entries(args).flatMap(([name, value]) => {
    if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) return [];
    const type: PropertyDescriptor['type'] =
      typeof value === 'boolean'
        ? 'boolean'
        : typeof value === 'number'
          ? 'number'
          : typeof value === 'string'
            ? 'string'
            : 'json';
    return [
      {
        path: `${pathPrefix}${name}`,
        label: name,
        type,
        group: 'Args',
      },
    ];
  });
}
