/**
 * The Blender skew's LOOK and BINDINGS as importable values — `@volter/editor-blender/looks`,
 * the public surface a project's `vgai.adapter.ts` declares them from
 * (ARCHITECTURE-CORE §Adapters and contributions are code, not configs):
 *
 *     editor: { Layout: ModelLayout, style: blenderStyle, keymap: blenderKeymap }
 *
 * The same two objects the package's `workspace.style` / `workspace.keymap`
 * contributions register (`package.json#vgai.contributions`). Registration
 * publishes them to every project that declares this package; the adapter's
 * declaration is what CHOOSES them for one.
 */
export { keymap as blenderKeymap } from '../contributions/blender.keymap';
export { style as blenderStyle } from '../contributions/blender.style';
