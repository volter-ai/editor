/**
 * React as the implementer of this project's `dom` roots.
 *
 * A `dom` root is one of the three things the host can hand you: an
 * `HTMLElement` (the others being a `<canvas>` and a shared `three`
 * instance). What mounts into that element is entirely your choice — the
 * engine has no opinion and ships no default, which is why this file lives in
 * your project rather than in the engine.
 *
 * React is the shipped choice because the editor's JSX authoring
 * (OID-addressed hierarchy, style/className write-back to source) is built on
 * it. Nothing forces it: register your own factory for `'dom'` and the same
 * root mounts Vue, Svelte, or plain DOM. You lose the JSX authoring panels
 * until that stack supplies its own authoring adapter — the panel is the
 * reward for implementing the adapter, and the game runs regardless.
 *
 * Thirty lines, and every one of them is React's own API — `createRoot`,
 * `flushSync`, `unmount`. Copied in, yours to edit.
 */
export { createReactRootAdapter, registerReactAdapter } from './react-root-adapter';
