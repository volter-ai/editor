/**
 * The wire vocabulary of the EDITOR-SURFACE probe — the scoped editor-chrome
 * door (`packages/editor/src/editor-document-probe.ts` implements it,
 * `@vgai/live`'s `editor.document` binds it, and that module's header carries
 * the design decision and the scope contract).
 *
 * Deliberately NOT a page-automation vocabulary: there is no navigation, no
 * waiting, no frame/window addressing, and no selector rooted anywhere but one
 * of the NAMED surfaces in {@link DocumentProbeScope}. Eight actions, each one
 * a gesture or a read an agent cannot otherwise perform through the product.
 */

/**
 * WHICH NAMED SURFACE a step runs against — the whole addressing vocabulary of
 * this door, and the reason it is a vocabulary rather than a free selector.
 *
 * Every name here resolves to ONE live element the person is looking at, found
 * by a stamp that surface's own owner wrote (`data-vgai-part` on the element
 * the workbench handed over for a registered view; the document surface's own
 * `data-testid`), never by walking the page for a class that looks right. A
 * name whose surface is not on screen is REFUSED by name — an agent learns the
 * Properties view is closed instead of reading an empty match list.
 *
 *  - `document` — the ACTIVE centre document's whole box: its content, its
 *    header strip and its shelf rail. The default, and what this door meant
 *    before there were names.
 *  - `header` / `shelf` — the active document's toolbar strip and its tool
 *    rail, each on its own. Both are INSIDE `document`; they exist as names so
 *    a selector that also matches in the content (`button`, `[role=tab]`) can
 *    be aimed without an index.
 *  - `rail` — the Properties view (`vgai.properties`): its vertical tab rail,
 *    the active tab's sections and their fields.
 *  - `outliner` — the Outliner view (`vgai.outliner`): its rows, their
 *    expand/eye/camera controls, and its header.
 *  - `content` — the Content view (`vgai.content`): its categories and asset
 *    rows.
 *
 * `rail`, `outliner`, and `content` are EDITOR CHROME and do not belong to the active
 * document, so they stay reachable while the Game document is active — the
 * Game refusal is about driving a game through synthetic gestures, and reading
 * the panel that reports its selection is not that.
 */
export type DocumentProbeScope = 'document' | 'header' | 'shelf' | 'rail' | 'outliner' | 'content';

/** One element as the probe reports it — everything a caller needs to assert
 *  on, and nothing that requires a second round trip. */
export interface ProbedElement {
  /** Position within the match list this element came from. */
  index: number;
  tag: string;
  /** `innerText`, trimmed and capped. */
  text: string;
  attributes: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  /** Present for form controls. */
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  /** Resolved style, present only for the names {@link DocumentQueryStep.styles}
   *  asked for. A standard property carries the browser's own resolved value
   *  (`backgroundColor` → `rgb(52, 52, 52)`); a custom property carries what it
   *  PAINTS when it resolves as a colour, and its declared text otherwise. */
  styles?: Record<string, string>;
}

export interface DocumentProbeResult {
  /** The surface the step ran against — echoed so a transcript proves WHICH
   *  one was read or driven, not merely that something was. `name` is the
   *  vocabulary word; `id`/`title` are that surface's own identity (a
   *  document's id and title, or the registered view's). */
  scope: { name: DocumentProbeScope; id: string; title: string };
  /** Total matches inside the scope, before any `limit`. */
  matched: number;
  elements: ProbedElement[];
}

/** Which named surface a step runs against; `document` when omitted. */
interface ScopedStep {
  scope?: DocumentProbeScope;
}

/** Read what a surface rendered. */
export interface DocumentQueryStep extends ScopedStep {
  action: 'query';
  selector: string;
  /** Cap on returned elements (default 25); `matched` still reports the total. */
  limit?: number;
  /**
   * Style property names to resolve on each match — standard
   * (`backgroundColor`, `borderInlineStartWidth`) or custom (`--vgai-…`).
   *
   * Ask for the STANDARD property to learn what a surface PAINTS: a theme
   * token is an expression (`color-mix(…)`), and the element that uses it is
   * where the browser turns that expression into a colour. A custom property
   * is resolved here too, through a real paint property, so a token answers
   * with the rgb it would paint rather than its own algebra — which is the
   * only way a `:hover` colour can be measured at all, `:hover` being a
   * browser state no synthetic event can enter. An UNDECLARED custom
   * property answers `""`, so "does this palette declare this group" is a
   * question this door can be trusted with.
   *
   * The value is the browser's, in the browser's own spelling: a token built
   * by `color-mix()` answers as `color(srgb …)` with float channels, a plain
   * one as `rgb(…)`. Both are the paint; multiply a float by 255 to compare
   * against a reference frame's 8-bit levels.
   */
  styles?: string[];
}

/** A real pointer gesture on one matched element. */
export interface DocumentClickStep extends ScopedStep {
  action: 'click';
  selector: string;
  /** Which match (default 0). */
  index?: number;
  /**
   * Clicks in the gesture (default 1). `2` is a REAL double click: the second
   * press carries `detail: 2` and is followed by a `dblclick`, which is the
   * only event `onDoubleClick` listens for.
   *
   * It is on `click` rather than a verb of its own because it is the same
   * gesture with the same target — and it is here at all because a double
   * click is the OUTLINER'S OWN rename gesture (`GameHierarchy.tsx`'s
   * `onDoubleClick` → `onStartEditing`), so without it a rename could only be
   * driven through `editor.setField`, which is not the control.
   */
  clicks?: number;
}

/**
 * TYPE into a focused field, character by character, and commit with Enter the
 * way a person does.
 *
 * `paste` cannot stand in for this: an untrusted `ClipboardEvent` performs no
 * default action, so a plain `<input>` with no paste handler keeps its old
 * value. And a direct `element.value = x` is invisible to React, which caches
 * the last value it wrote on the node — the same trap `select` documents. So
 * each character goes through the prototype's own value setter (leaving
 * React's tracker stale, which is what makes the following `input` read as a
 * real edit), between a real `keydown`/`keyup` for that character, so a field
 * that commits on a KEY rather than on `input` sees the keys too.
 */
export interface DocumentTypeStep extends ScopedStep {
  action: 'type';
  text: string;
  /** The field; omitted means whatever inside the scope has focus. */
  selector?: string;
  index?: number;
  /** Replace what the field holds first, the way a person selects-all and
   *  types over it (default true). `false` appends at the end. */
  replace?: boolean;
  /** Press Enter after the text (default true) — the commit gesture for the
   *  Outliner's rename field and every numeric field in the Properties rail. */
  enter?: boolean;
}

/**
 * A real pointer DRAG across one matched element: `pointerdown` at `from`,
 * `steps` `pointermove`s along the way, `pointerup` at `to` — the sequence a
 * mouse produces, so a canvas that begins a gesture on press and previews on
 * move (an Asset Lab document's direct manipulation) sees the whole gesture.
 * `from`/`to` are FRACTIONS of the element's box (`[0.5, 0.5]` is its
 * center), so a caller reasons in the element's own space, not the screen's.
 * A zero-length drag is a click at that fraction.
 */
export interface DocumentDragStep extends ScopedStep {
  action: 'drag';
  selector: string;
  /** Which match (default 0). */
  index?: number;
  from: [number, number];
  to: [number, number];
  /** Waypoints the pointer passes through between `from` and `to`, in
   *  order — what a lasso or a knife stroke needs, since a straight drag
   *  encloses nothing. Each leg gets `steps` moves. */
  via?: [number, number][];
  /** Intermediate `pointermove`s between consecutive points (default 8). */
  steps?: number;
  /** Modifier keys held for the whole gesture (a Shift-extend, an Alt-click). */
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/** A real key on the explicit target, else whatever inside the document has focus. */
export interface DocumentKeyStep extends ScopedStep {
  action: 'key';
  key: string;
  code?: string;
  selector?: string;
  index?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** A real `ClipboardEvent` carrying `text/plain` — the only way to exercise a
 *  paste handler, and the gesture the Sheets build could not verify. */
export interface DocumentPasteStep extends ScopedStep {
  action: 'paste';
  text: string;
  selector?: string;
  index?: number;
}

/**
 * Choose a value on a `<select>` — the gesture `click` cannot make.
 *
 * A native dropdown's option list is rendered by the OS, not by the DOM, so
 * there is nothing inside the document's container for a pointer gesture to
 * resolve against: `click` on the `<select>` opens a menu no synthetic event
 * can reach. Assigning `element.value` is equally useless on a React
 * controlled component — React caches the last value it wrote on the node, so
 * a direct write is not seen as a change and the next render puts the old
 * value straight back. The implementation goes through the prototype's own
 * value setter and then dispatches `input`/`change`, which is the ONE spelling
 * React's synthetic-event layer honours.
 */
export interface DocumentSelectStep extends ScopedStep {
  action: 'select';
  selector: string;
  /** The option's `value` (not its label). */
  value: string;
  /** Which match (default 0). */
  index?: number;
}

export type DocumentProbeStep =
  | DocumentQueryStep
  | DocumentClickStep
  | DocumentDragStep
  | DocumentKeyStep
  | DocumentPasteStep
  | DocumentSelectStep
  | DocumentTypeStep;
