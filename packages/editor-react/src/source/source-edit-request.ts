/**
 * The SOURCE-EDIT REQUEST — the one wire shape a source edit is stated in, and
 * deliberately its own file.
 *
 * It sits between two programs that must NOT share a type graph: the browser
 * editor (`ui-source/source-write-backend.ts`, which posts it) and the NODE
 * dev server (`vite-plugin-ui-oid.ts`'s middleware and `ui-source/plan-source-edit.ts`,
 * which plan and apply it). Until 2026-09-20 both sides imported the type from
 * `source-write-backend.ts` — and that module value-imports `files/project-files.ts`,
 * which reaches `storage/` and from there the editor SHELL STORE, so
 * `tsconfig.server.json` compiled 231 browser modules including 36 React ones to
 * typecheck a Node program (the fourth blind review's "the Node server's type graph
 * now reaching the browser app"; the config's own header recorded the 310 errors
 * that forced its `paths` and `jsx` settings).
 *
 * So: the REQUEST lives here, importing nothing but its two sibling AST types, and
 * `source-write-backend.ts` re-exports it for the browser callers that already name
 * it. Anything added to this file must stay free of browser and Node imports alike —
 * it is read by both.
 */

export type { PreparedSourceEdit, SourceEditRequest, StructReparentContext } from '@volter/editor-sdk/source-authoring';
