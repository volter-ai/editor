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

import type { ReparentRebase } from './reparent-guard';
import type { DuplicateRewrite } from './writer';

/**
 * What only the LIVE scene knows about a `reparent`, carried on the request so the
 * pure planner (`reparent-guard.ts`) can decide R2/R3 without a scene of its own.
 *
 * Every field is optional and every one of them can only make the plan MORE strict:
 * the planner's source-derivable rules (scope safety, children slot, literal-vs-
 * dynamic) run identically whether or not a caller supplies them, so a client that
 * knows nothing still gets a sound refusal rather than a silent corruption.
 */
export interface StructReparentContext {
  /** The new LOCAL transform that preserves the element's world transform under the
   *  destination — the caller computed it from the two live parents (R2). */
  rebase?: ReparentRebase;
  /** Live objects the destination oid resolves to; >1 is refused with the count (R3). */
  destinationInstances?: number;
  /** Live objects the moved element's oid resolves to; >1 warns and is allowed (R3). */
  sourceInstances?: number;
}

export type SourceEditRequest =
  /** `value` is a NUMBER for a numeric CSS property, and that is load-bearing:
   *  the writer emits a bare `12` (which React px-ifies at render) rather than
   *  the quoted `'12'` the CSSOM rejects. `null` is the REMOVAL sentinel. */
  | { kind: 'style'; oid: string; prop: string; value: string | number | null }
  | { kind: 'css'; file: string; selector: string; prop: string; value: string; media?: string }
  | { kind: 'text'; oid: string; text: string }
  | {
      kind: 'prop';
      oid: string;
      prop: string;
      /** `null` is the REMOVAL sentinel — the same shape `style` uses (D-A3);
       *  it routes to `removePropAttribute` instead of a value write. */
      value: string | null;
      addIfMissing?: boolean;
      allowShapeUpgrade?: boolean;
    }
  | {
      /** Replace a literal default in the component declaration containing
       * `oid`. The component name comes from the OID index, never the caller. */
      kind: 'component-default';
      oid: string;
      prop: string;
      value: string;
    }
  | ({
      kind: 'struct';
      oid: string;
      op: string;
      targetOid?: string;
      parentOid?: string;
      wrapperTag?: string;
      /** Optional multi-line JSX snippet for `create`/`create-sibling` — see
       *  `insertChildElement` / `insertSiblingElement`. */
      snippet?: string;
      /** A named import the inserted `snippet` needs (its tag is a component).
       *  Applied to the SAME file in the same plan, so the insert and the import
       *  it depends on are one write and one undo entry — see `ensureNamedImport`. */
      ensureImport?: { name: string; module: string; kind?: 'default' | 'named' };
      /** `duplicate` only — what the copy should differ in (`writer.ts` `DuplicateRewrite`). */
      duplicate?: DuplicateRewrite;
    } & StructReparentContext)
  | { kind: 'struct-many'; oids: readonly string[]; op: string; wrapperTag?: string };

export interface PreparedSourceEdit {
  readonly changed: boolean;
  readonly file?: string;
  readonly resourcePath?: string;
  readonly prevSource?: string;
  readonly newSource?: string;
  readonly prevSha?: string;
  readonly newSha?: string;
  readonly result: Record<string, unknown>;
}
