/**
 * The `StoriesProvider` node-id protocol's one reserved value.
 *
 * `storiesFor`/`active`/`apply` all take a node id. The EMPTY id is not a node:
 * it is the WORLD-LEVEL question — "list YOUR stories", asked with no node in
 * hand. A world-level provider (contract scenes, a react root's portable CSF)
 * ignores the node id and answers its whole list; a node-scoped provider (the
 * binding `component-states-registry.ts` hands an adapter) has no node here
 * and answers nothing. That
 * difference is the ONE derivation of "which scope is this provider?" in the
 * editor — `components/inspector-stories-gating.ts`'s
 * `resolveWorldStoriesInput`/`resolveNodeScopedStories` are its two readings
 * and must not grow a third.
 *
 * Because it is a PROBE, the answer to it must be a property of the provider,
 * never of session state: an implementer whose empty-id answer depends on what
 * the user last clicked makes its own scope flip under the shell mid-session.
 * Implementers that special-case the empty id import this constant rather than
 * spelling `''`, so the protocol has one definition and the probe and the
 * answer can never drift apart.
 *
 * It lives here (a leaf module importing nothing) rather than beside the gating
 * probe because the providers in this directory answer it, and
 * `components/inspector-stories-gating.ts` value-imports two of them
 * (`ReactRootAuthoringAdapter`, `CompositeAuthoringAdapter`) — so a back-import
 * from an adapter would be a runtime cycle.
 *
 * Nor does it belong in the engine beside `StoriesProvider`. `@volter/editor-project/adapter`,
 * the barrel every consumer imports that type through, is deliberately
 * TYPE-ONLY (P-6) and may not re-export a value; and reaching past it to
 * `@volter/editor-project/adapter/authoring` (which does carry values) would publish an
 * EDITOR-only protocol constant as a public engine entry point, since the
 * engine's export map is the wildcard `"./*"`.
 */
export const WORLD_SCOPE_NODE_ID = '';
