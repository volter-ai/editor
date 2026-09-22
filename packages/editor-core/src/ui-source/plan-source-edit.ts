/**
 * `planSourceEdit` — the PURE core of a source edit: request + already-read file
 * bytes in, exact before/after bytes out. No I/O, no hashing, no transport.
 *
 * Why it exists: the same edit vocabulary (`SourceEditRequest`) has to be
 * executed by the dev server (`vite-plugin-ui-oid.ts`'s `handlePrepare`),
 * which reads with `node:fs` and hashes with `node:crypto`. The plan itself is
 * environment-free on purpose: resolving an oid to a source offset,
 * picking the writer function, deciding what `changed` means — is identical,
 * and a second hand-written copy of that switch is exactly the kind of fork
 * this repo has been bitten by. So the switch lives here once, over an
 * injected `sources` map the caller has already populated however it can.
 *
 * The caller learns WHICH files to read first from {@link sourceEditFiles},
 * which resolves the request's oids through the same `OidEntry` index without
 * touching any bytes.
 */

import { ensureValueImport } from './ensure-import';
import { lineColToOffset, type OidEntry } from './oid-transform';
import { planReparent } from './reparent-guard';
import type { SourceEditRequest } from './source-edit-request';
import { UTILITY_CLASSES_UNPROVEN, type UtilityClassSupport } from './utility-class-support';
import { writeComponentDefault } from './write-component-default';
import {
  deleteElement,
  deleteElements,
  duplicateElement,
  editTextContent,
  getEditableText,
  groupSiblingElements,
  insertChildElement,
  insertSiblingElement,
  removeInlineStyle,
  removePropAttribute,
  reorderChild,
  type StructEditResult,
  type StyleEditResult,
  surgicalCssEdit,
  surgicalCssEditInMedia,
  unwrapElement,
  wrapElement,
  writePropChange,
  writeStyleAuto,
} from './writer';

/** Resolve an oid to its source location, or `undefined` when unknown. */
export type OidResolver = (oid: string) => OidEntry | undefined;

/**
 * The outcome of planning one edit.
 *
 * `file === null` means the request never reached a file at all (unknown oid,
 * malformed batch, out-of-scope css path) — `result.error` says why. Otherwise
 * `prevSource`/`newSource` are the WHOLE file before and after; they are equal
 * when the edit was a source no-op (a refused dynamic prop, an absent literal).
 */
export interface SourceEditPlan {
  readonly file: string | null;
  readonly changed: boolean;
  readonly prevSource: string;
  readonly newSource: string;
  readonly result: Record<string, unknown>;
}

function failed(error: string): SourceEditPlan {
  return { file: null, changed: false, prevSource: '', newSource: '', result: { error } };
}

function planned(
  file: string,
  prevSource: string,
  newSource: string,
  result: Record<string, unknown>,
): SourceEditPlan {
  const changed = prevSource !== newSource && result['changed'] !== false;
  return { file, changed, prevSource, newSource, result: { ...result, changed } };
}

/**
 * D-A3: a `value: null` style request is the REMOVAL sentinel
 * routed to `removeInlineStyle`; anything else takes the normal
 * write-or-append path. Kept here (rather than in the vite plugin, where it
 * used to live alone) because BOTH tiers route the same sentinel.
 *
 * `support` is the caller's OBSERVATION about the target project's utility-class
 * pipeline — the class-vs-inline gate (`utility-class-support.ts`). Omitting it
 * means "unproven", which routes inline: the write that paints in every project.
 */
export function applyStyleWriteRequest(
  code: string,
  elementStart: number,
  prop: string,
  value: string | number | null,
  support?: UtilityClassSupport,
): StyleEditResult & { route?: 'class' | 'inline'; error?: string } {
  if (value === null) return removeInlineStyle(code, elementStart, prop);
  return writeStyleAuto(code, elementStart, prop, value, support ?? UTILITY_CLASSES_UNPROVEN);
}

/**
 * Every source file this request needs read before {@link planSourceEdit} can
 * run. Empty when the request cannot resolve at all — plan it anyway and read
 * the honest error off the returned plan, rather than guessing here.
 */
export function sourceEditFiles(
  request: SourceEditRequest,
  resolveOid: OidResolver,
): readonly string[] {
  if (request.kind === 'css') {
    const clean = request.file.split('?')[0] ?? request.file;
    return clean ? [clean] : [];
  }
  const oids =
    request.kind === 'struct-many'
      ? [...new Set(request.oids)]
      : [request.oid, ...(request.kind === 'struct' ? [request.targetOid, request.parentOid] : [])];
  const files = new Set<string>();
  for (const oid of oids) {
    if (typeof oid !== 'string') continue;
    const entry = resolveOid(oid);
    if (entry) files.add(entry.file);
  }
  return [...files];
}

/**
 * Apply `request` to the source text in `sources`, returning exact before/after
 * bytes. Never throws for an ordinary refusal (unknown oid, cross-file move,
 * unknown op) — those come back as a `result.error` plan so the caller can
 * report them; a MISSING entry in `sources` for a file the request resolved to
 * IS a programming error and throws, because a silently-skipped write is the
 * one outcome this seam must never produce.
 */
export function planSourceEdit(
  request: SourceEditRequest,
  sources: ReadonlyMap<string, string>,
  resolveOid: OidResolver,
  /** The target project's observed utility-class support; absent ⇒ unproven ⇒ inline. */
  utilityClasses: UtilityClassSupport = UTILITY_CLASSES_UNPROVEN,
): SourceEditPlan {
  const sourceOf = (file: string): string => {
    const source = sources.get(file);
    if (source === undefined) {
      throw new Error(`planSourceEdit: source for "${file}" was not provided.`);
    }
    return source;
  };

  if (request.kind === 'css') {
    const cleanFile = request.file.split('?')[0] ?? request.file;
    const src = sourceOf(cleanFile);
    // `media` scopes the edit to a breakpoint's `@media` block (design
    // ledger: breakpoints) — block and rule are minted on demand, so the
    // base path's generated-CSS probe does not apply.
    const edited =
      typeof request.media === 'string' && request.media.trim().length > 0
        ? surgicalCssEditInMedia(src, request.media, request.selector, request.prop, request.value)
        : surgicalCssEdit(src, request.selector, request.prop, request.value);
    if (edited === null) return planned(cleanFile, src, src, { changed: false, generated: true });
    return planned(cleanFile, src, edited, { changed: edited !== src });
  }

  if (request.kind === 'struct-many') {
    const { oids, op } = request;
    if ((op !== 'delete' && op !== 'group') || !Array.isArray(oids) || oids.length === 0) {
      return failed('invalid struct-many request');
    }
    const entries = [...new Set(oids)].map((oid) => ({ oid, entry: resolveOid(oid) }));
    const missing = entries.find((item) => !item.entry);
    if (missing) return failed(`unknown oid: ${missing.oid}`);
    const file = entries[0]!.entry!.file;
    if (entries.some((item) => item.entry!.file !== file)) {
      return failed('cannot batch-delete across files');
    }
    // ONE snapshot every offset resolves against — see `handleStructMany`'s
    // doc comment for why a per-oid re-read would be unsound here.
    const src = sourceOf(file);
    const offsets = entries.map((item) => lineColToOffset(src, item.entry!.line, item.entry!.col));
    const result =
      op === 'group'
        ? groupSiblingElements(src, offsets, request.wrapperTag)
        : deleteElements(src, offsets);
    return planned(file, src, result.code, { changed: result.changed });
  }

  const entry = resolveOid(request.oid);
  if (!entry) return failed('unknown oid');
  const src = sourceOf(entry.file);
  const off = lineColToOffset(src, entry.line, entry.col);

  if (request.kind === 'component-default') {
    if (!entry.component) {
      return planned(entry.file, src, src, {
        changed: false,
        dynamic: true,
        error: 'the selected definition is not inside a named component.',
      });
    }
    const result = writeComponentDefault(
      src,
      entry.file,
      entry.component,
      request.prop,
      request.value,
    );
    return planned(entry.file, src, result.code, {
      changed: result.changed,
      dynamic: result.dynamic,
      ...(result.error ? { error: result.error } : {}),
    });
  }

  if (request.kind === 'style') {
    // The value goes through UNCONVERTED: a number must stay a number so the
    // writer emits a bare `12` (React px-ifies it) instead of `'12'` (the
    // CSSOM rejects a unitless length and keeps the previous value).
    const result = applyStyleWriteRequest(src, off, request.prop, request.value, utilityClasses);
    return planned(entry.file, src, result.code, {
      changed: result.changed,
      dynamic: result.dynamic,
      route: result.route,
      appended: result.appended,
      // The `var()` guard's own channel — a refusal the caller must be able to
      // tell from a dynamic expression, because its sentence names a token.
      ...(result.tokenRef ? { tokenRef: result.tokenRef } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  }

  if (request.kind === 'text') {
    const prevText = getEditableText(src, off);
    const result = editTextContent(src, off, request.text);
    return planned(entry.file, src, result.code, {
      changed: result.changed,
      dynamic: result.dynamic,
      prevText,
    });
  }

  if (request.kind === 'prop') {
    // `value: null` is the REMOVAL sentinel (same shape as `style`) — reverting
    // a prop to the component's declared default means deleting the attribute,
    // not writing the text "null" into it.
    if (request.value === null) {
      const removed = removePropAttribute(src, off, request.prop);
      return planned(entry.file, src, removed.code, {
        changed: removed.changed,
        dynamic: removed.dynamic,
      });
    }
    const result = writePropChange(src, off, request.prop, request.value, {
      addIfMissing: request.addIfMissing === true,
      allowShapeUpgrade: request.allowShapeUpgrade === true,
    });
    return planned(entry.file, src, result.code, {
      changed: result.changed,
      dynamic: result.dynamic,
    });
  }

  // kind === 'struct'
  const resolveCompanion = (id: unknown): number | null | 'cross-file' => {
    if (typeof id !== 'string') return null;
    const companion = resolveOid(id);
    if (!companion) return null;
    if (companion.file !== entry.file) return 'cross-file';
    return lineColToOffset(src, companion.line, companion.col);
  };
  const target = resolveCompanion(request.targetOid);
  const parent = resolveCompanion(request.parentOid);
  if (target === 'cross-file' || parent === 'cross-file') {
    return planned(entry.file, src, src, { changed: false, error: 'cannot move across files' });
  }
  // `reparent` is the ONE struct op with rules of its own (R1–R4): it is planned
  // whole — scope safety, destination legality, world-transform re-basing — before
  // any byte is written, and a refusal returns `src` unchanged with a named reason.
  if (request.op === 'reparent') {
    if (parent == null) {
      return planned(entry.file, src, src, {
        changed: false,
        error: 'the destination is not source-addressable.',
      });
    }
    const plan = planReparent(src, off, parent, {
      ...(request.rebase ? { rebase: request.rebase } : {}),
      ...(request.destinationInstances === undefined
        ? {}
        : { destinationInstances: request.destinationInstances }),
      ...(request.sourceInstances === undefined
        ? {}
        : { sourceInstances: request.sourceInstances }),
    });
    return planned(entry.file, src, plan.code, {
      changed: plan.changed,
      ...(plan.error ? { error: plan.error } : {}),
      ...(plan.warning ? { warning: plan.warning } : {}),
    });
  }

  let result: StructEditResult;
  switch (request.op) {
    case 'delete':
      result = deleteElement(src, off);
      break;
    case 'duplicate':
      result = duplicateElement(src, off, request.duplicate);
      break;
    case 'wrap':
      result = wrapElement(src, off, String(request.wrapperTag ?? 'div'));
      break;
    case 'unwrap':
      result = unwrapElement(src, off);
      break;
    case 'create':
      result = insertChildElement(
        src,
        off,
        String(request.wrapperTag ?? 'div'),
        typeof request.snippet === 'string' ? request.snippet : undefined,
      );
      break;
    case 'create-sibling':
      result = insertSiblingElement(
        src,
        off,
        typeof request.snippet === 'string' ? request.snippet : '',
      );
      break;
    case 'reorder':
      result = reorderChild(src, off, target, parent);
      break;
    default:
      return planned(entry.file, src, src, {
        changed: false,
        error: `unknown struct op: ${String(request.op)}`,
      });
  }
  // An inserted snippet whose tag is a COMPONENT is broken source until its
  // import exists, so the import rides the SAME plan — one file write, one
  // history transaction, never a half-applied insert. Skipped when the insert
  // itself refused (nothing to import for a snippet that never landed).
  const code =
    result.changed && request.ensureImport
      ? ensureValueImport(
          result.code,
          request.ensureImport.name,
          request.ensureImport.module,
          request.ensureImport.kind,
        ).code
      : result.code;
  return planned(entry.file, src, code, { changed: result.changed });
}
