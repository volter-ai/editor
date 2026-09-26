/** Retained Pixi TextEdit: one visible Text entity plus a hidden native textarea focus/IME seam. */

import { CanvasTextMetrics, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import {
  optionalControlBinding,
  registerControlBinding,
  type GodotControl,
} from './control-state';
import { retainedPixiTextControlState } from './canvas-text-state';
import { bindGodotCanvasItemApi, markInternalCanvasChild, registerCanvasNodeRelease, type GodotCanvasItem } from './node';
import { registerGodotObjectIdentity } from './object';
import {
  bindTextEdit,
  type GodotTextEdit,
  type TextEditBindOptions,
} from './text-edit';

export type GodotCanvasTextEdit = Text & GodotCanvasItem & GodotTextEdit;

export interface CanvasTextEditOptions extends TextEditBindOptions {
  readonly node: Text;
  readonly onRelease?: () => void;
}

interface CanvasTextEditRuntime {
  readonly input?: HTMLTextAreaElement;
  unregister: () => void;
  readonly removeListeners: () => void;
  readonly onRelease: () => void;
  released: boolean;
}

const TEXT_EDITS = new WeakMap<GodotCanvasTextEdit, CanvasTextEditRuntime>();

function createTextarea(): HTMLTextAreaElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const input = document.createElement('textarea');
  input.autocomplete = 'off';
  input.wrap = 'off';
  input.style.position = 'fixed';
  input.style.left = '-10000px';
  input.style.top = '0';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.append(input);
  return input;
}

function syncTextarea(input: HTMLTextAreaElement, edit: GodotCanvasTextEdit): void {
  input.value = edit.text;
  input.readOnly = !edit.editable;
  const lines = edit.text.split('\n');
  const prefix = [
    ...lines.slice(0, edit.caret_line),
    [...(lines[edit.caret_line] ?? '')].slice(0, edit.caret_column).join(''),
  ].join('\n');
  input.setSelectionRange(prefix.length, prefix.length);
}

export function bindCanvasTextEdit(options: CanvasTextEditOptions): GodotCanvasTextEdit {
  const node = options.node as GodotCanvasTextEdit;
  if (TEXT_EDITS.has(node)) throw new Error('TextEdit canvas entity is already bound.');
  bindGodotCanvasItemApi(node);
  const state = retainedPixiTextControlState(node);
  registerControlBinding(node as unknown as GodotControl, { id: 'control', state });
  let nativeText: PropertyDescriptor | undefined;
  let owner: object | null = node;
  while (owner !== null && nativeText === undefined) {
    nativeText = Object.getOwnPropertyDescriptor(owner, 'text');
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  if (nativeText?.set === undefined) {
    throw new Error('TextEdit canvas entity has no native writable Pixi text property.');
  }
  let drawPresentation = (): void => {};
  const edit = bindTextEdit(node as unknown as GodotControl, {
    ...options,
    renderText: (text, scrollLine) => {
      nativeText.set!.call(node, text.split('\n').slice(scrollLine).join('\n'));
      drawPresentation();
    },
  }) as GodotCanvasTextEdit;
  const selectionLayer = markInternalCanvasChild(new Graphics());
  edit.addChild(selectionLayer);
  drawPresentation = (): void => {
    selectionLayer.clear();
    const lineHeight = CanvasTextMetrics.measureText('Mg', edit.style).lineHeight;
    const firstLine = edit.get_first_visible_line();
    const horizontal = edit.get_h_scroll();
    if (edit.highlight_current_line) {
      selectionLayer.rect(0, (edit.get_caret_line() - firstLine) * lineHeight, Math.max(edit.width, 1), lineHeight).fill({ color: 0x25354a, alpha: 0.5 });
    }
    if (edit.has_selection()) {
      const fromLine = edit.get_selection_from_line();
      const toLine = edit.get_selection_to_line();
      for (let line = fromLine; line <= toLine; line += 1) {
        const text = edit.get_line(line);
        const characters = [...text];
        const fromColumn = line === fromLine ? edit.get_selection_from_column() : 0;
        const toColumn = line === toLine ? edit.get_selection_to_column() : characters.length;
        const before = characters.slice(0, fromColumn).join('');
        const selected = characters.slice(fromColumn, toColumn).join('');
        const x = CanvasTextMetrics.measureText(before, edit.style).width - horizontal;
        const width = Math.max(2, CanvasTextMetrics.measureText(selected, edit.style).width);
        selectionLayer.rect(x, (line - firstLine) * lineHeight, width, lineHeight).fill({ color: 0x4b82bd, alpha: 0.62 });
      }
    } else if (edit.caret_force_displayed || !edit.caret_blink) {
      const prefix = [...edit.get_line(edit.get_caret_line())].slice(0, edit.get_caret_column()).join('');
      const x = CanvasTextMetrics.measureText(prefix, edit.style).width - horizontal;
      selectionLayer.rect(x, (edit.get_caret_line() - firstLine) * lineHeight, 1.5, lineHeight).fill({ color: 0xffffff });
    }
  };
  const caretConnection = edit.caret_changed.connect(drawPresentation);
  const input = createTextarea();
  const binding = state.read('control');
  if (input !== undefined) {
    syncTextarea(input, edit);
    input.placeholder = edit.placeholder_text;
    input.addEventListener('input', () => {
      binding.onTextEditInput?.(input.value, input.selectionStart);
    });
    input.addEventListener('select', () => binding.onTextEditCaret?.(
      input.selectionStart,
      input.selectionEnd,
      input.selectionDirection,
    ));
    binding.bindFocusElement?.(input);
    input.wrap = edit.wrap_mode === 1 ? 'soft' : 'off';
  }
  const focus = (): void => {
    if (input === undefined) throw new Error('TextEdit.grab_focus requires a browser textarea.');
    syncTextarea(input, edit);
    input.focus();
  };
  const pointCaret = (event: FederatedPointerEvent): { line: number; column: number } => {
    const local = event.getLocalPosition(edit);
    const lineHeight = CanvasTextMetrics.measureText('Mg', edit.style).lineHeight;
    const line = Math.max(0, Math.min(edit.get_line_count() - 1, edit.get_first_visible_line() + Math.floor(local.y / lineHeight)));
    const characters = [...edit.get_line(line)];
    const targetX = local.x + edit.get_h_scroll();
    let column = characters.length;
    for (let index = 0; index < characters.length; index += 1) {
      if (targetX < CanvasTextMetrics.measureText(characters.slice(0, index + 1).join(''), edit.style).width) { column = index; break; }
    }
    return { line, column };
  };
  const utf16Offset = (line: number, column: number): number => {
    const lines = edit.text.split('\n');
    return lines.slice(0, line).reduce((sum, value) => sum + value.length + 1, 0) + [...(lines[line] ?? '')].slice(0, column).join('').length;
  };
  let selectionAnchor: { line: number; column: number } | null = null;
  const pointer = (event: FederatedPointerEvent): void => {
    if (event.button !== 0) return;
    focus();
    const caret = pointCaret(event);
    selectionAnchor = caret;
    edit.set_caret_line(caret.line);
    edit.set_caret_column(caret.column);
    input?.setSelectionRange(utf16Offset(caret.line, caret.column), utf16Offset(caret.line, caret.column));
    drawPresentation();
  };
  const pointerMove = (event: FederatedPointerEvent): void => {
    if (selectionAnchor === null || !edit.selecting_enabled) return;
    const caret = pointCaret(event);
    edit.select(selectionAnchor.line, selectionAnchor.column, caret.line, caret.column);
    const anchorOffset = utf16Offset(selectionAnchor.line, selectionAnchor.column);
    const caretOffset = utf16Offset(caret.line, caret.column);
    input?.setSelectionRange(Math.min(anchorOffset, caretOffset), Math.max(anchorOffset, caretOffset), caretOffset < anchorOffset ? 'backward' : 'forward');
    drawPresentation();
  };
  const pointerUp = (): void => { selectionAnchor = null; };
  edit.focus = focus;
  edit.eventMode = 'static';
  edit.cursor = 'text';
  edit.on('pointerdown', pointer);
  edit.on('globalpointermove', pointerMove);
  edit.on('pointerup', pointerUp);
  edit.on('pointerupoutside', pointerUp);
  drawPresentation();
  const runtime: CanvasTextEditRuntime = {
    ...(input === undefined ? {} : { input }),
    unregister: () => {},
    removeListeners: () => {
      edit.off('pointerdown', pointer);
      edit.off('globalpointermove', pointerMove);
      edit.off('pointerup', pointerUp);
      edit.off('pointerupoutside', pointerUp);
      caretConnection.disconnect();
      selectionLayer.removeFromParent();
      selectionLayer.destroy();
    },
    onRelease: options.onRelease ?? (() => {}),
    released: false,
  };
  TEXT_EDITS.set(edit, runtime);
  runtime.unregister = registerCanvasNodeRelease(edit, () => releaseCanvasTextEdit(edit));
  return edit;
}

/** Runtime TextEdit constructor over the same retained Pixi Text/textarea editing seam. */
export function createGodotCanvasTextEdit(): GodotCanvasTextEdit {
  const node = new Text({ text: '' });
  registerGodotObjectIdentity(node, 'TextEdit');
  return bindCanvasTextEdit({ node, text: '', placeholder_text: '', editable: true });
}

export function releaseCanvasTextEdit(edit: GodotCanvasTextEdit): void {
  const runtime = TEXT_EDITS.get(edit);
  if (runtime === undefined || runtime.released) return;
  runtime.released = true;
  runtime.unregister();
  runtime.removeListeners();
  runtime.onRelease();
  const binding = optionalControlBinding(edit);
  binding?.state.write(binding.id, { focusElement: null });
  runtime.input?.remove();
  TEXT_EDITS.delete(edit);
}
