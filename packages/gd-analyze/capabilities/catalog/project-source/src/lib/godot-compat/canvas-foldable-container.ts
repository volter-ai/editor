/** Pixi-native retained Godot FoldableContainer behavior. */

import { Container, Graphics, Text, TextStyle, type Texture } from 'pixi.js';
import { markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';
import { bindGodotCanvasContainerApi } from './canvas-container';
import { createSignal, type GodotSignal } from './signal';

function text(member: string, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} must be String.`);
  return value;
}

function bool(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be bool.`);
  return value;
}

function integer(member: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export interface GodotCanvasFoldableContainer extends Container {
  title: string;
  title_alignment: number;
  collapsed: boolean;
  foldable_group: string;
  language: string;
  text_direction: number;
  title_position: number;
  title_text_overrun_behavior: number;
  icon: Texture | null;
  readonly folding_changed: GodotSignal<readonly [boolean]>;
  set_title(value: string): void;
  get_title(): string;
  set_title_alignment(alignment: number): void;
  get_title_alignment(): number;
  set_collapsed(collapsed: boolean): void;
  is_collapsed(): boolean;
  set_foldable_group(group: string): void;
  get_foldable_group(): string;
  set_language(language: string): void;
  get_language(): string;
  set_text_direction(direction: number): void;
  get_text_direction(): number;
  set_title_position(position: number): void;
  get_title_position(): number;
  set_title_text_overrun_behavior(behavior: number): void;
  get_title_text_overrun_behavior(): number;
  set_icon(icon: Texture | null): void;
  get_icon(): Texture | null;
  get_title_panel(): Graphics;
  get_title_control(): Text;
  focus(): void;
}

interface FoldState {
  readonly node: GodotCanvasFoldableContainer;
  readonly header: Container;
  readonly panel: Graphics;
  readonly label: Text;
  readonly signal: ReturnType<typeof createSignal<readonly [boolean]>>;
  readonly savedVisibility: Map<Container, boolean>;
  width: number;
  headerHeight: number;
  title: string;
  alignment: number;
  collapsed: boolean;
  group: string;
  language: string;
  direction: number;
  titlePosition: number;
  overrun: number;
  icon: Texture | null;
  focusButton: HTMLButtonElement | null;
  keyDown(event: KeyboardEvent): void;
  release(): void;
}

const FOLDS = new WeakMap<Container, FoldState>();
const GROUPS = new Map<string, Set<GodotCanvasFoldableContainer>>();

function synchronizeChildren(state: FoldState): void {
  for (const child of state.node.children) {
    if (child === state.header || !(child instanceof Container)) continue;
    if (state.collapsed) {
      if (!state.savedVisibility.has(child)) state.savedVisibility.set(child, child.visible);
      child.visible = false;
    } else {
      child.visible = state.savedVisibility.get(child) ?? child.visible;
      state.savedVisibility.delete(child);
    }
  }
}

function redraw(state: FoldState): void {
  const glyphWidth = 20;
  state.panel.clear()
    .roundRect(0, 0, state.width, state.headerHeight, 4)
    .fill({ color: 0x252a34, alpha: 0.96 })
    .stroke({ color: 0x4b5568, width: 1 });
  const chevronX = state.titlePosition === 1 ? state.width - 14 : 10;
  const centerY = state.headerHeight / 2;
  if (state.collapsed) {
    state.panel.poly([chevronX - 3, centerY - 5, chevronX + 3, centerY, chevronX - 3, centerY + 5]).fill(0xd8dee9);
  } else {
    state.panel.poly([chevronX - 5, centerY - 3, chevronX, centerY + 3, chevronX + 5, centerY - 3]).fill(0xd8dee9);
  }
  state.label.text = state.title;
  state.label.anchor.set(state.alignment === 0 ? 0 : state.alignment === 1 ? 0.5 : 1, 0.5);
  state.label.position.set(
    state.alignment === 0 ? glyphWidth : state.alignment === 1 ? state.width / 2 : state.width - glyphWidth,
    centerY,
  );
  state.label.style.wordWrap = false;
  state.label.style.breakWords = false;
  synchronizeChildren(state);
}

function leaveGroup(node: GodotCanvasFoldableContainer, group: string): void {
  if (group === '') return;
  const members = GROUPS.get(group);
  members?.delete(node);
  if (members?.size === 0) GROUPS.delete(group);
}

function enterGroup(node: GodotCanvasFoldableContainer, group: string): void {
  if (group === '') return;
  let members = GROUPS.get(group);
  if (members === undefined) { members = new Set(); GROUPS.set(group, members); }
  members.add(node);
}

export function bindCanvasFoldableContainer(
  source: Container,
  options: { readonly width?: number; readonly headerHeight?: number; readonly title?: string; readonly collapsed?: boolean } = {},
): GodotCanvasFoldableContainer {
  const node = source as GodotCanvasFoldableContainer;
  if (FOLDS.has(node)) throw new Error('FoldableContainer is already bound.');
  const width = options.width ?? 240;
  const headerHeight = options.headerHeight ?? 30;
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(headerHeight) || headerHeight < 0) {
    throw new RangeError('FoldableContainer dimensions must be finite and non-negative.');
  }
  const header = markInternalCanvasChild(new Container());
  const panel = markInternalCanvasChild(new Graphics());
  const label = markInternalCanvasChild(new Text({ text: '', style: new TextStyle({ fill: 0xf4f6fa, fontFamily: 'sans-serif', fontSize: 14 }) }));
  header.addChild(panel, label);
  header.eventMode = 'static';
  header.cursor = 'pointer';
  node.addChild(header);
  const state: FoldState = {
    node, header, panel, label,
    signal: createSignal<readonly [boolean]>(),
    savedVisibility: new Map(),
    width, headerHeight,
    title: text('FoldableContainer.title', options.title ?? ''),
    alignment: 0,
    collapsed: bool('FoldableContainer.collapsed', options.collapsed ?? false),
    group: '', language: '', direction: 0, titlePosition: 0, overrun: 0, icon: null,
    focusButton: null,
    keyDown: () => {},
    release: () => {},
  };
  FOLDS.set(node, state);
  const setCollapsed = (value: boolean): void => {
    const next = bool('FoldableContainer.collapsed', value);
    if (state.collapsed === next) return;
    state.collapsed = next;
    if (!next && state.group !== '') {
      for (const member of GROUPS.get(state.group) ?? []) if (member !== node) member.set_collapsed(true);
    }
    redraw(state);
    state.focusButton?.setAttribute('aria-expanded', String(!next));
    state.signal.emit(next);
  };
  const activate = (): void => setCollapsed(!state.collapsed);
  const focusButton = typeof document === 'undefined' ? null : document.createElement('button');
  if (focusButton !== null) {
    focusButton.type = 'button';
    focusButton.tabIndex = -1;
    focusButton.style.position = 'fixed';
    focusButton.style.left = '-10000px';
    focusButton.style.top = '0';
    focusButton.style.width = '1px';
    focusButton.style.height = '1px';
    focusButton.style.opacity = '0';
    focusButton.style.pointerEvents = 'none';
    focusButton.setAttribute('aria-expanded', String(!state.collapsed));
    focusButton.setAttribute('aria-label', state.title || 'Foldable section');
    document.body.append(focusButton);
    state.focusButton = focusButton;
  }
  state.keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
      return;
    }
    if (event.key === 'ArrowLeft' && !state.collapsed) {
      event.preventDefault();
      setCollapsed(true);
      return;
    }
    if (event.key === 'ArrowRight' && state.collapsed) {
      event.preventDefault();
      setCollapsed(false);
    }
  };
  focusButton?.addEventListener('keydown', state.keyDown);
  const pointerActivate = (): void => {
    state.focusButton?.focus();
    activate();
  };
  header.on('pointertap', pointerActivate);
  Object.defineProperties(node, {
    title: { enumerable: true, configurable: true, get: () => state.title, set: (value: string) => { state.title = text('FoldableContainer.title', value); state.focusButton?.setAttribute('aria-label', state.title || 'Foldable section'); redraw(state); } },
    title_alignment: { enumerable: true, configurable: true, get: () => state.alignment, set: (value: number) => { state.alignment = integer('FoldableContainer.title_alignment', value, 0, 2); redraw(state); } },
    collapsed: { enumerable: true, configurable: true, get: () => state.collapsed, set: setCollapsed },
    foldable_group: { enumerable: true, configurable: true, get: () => state.group, set: (value: string) => { const next = text('FoldableContainer.foldable_group', value); leaveGroup(node, state.group); state.group = next; enterGroup(node, next); } },
    language: { enumerable: true, configurable: true, get: () => state.language, set: (value: string) => { state.language = text('FoldableContainer.language', value); redraw(state); } },
    text_direction: { enumerable: true, configurable: true, get: () => state.direction, set: (value: number) => { state.direction = integer('FoldableContainer.text_direction', value, -1, 3); redraw(state); } },
    title_position: { enumerable: true, configurable: true, get: () => state.titlePosition, set: (value: number) => { state.titlePosition = integer('FoldableContainer.title_position', value, 0, 1); redraw(state); } },
    title_text_overrun_behavior: { enumerable: true, configurable: true, get: () => state.overrun, set: (value: number) => { state.overrun = integer('FoldableContainer.title_text_overrun_behavior', value, 0, 5); redraw(state); } },
    icon: { enumerable: true, configurable: true, get: () => state.icon, set: (value: Texture | null) => { state.icon = value; redraw(state); } },
    folding_changed: { enumerable: true, configurable: true, value: state.signal.signal },
  });
  Object.assign(node, {
    set_title(value: string): void { node.title = value; }, get_title(): string { return state.title; },
    set_title_alignment(value: number): void { node.title_alignment = value; }, get_title_alignment(): number { return state.alignment; },
    set_collapsed(value: boolean): void { node.collapsed = value; }, is_collapsed(): boolean { return state.collapsed; },
    set_foldable_group(value: string): void { node.foldable_group = value; }, get_foldable_group(): string { return state.group; },
    set_language(value: string): void { node.language = value; }, get_language(): string { return state.language; },
    set_text_direction(value: number): void { node.text_direction = value; }, get_text_direction(): number { return state.direction; },
    set_title_position(value: number): void { node.title_position = value; }, get_title_position(): number { return state.titlePosition; },
    set_title_text_overrun_behavior(value: number): void { node.title_text_overrun_behavior = value; }, get_title_text_overrun_behavior(): number { return state.overrun; },
    set_icon(value: Texture | null): void { node.icon = value; }, get_icon(): Texture | null { return state.icon; },
    get_title_panel(): Graphics { return state.panel; }, get_title_control(): Text { return state.label; },
    focus(): void {
      if (state.focusButton === null) throw new Error('FoldableContainer.grab_focus requires a browser DOM focus target.');
      state.focusButton.focus();
    },
  });
  state.release = registerCanvasNodeRelease(node, () => releaseCanvasFoldableContainer(node));
  registerGodotObjectIdentity(node, 'FoldableContainer');
  redraw(state);
  return node;
}

export function createGodotCanvasFoldableContainer(): GodotCanvasFoldableContainer {
  return bindGodotCanvasContainerApi(bindCanvasFoldableContainer(new Container()));
}

export function resizeCanvasFoldableContainer(node: Container, width: number, headerHeight?: number): void {
  const state = FOLDS.get(node);
  if (state === undefined) throw new Error('resizeCanvasFoldableContainer requires a retained FoldableContainer.');
  if (!Number.isFinite(width) || width < 0 || (headerHeight !== undefined && (!Number.isFinite(headerHeight) || headerHeight < 0))) throw new RangeError('FoldableContainer dimensions must be finite and non-negative.');
  state.width = width;
  if (headerHeight !== undefined) state.headerHeight = headerHeight;
  redraw(state);
}

export function releaseCanvasFoldableContainer(node: Container): void {
  const state = FOLDS.get(node);
  if (state === undefined) return;
  FOLDS.delete(node);
  leaveGroup(state.node, state.group);
  state.header.removeAllListeners();
  state.focusButton?.removeEventListener('keydown', state.keyDown);
  state.focusButton?.remove();
  state.node.removeChild(state.header);
  state.header.destroy({ children: true });
  state.release();
}
