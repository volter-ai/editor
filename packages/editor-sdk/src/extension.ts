/**
 * Extension contract (W3a) — the published surface a game project uses to
 * contribute to the editor, with the degradation ladder made API.
 *
 * A project extends the editor through exactly three surfaces:
 *
 * (a) **Editor panels** — registered into the workspace as documents
 *     or utilities via a tool contribution (`package.json#vgai.tools` →
 *     `contributes: [{ point: 'workspace.document' | 'workspace.utility' | 'workspace.analytics' }]`).
 *     Types: `ToolContributionProps` in `@volter/editor-sdk/contributions`.
 *     Panels are never a parallel rail — the frame owns all layout.
 * (b) **Inspector sections** — `point: 'selection.inspector'` /
 *     `'asset.inspector'` tool contributions with an exported `match`.
 *     Types: `ToolInspectorContributionProps` and friends, same module.
 * (c) **System adapters** — runtime capabilities (networking, debug, …)
 *     registered from game code via `ctx.registerSystemAdapter?.(kind, impl)`
 *     (`SystemAdapters` in `@volter/editor-project`'s
 *     `adapter/system-adapter`). Deliberately NOT re-exported here: the
 *     engine already publishes that seam and every consumer of it also
 *     imports the engine — an alias would be a dead surface.
 *
 * Outcomes (the anti-shim rule, as API): every contribution resolves to an
 * {@link ExtensionContributionState} —
 *
 * - `'active'` — the contribution loaded and produced its surface.
 * - `'absent'` — nothing was contributed. The editor HIDES the surface
 *   entirely; it never fabricates placeholder data for a missing
 *   contribution.
 * - `'failed'` — the contribution exists but threw / violated the contract.
 *   The failure is contained per-contribution (the editor never crashes),
 *   the surface is hidden, and the error is reported LOUDLY (editor
 *   console) — never silently swallowed into fake output.
 */

/**
 * The terminal state of a single extension contribution (see the module doc
 * above for the exact semantics). Not a grade and not an ordering: `absent`
 * and `failed` both hide the surface, and `failed` is reported loudly.
 */
export type ExtensionContributionState = 'active' | 'absent' | 'failed';
