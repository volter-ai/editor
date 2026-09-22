/**
 * `editor.document` — the session binding for the scoped editor-chrome door.
 *
 * WHY IT IS A SEPARATE OBJECT, and why the verbs are these, is recorded once
 * in the implementation's header
 * (`packages/editor/src/editor-document-probe.ts`); the short version is that
 * `game.page()` is play-mode-gated and rooted at the GAME container, so an
 * editor surface that is not a running game could be neither read nor driven
 * through the product.
 *
 * WHAT IT ADDRESSES is a closed VOCABULARY of named surfaces, passed as
 * `{ scope }` on every verb:
 *
 *   `document` (default) the active centre document's whole box
 *   `header` / `shelf`   that document's toolbar strip / tool rail
 *   `rail`               the PROPERTIES view — its tabs, sections and fields
 *   `outliner`           the OUTLINER view — its rows and their controls
 *   `content`            the CONTENT view — its categories and asset rows
 *
 *   await editor.document.query('[role=tab]', { scope: 'rail' });
 *   await editor.document.click('[data-testid=properties-tab-modifiers]', { scope: 'rail' });
 *   await editor.document.click('[data-ingest-name=Cube]', { scope: 'outliner', clicks: 2 });
 *   await editor.document.type('Wheel', { scope: 'outliner' });
 *
 * It is not page automation: a selector resolving outside the named surface is
 * refused by a message naming the scope and listing the others. `rail` and
 * `outliner`, and `content` are editor chrome and stay readable while the Game document is
 * active; `editor.hierarchy()` / `editor.inspect()` keep answering what those
 * panels RESOLVED, where this door answers what they DREW.
 *
 * A field on `LiveEditor` rather than methods on it, so `vgai eval --list`
 * shows the verbs as one named surface — the same reason `game.input`
 * and `game.events` are instance fields.
 */

import type {
  DocumentProbeResult,
  DocumentProbeScope,
  DocumentProbeStep,
  EditorClient,
} from '@volter/editor-sdk';

/** Which named surface a verb runs against; `document` when omitted. */
export interface DocumentScopeOption {
  scope?: DocumentProbeScope;
}

/** Modifier/targeting options shared by the gesture verbs. */
export interface DocumentGestureOptions extends DocumentScopeOption {
  /** Which match to drive when the selector matches several (default 0). */
  index?: number;
}

export interface DocumentKeyOptions extends DocumentGestureOptions {
  /** Target one element instead of whatever inside the scope has focus. */
  selector?: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface DocumentPasteOptions extends DocumentGestureOptions {
  selector?: string;
}

export interface DocumentTypeOptions extends DocumentGestureOptions {
  /** The field; omitted types into whatever inside the scope has focus. */
  selector?: string;
  /** Replace what the field holds first (default true). */
  replace?: boolean;
  /** Press Enter after the text (default true). */
  enter?: boolean;
}

export class LiveEditorDocument {
  readonly #client: EditorClient;

  constructor(client: EditorClient) {
    this.#client = client;
  }

  /**
   * Read matching elements inside the active document: tag, text, attributes,
   * value/checked/disabled and rect. `matched` is the total before `limit`.
   *
   * `styles` additionally resolves named properties per match — and resolving
   * is the point, because a theme token is an expression until an element
   * paints it. Ask for the standard property to learn the colour a person
   * sees; ask for a `--vgai-…` custom property to learn what a rule WOULD
   * paint, which is the only way to measure a `:hover` colour (`:hover` is a
   * browser state no synthetic event can enter, so there is deliberately no
   * hover verb on this door).
   *
   *   await editor.document.query('.vgai-tree-row', {
   *     styles: ['backgroundColor', '--vgai-widget-regular-hover'],
   *   });
   */
  async query(
    selector: string,
    options?: DocumentScopeOption & { limit?: number; styles?: readonly string[] },
  ): Promise<DocumentProbeResult> {
    return this.#probe({
      action: 'query',
      selector,
      ...(options?.scope === undefined ? {} : { scope: options.scope }),
      ...(options?.limit === undefined ? {} : { limit: options.limit }),
      ...(options?.styles === undefined ? {} : { styles: [...options.styles] }),
    });
  }

  /** A REAL pointer gesture (pointerdown/mousedown/focus/pointerup/mouseup/click)
   *  — not `element.click()`, which a `pointerdown` listener never sees. */
  async click(
    selector: string,
    options?: DocumentGestureOptions & { clicks?: number },
  ): Promise<DocumentProbeResult> {
    return this.#probe({
      action: 'click',
      selector,
      ...(options?.scope === undefined ? {} : { scope: options.scope }),
      ...(options?.index === undefined ? {} : { index: options.index }),
      ...(options?.clicks === undefined ? {} : { clicks: options.clicks }),
    });
  }

  /**
   * TYPE into a field and commit with Enter, the way a person does — one
   * character at a time through the prototype's value setter, between real
   * `keydown`/`keyup`.
   *
   * `paste` is not a substitute: an untrusted `ClipboardEvent` performs no
   * default action, so a plain `<input>` with no paste handler keeps its old
   * value. Omit `selector` to type into whatever inside the scope has focus —
   * which is what a rename field is, one gesture after
   * `click(row, { clicks: 2 })`.
   */
  async type(text: string, options?: DocumentTypeOptions): Promise<DocumentProbeResult> {
    return this.#probe({ action: 'type', text, ...(options ?? {}) });
  }

  /**
   * A real pointer DRAG across one matched element — press at `from`, move,
   * release at `to`. The gesture a direct-manipulation canvas needs; a
   * zero-length drag is a click at that fraction, which `click` (always the
   * center) cannot place.
   *
   * `from`, `to` and every point in `via` are `[x, y]` FRACTIONS OF THE
   * MATCHED ELEMENT'S BOX, 0..1 from its top-left — NEVER pixels and never
   * page coordinates. `[0.5, 0.5]` is its center, `[1, 0]` its top-right.
   * Compute a pixel target by measuring the element first: `query` answers
   * its `rect`, and `(px - rect.x) / rect.width` is the fraction to pass.
   */
  async drag(
    selector: string,
    options: DocumentGestureOptions & {
      from: [number, number];
      to: [number, number];
      via?: [number, number][];
      steps?: number;
      altKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
      shiftKey?: boolean;
    },
  ): Promise<DocumentProbeResult> {
    return this.#probe({
      action: 'drag',
      selector,
      ...(options.scope === undefined ? {} : { scope: options.scope }),
      from: options.from,
      to: options.to,
      ...(options.via === undefined ? {} : { via: options.via }),
      ...(options.steps === undefined ? {} : { steps: options.steps }),
      ...(options.index === undefined ? {} : { index: options.index }),
      ...(options.altKey === undefined ? {} : { altKey: options.altKey }),
      ...(options.ctrlKey === undefined ? {} : { ctrlKey: options.ctrlKey }),
      ...(options.metaKey === undefined ? {} : { metaKey: options.metaKey }),
      ...(options.shiftKey === undefined ? {} : { shiftKey: options.shiftKey }),
    });
  }

  /** A real keydown/keyup on the target, or on whatever inside the document has focus. */
  async key(key: string, options?: DocumentKeyOptions): Promise<DocumentProbeResult> {
    return this.#probe({ action: 'key', key, ...(options ?? {}) });
  }

  /** A real `ClipboardEvent` carrying `text/plain` — the gesture nothing else
   *  in the product can produce. */
  async paste(text: string, options?: DocumentPasteOptions): Promise<DocumentProbeResult> {
    return this.#probe({ action: 'paste', text, ...(options ?? {}) });
  }

  /**
   * Choose `value` on a `<select>` — a native dropdown's options are drawn by
   * the OS, so `click` has nothing in the document to resolve, and a plain
   * `element.value =` is invisible to React. Set through the prototype's own
   * value setter plus `input`/`change`; `value` is the option's `value`, not
   * its label. An unknown value is refused with the options it does offer.
   */
  async select(
    selector: string,
    value: string,
    options?: DocumentGestureOptions,
  ): Promise<DocumentProbeResult> {
    return this.#probe({
      action: 'select',
      selector,
      value,
      ...(options?.scope === undefined ? {} : { scope: options.scope }),
      ...(options?.index === undefined ? {} : { index: options.index }),
    });
  }

  /**
   * THE REPL over the open document: run `step` in the editor page against the
   * object the ACTIVE document published as its context (the mesh document
   * publishes its `MeshEditSession`, whose `ctx` is the bpy-shaped edit
   * context — `ctx.ops.mesh.bevel({ offset: 0.1 })`, `ctx.selection`,
   * `ctx.history`, `session.commit()`). Edit mode, no play. Serialized like
   * `game.page`: the step's own source travels, so inline every value it
   * needs and return plain data.
   */
  async run<T = unknown>(
    step: (ctx: unknown, info: { documentId: string }) => T | Promise<T>,
  ): Promise<T> {
    return this.#client.documentScript<T>(step.toString());
  }

  #probe(step: DocumentProbeStep): Promise<DocumentProbeResult> {
    return this.#client.documentProbe(step);
  }
}
