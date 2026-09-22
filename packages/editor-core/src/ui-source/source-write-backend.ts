/**
 * SourceWriteBackend — the pending-write flush contract for JSX source edits (T3.2
 * slice 3, design).
 *
 * `UIAuthoringAdapter.persistence.save()` is the de-stub target for this seam. What
 * we found investigating the CURRENT write lifecycle (see `source-edit-panel.tsx`):
 * there is NO pending-write queue — every source edit (a style tweak, a struct op)
 * writes to disk IMMEDIATELY via a raw `fetch` call the instant the user commits it
 * (Enter / blur), server-side through the SAME surgical writer used in unit tests
 * (`ui-source/writer.ts`, invoked by `vite-plugin-ui-oid.ts`'s dev-server
 * middleware). So `save()` has nothing to flush; it is an honest no-op REGARDLESS of
 * whether a backend is wired (see `ui-authoring-adapter.ts`). This seam exists so:
 *   - the HTTP wire shape is reachable/testable through an injectable interface
 *     instead of a bare `fetch` scattered in the adapter, and
 *   - a future batching/offline queue (if one is ever built) has somewhere honest
 *     to route writes — this file does NOT invent that queue.
 *
 * A host with no `/__ui-source/*` route has NO implementation here, and that
 * absence is surfaced through
 * `persistence.destination`, NOT by flipping `capabilities.persist` to false —
 * see `ui-authoring-adapter.ts`'s doc comment for why that flag deliberately
 * stays `true`. We do NOT fake a save.
 *
 * Explicit non-goal (design §6): the vite plugin's raw `node:fs` writes are
 * server-side and stay exactly as they are — this seam is the CLIENT-facing
 * contract in front of them, not a reroute of their internals through
 * `StorageBackend`.
 *
 * `index()` (T6.2 slice 2) is the read-side sibling added for
 * `ReactRootAuthoringAdapter`'s node labeling (`component:tag`): it exposes the SAME
 * `/__ui-source/index` GET endpoint `vite-plugin-ui-oid.ts` already serves
 * (previously only fetched ad hoc by `source-edit-panel.tsx`) through this one
 * backend seam, rather than a second bespoke fetch call.
 */

import { sha256Hex } from '../bytes-codec';
import { assertEditorServerAnswered } from '../editor-server-response';
import { setCollaborationRevision, sourceMutationAttribution } from '../editor-session-attribution';
import { projectFiles } from '../files/project-files';
import { handleProjectMutationFailure } from '../source-conflict';
import type { ComponentPropSpec, OidEntry } from './oid-transform';
import type {
  PreparedSourceEdit,
  SourceEditRequest,
  StructReparentContext,
} from './source-edit-request';
import type { DuplicateRewrite } from './writer';

export type {
  PreparedSourceEdit,
  SourceEditRequest,
  StructReparentContext,
} from './source-edit-request';

/** The source-write operations (+ the OID index read) the dev-server middleware
 *  already exposes. */
export interface SourceWriteBackend {
  /** Stable identity for stateless backend instances sharing one source transport. */
  readonly historyIdentity?: object;
  /** True when every write is already committed through HistoryService. */
  readonly historyManaged?: boolean;
  /**
   * Runs a multi-write gesture (a boxEdit drag touching width+height, …) as one
   * failure-atomic history transaction. Only writes made through the scoped
   * backend belong to the gesture; unrelated writes on this backend serialize
   * outside it. Absent on a non-history-managed backend.
   */
  runGesture?<T>(
    label: string,
    operation: (scopedBackend: SourceWriteBackend) => Promise<T>,
  ): Promise<T>;
  /** Pure prepare: compute exact whole-file before/after without writing. */
  prepare?(request: SourceEditRequest): Promise<PreparedSourceEdit>;
  /**
   * Read one scope-checked source file for capture/preflight.
   *
   * `bytes` is present ONLY when the file is not text — an ingested game's
   * level data, say. When it is, history stores those bytes and `source` is
   * merely the wire form this backend chose; when it is absent, `source` IS the
   * file. History must never keep the wire form: `sha` is always the digest of
   * the FILE's bytes, so a snapshot holding base64 text would declare a sha
   * nothing could reproduce, and undo's "did the write land?" check would fail
   * on every binary file.
   */
  readSource?(
    file: string,
  ): Promise<{ source: string; sha: string; resourcePath: string; bytes?: Uint8Array }>;
  /** Guarded whole-file apply used by commit, undo, and redo. Bytes go through
   *  as bytes; the backend owns whatever the wire needs. */
  applySource?(
    file: string,
    source: string | Uint8Array,
    ifMatchSha: string,
  ): Promise<{ applied: boolean; sha?: string; error?: string }>;
  /** Surgical inline-style/className edit — the `/__ui-source/write` shape.
   *  `appended` (D-A1) is true only when the write took the writer's
   *  APPEND branch (no prior literal for this prop) — see
   *  `ReactRootAuthoringAdapter.writeStyle`'s append-aware undo (D-A4).
   *
   *  `value` accepts a NUMBER, and callers with a numeric descriptor MUST pass
   *  one: `String(300)` here writes `width: '300'`, which React passes through
   *  and the CSSOM rejects — source changes, the screen does not, and the ack
   *  still says `persisted: true`. See `authoring/css-numeric-style.ts`. */
  writeStyle(
    oid: string,
    prop: string,
    value: string | number,
  ): Promise<{
    changed: boolean;
    dynamic?: boolean;
    /** Present when the write was refused because the existing source value is
     *  a `var(--token)` reference; the string IS the reference. Distinct from
     *  `dynamic` because the refusal names a token, not an expression. */
    tokenRef?: string;
    route?: string;
    error?: string;
    appended?: boolean;
  }>;
  /**
   * D-A3: surgically REMOVE an appended inline-style property — the
   * correct undo for a write that took the append branch (`appended: true`).
   * Posts the SAME `/__ui-source/write` endpoint `writeStyle` uses, with the
   * `value: null` removal sentinel the middleware routes to `removeInlineStyle`.
   */
  removeStyle(
    oid: string,
    prop: string,
  ): Promise<{ changed: boolean; route?: string; error?: string }>;
  /** Surgical CSS-FILE edit (Cap 2) — the `/__ui-source/css` shape. The client resolves
   *  the target rule (source file + selector) from live matched-rule data and sends it;
   *  the server edits that file in place. `generated: true` means the selector was not
   *  found in source (generated CSS) — the caller re-routes to class/inline.
   *  Optional: only a dev-server-backed implementation serves it. */
  writeCss?(
    file: string,
    selector: string,
    prop: string,
    value: string,
    media?: string,
  ): Promise<{ changed: boolean; generated?: boolean; error?: string }>;
  /** Text-content edit (Cap 3) — the `/__ui-source/text` shape. Replaces a leaf element's
   *  pure-text body; `dynamic: true` means the body has an expression/children (refused).
   *  `prevText` is the editable text before the edit (for the undo inverse). Optional:
   *  only a dev-server-backed implementation serves it. */
  writeText?(
    oid: string,
    text: string,
  ): Promise<{ changed: boolean; dynamic?: boolean; prevText?: string | null; error?: string }>;
  /** Component prop / attribute edit (Cap 4) — the `/__ui-source/prop` shape. `oid` is the
   *  CALL-SITE oid (the `<Component …>` tag). `dynamic: true` ⇒ the prop is a non-literal
   *  expression (refused). Optional: only a dev-server-backed implementation serves it.
   *  `opts.addIfMissing` (W2 — opt-in, default off) appends the prop to the opening tag
   *  when it is absent instead of no-op'ing (the R3F gizmo path needs this for a mesh
   *  whose source never authored a transform tuple yet). `opts.allowShapeUpgrade` (R2 —
   *  opt-in, default off) permits a number-tuple literal to replace a plain number literal
   *  for the same prop (the `scale={1.5}` scalar shorthand upgraded by a non-uniform gizmo
   *  drag). */
  writeProp?(
    oid: string,
    prop: string,
    value: string,
    opts?: { addIfMissing?: boolean; allowShapeUpgrade?: boolean },
  ): Promise<{ changed: boolean; dynamic?: boolean; error?: string }>;
  /**
   * REMOVE a whole prop attribute — the inverse of `writeProp`'s `addIfMissing`
   * append, and what the inspector's revert-to-default does: with no attribute,
   * the value in force is the one the component's own signature declares.
   * Wire shape is `/__ui-source/prop` with `value: null`, matching the
   * `removeStyle` sentinel (D-A3). A source no-op when the attribute is absent,
   * and refused (`dynamic: true`) when it is expression-bound.
   */
  removeProp?(
    oid: string,
    prop: string,
  ): Promise<{ changed: boolean; dynamic?: boolean; error?: string }>;
  /** Apply a literal instance value to its component's native declaration. */
  writeComponentDefault?(
    definitionOid: string,
    prop: string,
    value: string,
  ): Promise<{ changed: boolean; dynamic?: boolean; error?: string }>;
  /**
   * Structural source edit — the `/__ui-source/struct` shape. Ops: `delete`, `duplicate`,
   * `wrap`/`unwrap`, `create`, `create-sibling`, `reorder`, `reparent` (Cap 5). Multi-oid
   * ops pass the companion oid(s) + optional `wrapperTag` via `opts`.
   *
   * D-1 (spec27 §2): when `changed`, the server ALSO returns the whole
   * touched file's `prevSource`/`newSource` (before/after this op) plus their
   * `prevSha`/`newSha` (sha256, server-computed) — the checksum-guarded
   * whole-file snapshot inverse `ReactRootAuthoringAdapter.structOp` needs to
   * push ONE undo/redo entry per structural op (a per-OID inverse is unsound
   * here: OIDs are `file:component:tag:nthOccurrence` content signatures,
   * reorder/delete reassign occurrence indices, and delete has no inverse
   * payload of its own). These fields are absent when `changed` is false, and
   * on an implementation that predates D-1 (a bare `{changed}` mock) — either
   * way the caller degrades to "not undoable" rather than crashing.
   */
  writeStruct(
    oid: string,
    op: string,
    opts?: {
      targetOid?: string;
      parentOid?: string;
      wrapperTag?: string;
      snippet?: string;
      ensureImport?: { name: string; module: string; kind?: 'default' | 'named' };
      duplicate?: DuplicateRewrite;
    } & StructReparentContext,
  ): Promise<{
    changed: boolean;
    error?: string;
    /** Applied, but with something the author should know — a `reparent` that took the
     *  element out of a definition rendered more than once (R3's mirrored case). */
    warning?: string;
    file?: string;
    prevSource?: string;
    newSource?: string;
    prevSha?: string;
    newSha?: string;
  }>;
  /**
   * Batched structural source edit. `delete` is the delete-order-residual fix;
   * `group` resolves sibling elements from the same source snapshot and wraps
   * them beneath one ordinary R3F group. Both produce one history transaction.
   *
   * Delete details — bug-panel follow-up to
   * the multi-delete corruption fix, 50f90a6d), the `/__ui-source/struct-many`
   * shape. Unlike N separate
   * `writeStruct(oid, 'delete')` calls, the server resolves every `oids` entry's
   * offset against ONE shared file snapshot and applies them all in a single write
   * — sound and CALLER-ORDER-INDEPENDENT (see `handleStructMany`'s doc comment,
   * `vite-plugin-ui-oid.ts`): the caller does not need to sort `oids` into any
   * particular order, source or otherwise. Same response shape as `writeStruct`
   * (one `prevSource`/`newSource`/`prevSha`/`newSha` snapshot for the whole batch
   * — one undo entry, not N). Optional: only a dev-server-backed implementation
   * serves it; its absence is how `ReactRootAuthoringAdapter` honestly degrades
   * `structure.removeMany` to absent (the shell then falls back to
   * `deleteSelection`'s per-id loop, unchanged).
   */
  writeStructMany?(
    oids: readonly string[],
    op: string,
    opts?: { wrapperTag?: string },
  ): Promise<{
    changed: boolean;
    error?: string;
    file?: string;
    prevSource?: string;
    newSource?: string;
    prevSha?: string;
    newSha?: string;
  }>;
  /** The whole OID → source-location index — the `/__ui-source/index` shape.
   *  Optional: only a dev-server-backed implementation can serve it. */
  index?(): Promise<Record<string, OidEntry>>;
  /**
   * The props a component DECLARES, read from its definition file — the door a
   * drop uses before the element exists anywhere (`index()` only carries the
   * specs of tags already used). `file` is project-relative; `component` names
   * the declared function and how the module exports it. Empty when the
   * definition cannot be read — never a guess. Optional: a backend without a
   * resolver drops with no declared defaults, as before.
   */
  componentProps?(
    file: string,
    component: { name: string; exportKind: 'default' | 'named' },
  ): Promise<ComponentPropSpec[]>;
  /**
   * H7 "Fork Component…" — the `/__ui-source/fork-component` shape.
   *
   * The ONLY seam on this backend that CREATES a file, which is exactly why it
   * is a server capability rather than a client composition of the existing
   * ones: `readSource`/`applySource` are checksum-guarded against a file that
   * already exists, and nothing here can bring a new path into being.
   *
   * The server copies the component's module to a renamed sibling and returns
   * the CALLSITE edit unwritten (`callsitePrevSource`/`callsiteNewSource`), so
   * the caller can push that half through project history — the new file stays
   * outside history deliberately, and an undo therefore restores the callsite
   * and leaves the copy behind as an inert module nothing imports.
   *
   * Optional: only a dev-server-backed implementation serves it; its absence is
   * how a hosted/read-only session honestly reports that forking is off.
   */
  forkComponent?(
    oid: string,
    definitionOid: string,
    name?: string,
  ): Promise<{
    ok: boolean;
    error?: string;
    newName?: string;
    tag?: string;
    newFile?: string;
    newResourcePath?: string;
    importSpecifier?: string;
    label?: string;
    callsiteFile?: string;
    callsiteResourcePath?: string;
    callsitePrevSource?: string;
    callsiteNewSource?: string;
    callsitePrevSha?: string;
    callsiteNewSha?: string;
  }>;
  /**
   * P1 "Extract Component…" — the `/__ui-source/extract-component` shape, and
   * the fork seam's sibling (the fork's doc above records why file creation is
   * a server capability at all). The server writes TWO new files — the
   * component module and its portable CSF story under `src/prefabs/` — and
   * returns the CALLSITE edit unwritten, so the caller pushes that half
   * through project history: undo restores the callsite and leaves the new
   * files as an inert module + story nothing imports. Optional: only a
   * dev-server-backed implementation serves it.
   */
  extractComponent?(
    oid: string,
    name?: string,
  ): Promise<{
    ok: boolean;
    error?: string;
    newName?: string;
    tag?: string;
    componentFile?: string;
    componentResourcePath?: string;
    storyFile?: string;
    storyResourcePath?: string;
    importSpecifier?: string;
    label?: string;
    callsiteFile?: string;
    callsiteResourcePath?: string;
    callsitePrevSource?: string;
    callsiteNewSource?: string;
    callsitePrevSha?: string;
    callsiteNewSha?: string;
  }>;
}

/**
 * Adopt the revision a write just produced.
 *
 * The collaboration guard rejects a mutation whose `expectedRevision` is older
 * than the target file's, and the SSE stream that teaches the client its
 * revision lands one event loop late — so the SECOND write of a multi-write
 * gesture used to be refused by its own first write (measured on a canvas
 * transform drag, whose `position` channel is `x` + `y`). The server now
 * reports the revision it recorded on the response this call already awaits;
 * taking it here is what makes a sequential write sequence legal.
 * `setCollaborationRevision` only ever moves forward, so a stale or absent
 * value is harmless.
 */
function adoptResponseRevision(value: unknown): void {
  if (value && typeof value === 'object' && 'revision' in value) {
    const revision = (value as { revision?: unknown }).revision;
    if (typeof revision === 'number') setCollaborationRevision(revision);
  }
}

/**
 * Create a NEW project source file through the dev server's
 * `/__ui-source/create-file` route (the pasteboard materialize action's
 * door). Kept here so the collaboration attribution/revision envelope every
 * source mutation carries is attached in exactly one place ({@link postJson}).
 * The server refuses an existing file — creation never overwrites.
 */
export async function createProjectSourceFile(
  file: string,
  source: string,
): Promise<{ created: boolean; error?: string }> {
  return postJson('/__ui-source/create-file', { file, source });
}

/** The CSF story write door (`/__ui-source/csf-story`) — save an arg set as
 *  a new story export, rename one, delete one. Kept beside
 *  {@link createProjectSourceFile} so the collaboration envelope stays
 *  attached in one place; the planner's refusals arrive as `error`. */
export async function writeCsfStory(request: {
  op: 'save' | 'rename' | 'delete';
  file: string;
  name: string;
  newName?: string;
  args?: Record<string, unknown>;
}): Promise<{ changed: boolean; summary?: string; error?: string }> {
  return postJson('/__ui-source/csf-story', request);
}

/** The named-style write door (`/__ui-source/named-style`) — mint a CSS class
 *  from the element's literal inline styles (`create`, with `file` naming the
 *  target first-party stylesheet), or add/remove the bare class token
 *  (`apply`/`remove`). Collaboration envelope attached by `postJson`. */
export async function writeNamedStyle(request: {
  op: 'create' | 'apply' | 'remove';
  oid: string;
  className: string;
  file?: string;
}): Promise<{ changed: boolean; moved?: string[]; summary?: string; error?: string }> {
  return postJson('/__ui-source/named-style', request);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const attribution = sourceMutationAttribution();
  const attributedBody =
    body && typeof body === 'object' && !Array.isArray(body)
      ? {
          ...body,
          ...attribution,
        }
      : body;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(attributedBody),
  });
  if (res.ok === false && res.status === 409) {
    const record =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const file = typeof record['file'] === 'string' ? record['file'] : null;
    const attempted =
      file && typeof record['source'] === 'string' ? { [file]: record['source'] } : {};
    await handleProjectMutationFailure(res, {
      label: `Source mutation ${url}`,
      attempted,
      reapply: () => postJson(url, body).then(() => undefined),
    });
  }
  const parsed = await readJsonResponse<T>(res, url);
  adoptResponseRevision(parsed);
  return parsed;
}

/**
 * The ONE place every `/__ui-source/*` answer is read. That prefix is served by
 * the same dev server as `/__editor/*` (`vite-plugin-ui-oid.ts`), on the same
 * origin, behind the same page fallback — so the fallback check is the same
 * check, run BEFORE the parse. Without it a source write against an origin with
 * no recorder died as `Unexpected token '<'` at the author's next keystroke.
 * Non-OK statuses keep their own `{ error }` handling below.
 */
async function readJsonResponse<T>(res: Response, url: string): Promise<T> {
  assertEditorServerAnswered(res, `Source request ${url} failed`);
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (error) {
    if (res.ok !== false) throw error;
    throw new Error(`Source request ${url} failed with HTTP ${res.status}.`, { cause: error });
  }
  if (res.ok === false) {
    const detail =
      payload && typeof payload === 'object'
        ? String(
            (payload as { error?: unknown; message?: unknown }).error ??
              (payload as { message?: unknown }).message ??
              res.statusText,
          )
        : res.statusText;
    throw new Error(
      `Source request ${url} failed with HTTP ${res.status}${detail ? `: ${detail}` : ''}.`,
    );
  }
  return payload as T;
}

/**
 * WHERE EVERY WHOLE-FILE SOURCE WRITE LANDS, and why the frame changes it.
 *
 * `applySource` is the write end of the entire native authoring lane: a gizmo
 * drag is `prepare` → `HistoryService.transaction` → `applySource`, and its
 * UNDO and REDO are the same call with the inverse snapshot
 * (`history/source-history-backend.ts`). Under the Code-OSS frame that write
 * must be the WORKBENCH's, not the session's — U4 measured what happens
 * otherwise: `/__ui-source/apply` writes the file behind the workbench's back,
 * Monaco sees an external change, reloads, `modelService.updateModel` pushes a
 * fresh text element, and `pushElement` destroys the redo future. ⇧⌘Z then
 * brought nothing back while a text model for that file was open.
 *
 * So under the frame the apply goes through `projectFiles`, which is
 * `IFileService`/`ITextFileService` over the workspace folder: the open model
 * is updated in place and saved, no reload fires, and the redo future
 * survives. Standalone `vgai edit` is untouched — `frameOwned()` is false and
 * every call is the same POST it always was.
 *
 * THE GUARD SURVIVES THE MOVE. `/__ui-source/apply`'s `ifMatchSha` is real
 * conflict protection (a hand-edit since the entry was recorded), so the
 * frame path re-reads the file through the same door and compares before it
 * writes, and answers the same `{applied:false, sha}` shape on a mismatch.
 *
 * THE PROJECT-RELATIVE PATH comes from the memo below, because `applySource`
 * is handed the SERVER's file identity (`prepared.file`) and the frame needs
 * the path the workspace folder resolves — `resourcePath`. Every apply in
 * every lane is preceded by a `prepare` or a `readSource`, and both answer
 * with both spellings, so the memo is populated by the time it is read; a miss
 * falls back to one `/__ui-source/read`.
 */
const resourcePathByFile = new Map<string, string>();

function rememberResourcePath(
  answer: { file?: string; resourcePath?: string },
  file?: string,
): void {
  const key = answer.file ?? file;
  if (key && answer.resourcePath) resourcePathByFile.set(key, answer.resourcePath);
}

async function frameResourcePath(file: string): Promise<string> {
  const known = resourcePathByFile.get(file);
  if (known) return known;
  const read = await postJson<{ resourcePath: string }>('/__ui-source/read', { file });
  resourcePathByFile.set(file, read.resourcePath);
  return read.resourcePath;
}

async function frameApplySource(
  file: string,
  source: string | Uint8Array,
  ifMatchSha: string,
): Promise<{ applied: boolean; sha?: string; error?: string }> {
  const path = await frameResourcePath(file);
  const isText = typeof source === 'string';
  let currentSha: string;
  try {
    currentSha = isText
      ? await sha256Hex(new TextEncoder().encode(await projectFiles.read(path)))
      : await sha256Hex(await projectFiles.readBytes(path));
  } catch (error) {
    return {
      applied: false,
      error: `Could not read "${path}" to guard the write: ${String(error)}`,
    };
  }
  if (currentSha !== ifMatchSha) {
    return {
      applied: false,
      sha: currentSha,
      error: 'stale: the file changed since this undo/redo entry was recorded',
    };
  }
  await projectFiles.write(path, source);
  const sha = isText ? await sha256Hex(new TextEncoder().encode(source)) : await sha256Hex(source);
  return { applied: true, sha };
}

/** Wraps the EXISTING `/__ui-source/write` + `/__ui-source/struct` dev-server
 *  endpoints (see `vite-plugin-ui-oid.ts`) — the dev-server-backed tier. */
export function createHttpSourceWriteBackend(): SourceWriteBackend {
  return {
    historyIdentity: HTTP_SOURCE_HISTORY_IDENTITY,
    prepare: async (request) => {
      const prepared = await postJson<PreparedSourceEdit>('/__ui-source/prepare', request);
      rememberResourcePath(prepared);
      return prepared;
    },
    readSource: async (file) => {
      const read = await postJson<{
        source: string;
        sha: string;
        resourcePath: string;
        bytes?: Uint8Array;
      }>('/__ui-source/read', { file });
      rememberResourcePath(read, file);
      return read;
    },
    applySource: (file, source, ifMatchSha) =>
      projectFiles.frameOwned()
        ? frameApplySource(file, source, ifMatchSha)
        : postJson('/__ui-source/apply', { file, source, ifMatchSha }),
    writeStyle: (oid, prop, value) => postJson('/__ui-source/write', { oid, prop, value }),
    // D-A3: the removal sentinel — same endpoint, `value: null`.
    removeStyle: (oid, prop) => postJson('/__ui-source/write', { oid, prop, value: null }),
    writeCss: (file, selector, prop, value, media) =>
      postJson('/__ui-source/css', {
        file,
        selector,
        prop,
        value,
        ...(media !== undefined ? { media } : {}),
      }),
    writeText: (oid, text) => postJson('/__ui-source/text', { oid, text }),
    writeProp: (oid, prop, value, opts) =>
      postJson('/__ui-source/prop', {
        oid,
        prop,
        value,
        ...(opts?.addIfMissing ? { addIfMissing: true } : {}),
        ...(opts?.allowShapeUpgrade ? { allowShapeUpgrade: true } : {}),
      }),
    removeProp: (oid, prop) => postJson('/__ui-source/prop', { oid, prop, value: null }),
    writeStruct: (oid, op, opts) => postJson('/__ui-source/struct', { oid, op, ...opts }),
    writeStructMany: (oids, op, opts) =>
      postJson('/__ui-source/struct-many', { oids, op, ...opts }),
    forkComponent: (oid, definitionOid, name) =>
      postJson('/__ui-source/fork-component', {
        oid,
        definitionOid,
        ...(name ? { name } : {}),
      }),
    extractComponent: (oid, name) =>
      postJson('/__ui-source/extract-component', { oid, ...(name ? { name } : {}) }),
    index: async () => {
      const res = await fetch('/__ui-source/index');
      return readJsonResponse<Record<string, OidEntry>>(res, '/__ui-source/index');
    },
    componentProps: async (file, component) => {
      const url =
        '/__ui-source/component-props' +
        `?file=${encodeURIComponent(file)}&name=${encodeURIComponent(component.name)}`;
      const res = await fetch(url);
      const payload = await readJsonResponse<{ props?: ComponentPropSpec[] }>(
        res,
        '/__ui-source/component-props',
      );
      return payload.props ?? [];
    },
  };
}

const HTTP_SOURCE_HISTORY_IDENTITY = {};
