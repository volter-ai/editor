/**
 * THE SESSION FACE — what the session SERVER and the editor PAGE both agree on.
 *
 * `@volter/editor-sdk` is the API with four faces (ARCHITECTURE-CORE §The target
 * shape): protocol, host doors + layouts, widgets, session client. This is the
 * protocol face's home, and it exists because of a LICENCE fact, not tidiness:
 * the target shape's editor-kit row says the session server and the CLI are
 * Apache "ONLY once the session imports nothing of the editor". Every module
 * re-exported here used to live in `packages/editor/src/` (AGPL-3.0-only) and
 * was value-imported by `packages/editor/server/**`, so the Node session's
 * import graph reached AGPL application code on every boot.
 *
 * What qualifies for this face: a shape TWO programs must agree on, that imports
 * neither React, nor the editor shell store, nor `node:` — measured, not
 * asserted. All twelve below import nothing but `../share`, `@volter/editor-project`'s
 * manifest schema, and each other. A module the editor app merely happens to
 * share with the server does NOT qualify; it stays where it is and shows up in
 * `scripts/validate-import-bans.mjs`'s `server-imports-editor-app` ratchet with
 * a reason, until someone makes it a contract or deletes it.
 *
 * IMPORT THE MODULE, NOT THIS BARREL, from anything the closure meter watches:
 * `@volter/editor-sdk/session/relative-path-guard`. The subpath is a wildcard
 * export (`"./session/*"`), the same shape the runtime packages use, because
 * `export *` here would put all twelve modules in every consumer's static
 * value-import closure — measured at +4 files on the `full` build and +5 on
 * `models` the one time this file was the door. This barrel is documentation
 * and a convenience for callers no meter watches.
 */

export * from './session/build-report';
export * from './session/collaboration-types';
export * from './session/command-table';
export * from './session/editor-brand';
export * from './session/editor-compatibility';
export * from './session/editor-control-lifecycle';
export * from './session/editor-control-protocol';
export * from './session/game-css-scope';
export * from './session/project-module-url';
export * from './session/relative-path-guard';
export * from './session/source-glob';
export * from './session/tool-contribution-convention';
