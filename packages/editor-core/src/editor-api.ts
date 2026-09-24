/**
 * Editor server SDK.
 *
 * All frontend code should use this module instead of calling fetch()/EventSource
 * with raw endpoint URLs.
 *
 * The project's `public/` file operations (`listAssets`, `saveFile`) are routed
 * through the backend-agnostic `StorageBackend` (see ./storage): `HttpStorage`
 * over the same `/__editor/*` routes, wrapped by the frame's file door once
 * that lands. The remaining endpoints are NOT `public/` file ops — the
 * launcher's own reads, the play-log writes, the asset library, and the
 * user-triggered actions (`createProject`, `browseFolder`,
 * `openProjectOnServer`, `revealInFinder`, `startExport`,
 * `downloadOnlineAsset`).
 */

export type { EditorEventSource } from './editor-presence';
export { connectEvents, connectTabPresence, reportTabRoute } from './editor-presence';

// ---------------------------------------------------------------------------
// The families. This path stays the ONE import site for the editor server SDK
// — every name below was exported from here before the split and still is, so
// no caller changed. What changed is that a reader looking for "how does the
// editor talk to the worktree board" now opens `api/worktrees.ts` instead of
// scrolling an 1,900-line file.
// ---------------------------------------------------------------------------

// `./api/agents` is DELIBERATELY NOT RE-EXPORTED HERE (phase 1 unit 22). It is
// the page-side client for the coding-harness routes, and `@vgai/agents`'s
// modules have always imported `@editor/api/agents` directly rather than
// through this barrel — so the family's claim above ("every name was exported
// from here before the split and still is") was already not how its one
// consumer reads it. What the row bought instead was a static edge from every
// importer of this file into the agents lane's whole wire, which is what held
// four files in the editor's eager closure after the last host caller left.
// The rule is unit 13's, found on the view presenter: a door every package
// calls must not carry every lane's implementation.
export * from './api/assets';
export * from '@volter/editor-sdk/kit/api-build';
export * from '@volter/editor-sdk/kit/api-logs';
export * from '@volter/editor-sdk/kit/api-project-identity';
export * from './api/project-open';
export * from './api/project-source';
export * from './api/project-state';
export * from './api/relay';
export * from '@volter/editor-sdk/kit/api-worktrees';
