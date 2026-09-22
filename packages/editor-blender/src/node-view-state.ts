/**
 * THE NODE VIEW'S OWN STATE, and the reason it is a module rather than a
 * `useState` inside the component.
 *
 * `editor.document.*` is scoped to the ACTIVE CENTER DOCUMENT by design — its
 * own header says so: "a selector resolving outside that document's container
 * is refused by a message naming the scope". The node editor is a DRAWER
 * utility, so nothing in the product could read or drive it: the sighted door
 * (`editor.captureEditorChrome`, `vgai screenshot editor`) photographs it, and
 * a photograph cannot click.
 *
 * So the view's actions are SESSION VERBS, which is the pattern the keyboard
 * ruling already asks for — a `vgai.*` command per action rather than a raw
 * listener — and this module is the one place their state lives. The component
 * subscribes to it; `blender-node-view` (the command) reads and writes it. One
 * store, two readers, no second copy.
 *
 * It imports NOTHING: the host handler and the contribution both reach it, and
 * a store either of them could not import would not be one store.
 */

export interface NodeViewTransform {
  /** The tree-space point at the view's centre. */
  readonly cx: number;
  readonly cy: number;
  /** Tree units per CSS pixel. Blender's node editor draws without DPI
   *  (`node_intern.hh:332`), so zoom 1 is one tree unit per pixel. */
  readonly zoom: number;
}

export interface NodeViewState {
  readonly transform: NodeViewTransform;
  /** The node being LOOKED AT — inspection state, never `Node.select` in the
   *  engine, which writing would be a mutation the document saves. */
  readonly looked: string | null;
  /** The last gesture refused by name, and why. */
  readonly refusal: string | null;
  /** The canvas box the view measured itself at, in CSS px. */
  readonly size: { readonly w: number; readonly h: number };
  /** Set by the view when a `view-all` was asked for and it has framed. */
  readonly framedAt: number;
  /**
   * WHAT THE VIEW ACTUALLY DREW, in tree space — published so the parity
   * table is a MEASUREMENT of the shipped drawing rather than a second run of
   * the same arithmetic. `height` is `yTop - yBottom`, which at zoom 1 is CSS
   * pixels, because the node editor draws without DPI (`node_intern.hh:332`).
   */
  readonly drawn: readonly DrawnNode[];
}

export interface DrawnNode {
  readonly name: string;
  readonly x: number;
  readonly yTop: number;
  readonly yBottom: number;
  readonly width: number;
  readonly height: number;
  /** How many socket marks the node drew, and where the first one sits
   *  relative to the node's top — the number `node_update_basis_socket`'s
   *  `locy - NODE_DYS` decides. */
  readonly sockets: number;
  readonly firstSocketBelowTop: number | null;
  /** The header's colour, as drawn. */
  readonly header: string;
  /** SOCKET PANELS, as drawn: how many the node stood and how many of those
   *  are collapsed. A node that declares panels and drew them FLAT instead
   *  carries the reason in `panelFallback` — the ruling's own condition,
   *  readable rather than merely displayed. */
  readonly panels: number;
  readonly collapsedPanels: number;
  readonly panelFallback: string | null;
}

const INITIAL: NodeViewState = {
  transform: { cx: 0, cy: 0, zoom: 1 },
  looked: null,
  refusal: null,
  size: { w: 0, h: 0 },
  framedAt: 0,
  drawn: [],
};

let state: NodeViewState = INITIAL;
let version = 0;
const listeners = new Set<() => void>();
/** A `view-all` ASK, raised by the command and consumed by the view — the one
 *  action the store cannot compute, because framing needs the laid-out tree. */
let viewAllRequest = 0;

export function nodeViewState(): NodeViewState {
  return state;
}

export function nodeViewVersion(): number {
  return version;
}

export function subscribeNodeView(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setNodeViewState(next: Partial<NodeViewState>): void {
  state = { ...state, ...next };
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function requestNodeViewAll(): void {
  viewAllRequest += 1;
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function nodeViewAllRequest(): number {
  return viewAllRequest;
}

/** A gesture the view refuses because it would EDIT. One place, so the command
 *  door and the pointer handlers cannot drift into two vocabularies. */
export function refuseNodeViewGesture(text: string): void {
  setNodeViewState({ refusal: text });
}
