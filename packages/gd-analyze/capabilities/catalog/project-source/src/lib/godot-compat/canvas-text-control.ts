/** Retained Pixi text controls using the same LineEdit/RichTextLabel state machines as DOM. */

import { CanvasTextMetrics, Graphics, Sprite, Text, Texture, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';
import {
  optionalControlBinding,
  registerControlBinding,
  type ControlRichMetaRun,
  type GodotControl,
} from './control-state';
import { retainedPixiTextControlState } from './canvas-text-state';
import {
  bindLineEdit,
  bindRichTextLabel,
  type GodotLineEdit,
  type GodotRichTextLabel,
  type LineEditBindOptions,
  type RichTextLabelState,
} from './control-widgets';
import { bindGodotCanvasItemApi, markInternalCanvasChild, registerCanvasNodeRelease, type GodotCanvasItem } from './node';
import { registerGodotObjectIdentity } from './object';

export type GodotCanvasLineEdit = Text & GodotCanvasItem & GodotLineEdit;
export type GodotCanvasRichTextLabel = Text & GodotCanvasItem & GodotRichTextLabel;

interface CanvasTextControlState {
  readonly input?: HTMLInputElement;
  readonly clearButton?: Graphics;
  readonly selectionLayer?: Graphics;
  readonly caretLayer?: Graphics;
  readonly unregister: () => void;
  readonly removeListeners: () => void;
  released: boolean;
}

const LINE_EDITS = new WeakMap<GodotCanvasLineEdit, CanvasTextControlState>();
const RICH_TEXT = new WeakMap<GodotCanvasRichTextLabel, CanvasTextControlState>();

function hiddenInput(): HTMLInputElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const input = document.createElement('input');
  input.autocomplete = 'off';
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

function syncInput(input: HTMLInputElement, line: GodotCanvasLineEdit): void {
  input.value = line.text;
  input.placeholder = line.placeholder_text;
  input.type = line.secret ? 'password' : 'text';
  input.readOnly = !line.editable;
  if (line.max_length > 0) input.maxLength = line.max_length;
  else input.removeAttribute('maxlength');
}

export interface CanvasLineEditOptions extends LineEditBindOptions {
  readonly node: Text;
}

/** Bind editing to the retained Pixi Text; the offscreen input is only its browser focus/IME seam. */
export function bindCanvasLineEdit(options: CanvasLineEditOptions): GodotCanvasLineEdit {
  const node = options.node as unknown as GodotCanvasLineEdit;
  if (LINE_EDITS.has(node)) throw new Error('LineEdit canvas entity is already bound.');
  bindGodotCanvasItemApi(node);
  let syncPresentation = (): void => {};
  const state = retainedPixiTextControlState(node, () => syncPresentation());
  registerControlBinding(node as unknown as GodotControl, { id: 'control', state });
  const line = bindLineEdit(node as unknown as GodotControl, options) as unknown as GodotCanvasLineEdit;
  const input = hiddenInput();
  const binding = state.read('control');
  const clearButton = markInternalCanvasChild(new Graphics());
  const selectionLayer = markInternalCanvasChild(new Graphics());
  const caretLayer = markInternalCanvasChild(new Graphics());
  line.addChild(selectionLayer, caretLayer);
  let focused = false;
  let logicalText = line.text;
  const presentedText = (): string => {
    if (logicalText === '' && line.placeholder_text !== '') return line.placeholder_text;
    return line.secret ? line.secret_character.repeat([...logicalText].length) : logicalText;
  };
  const prefixWidth = (column: number): number => CanvasTextMetrics.measureText(
    [...presentedText()].slice(0, Math.max(0, column)).join(''),
    line.style,
  ).width;
  const drawEditingState = (): void => {
    selectionLayer.clear();
    caretLayer.clear();
    const from = line.get_selection_from_column();
    const to = line.get_selection_to_column();
    const metrics = CanvasTextMetrics.measureText(presentedText() || 'Mg', line.style);
    if (line.has_selection() && focused) {
      selectionLayer
        .rect(prefixWidth(from), 0, Math.max(1, prefixWidth(to) - prefixWidth(from)), metrics.lineHeight)
        .fill({ color: 0x4b82bd, alpha: 0.58 });
    }
    if ((focused || line.caret_force_displayed) && !line.has_selection()) {
      const x = prefixWidth(line.caret_column);
      caretLayer.moveTo(x, 0).lineTo(x, metrics.lineHeight).stroke({ color: 0xffffff, width: 1 });
    }
  };
  const drawClearButton = (): void => {
    const record = state.read('control');
    const measured = CanvasTextMetrics.measureText(line.text, line.style);
    const width = record.size?.x ?? measured.width + 20;
    const height = record.size?.y ?? Math.max(measured.height, 16);
    const radius = Math.max(6, Math.min(9, height * 0.35));
    clearButton
      .clear()
      .circle(0, 0, radius)
      .fill({ color: 0x777777, alpha: 0.72 })
      .moveTo(-radius * 0.42, -radius * 0.42)
      .lineTo(radius * 0.42, radius * 0.42)
      .moveTo(radius * 0.42, -radius * 0.42)
      .lineTo(-radius * 0.42, radius * 0.42)
      .stroke({ color: 0xffffff, width: Math.max(1, radius * 0.18) });
    clearButton.position.set(Math.max(radius, width - radius - 4), height * 0.5);
    clearButton.visible = line.clear_button_enabled && line.editable && line.text.length > 0;
  };
  syncPresentation = (): void => {
    if (input !== undefined) syncInput(input, line);
    textDescriptor!.set!.call(line, presentedText());
    drawClearButton();
    drawEditingState();
  };
  clearButton.eventMode = 'static';
  clearButton.cursor = 'pointer';
  clearButton.on('pointerdown', (event: FederatedPointerEvent) => {
    event.stopPropagation();
    if (!line.editable || !line.clear_button_enabled || line.text.length === 0) return;
    line.clear();
    syncPresentation();
    input?.focus();
  });
  line.addChild(clearButton);
  const textDescriptor = (() => {
    let owner: object | null = line;
    while (owner !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, 'text');
      if (descriptor?.get !== undefined && descriptor.set !== undefined) return descriptor;
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return undefined;
  })();
  if (textDescriptor === undefined) throw new Error('LineEdit requires the retained Pixi Text.text accessor.');
  Object.defineProperty(line, 'text', {
    enumerable: true,
    configurable: true,
    get: () => logicalText,
    set: (value: string) => {
      logicalText = String(value);
      syncPresentation();
    },
  });
  for (const property of ['placeholder_text', 'secret', 'secret_character'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(line, property);
    if (descriptor?.get === undefined || descriptor.set === undefined) continue;
    Object.defineProperty(line, property, {
      enumerable: true,
      configurable: true,
      get: () => descriptor.get!.call(line) as never,
      set: (value: never) => {
        descriptor.set!.call(line, value);
        syncPresentation();
      },
    });
  }
  if (input !== undefined) {
    syncInput(input, line);
    input.addEventListener('input', () => {
      binding.onLineEditInput?.(input.value, input.selectionStart, input.selectionEnd);
      drawEditingState();
    });
    input.addEventListener('select', () => {
      binding.onLineEditSelection?.(input.selectionStart, input.selectionEnd, input.selectionDirection);
      drawEditingState();
    });
    input.addEventListener('focus', () => {
      focused = true;
      if (line.select_all_on_focus) line.select_all();
      drawEditingState();
    });
    input.addEventListener('blur', () => {
      focused = false;
      drawEditingState();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      binding.onLineEditSubmit?.();
    });
    binding.bindFocusElement?.(input);
  }
  const focus = (): void => {
    if (input === undefined) throw new Error('LineEdit.grab_focus requires a browser DOM input target.');
    syncInput(input, line);
    input.focus();
    binding.syncLineEditSelection?.();
  };
  const caretAt = (event: FederatedPointerEvent): number => {
    const local = event.getLocalPosition(line);
    const characters = [...line.text];
    const displayed = [...presentedText()];
    let utf16 = 0;
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index]!;
      const width = CanvasTextMetrics.measureText(displayed.slice(0, index + 1).join(''), line.style).width;
      if (local.x < width) return utf16;
      utf16 += character.length;
    }
    return line.text.length;
  };
  let selectionAnchor: number | null = null;
  const pointer = (event: FederatedPointerEvent): void => {
    if (event.button !== 0) return;
    focus();
    const caret = caretAt(event);
    selectionAnchor = caret;
    input?.setSelectionRange(caret, caret);
    binding.onLineEditSelection?.(caret, caret, 'none');
    drawEditingState();
  };
  const pointerMove = (event: FederatedPointerEvent): void => {
    if (selectionAnchor === null || !line.selecting_enabled) return;
    const caret = caretAt(event);
    const from = Math.min(selectionAnchor, caret);
    const to = Math.max(selectionAnchor, caret);
    const direction = caret < selectionAnchor ? 'backward' : 'forward';
    input?.setSelectionRange(from, to, direction);
    binding.onLineEditSelection?.(from, to, direction);
    drawEditingState();
  };
  const pointerUp = (): void => { selectionAnchor = null; };
  line.focus = focus;
  line.eventMode = 'static';
  line.cursor = 'text';
  line.on('pointerdown', pointer);
  line.on('globalpointermove', pointerMove);
  line.on('pointerup', pointerUp);
  line.on('pointerupoutside', pointerUp);
  const removeListeners = (): void => {
    line.off('pointerdown', pointer);
    line.off('globalpointermove', pointerMove);
    line.off('pointerup', pointerUp);
    line.off('pointerupoutside', pointerUp);
  };
  const runtime: CanvasTextControlState = {
    ...(input === undefined ? {} : { input }),
    clearButton,
    selectionLayer,
    caretLayer,
    released: false,
    unregister: () => {},
    removeListeners,
  };
  LINE_EDITS.set(line, runtime);
  syncPresentation();
  Object.assign(runtime, {
    unregister: registerCanvasNodeRelease(line, () => releaseCanvasLineEdit(line)),
  });
  return line;
}

/** Runtime `LineEdit.new()` retaining the same Pixi Text/input identity as authored controls. */
export function createGodotCanvasLineEdit(dialect: 3 | 4): GodotCanvasLineEdit {
  const line = bindCanvasLineEdit({
    node: new Text({ text: '' }),
    dialect,
    text: '',
    placeholder_text: '',
    editable: true,
    max_length: 0,
    caret_column: 0,
    secret: false,
    selecting_enabled: true,
  });
  registerGodotObjectIdentity(line, 'LineEdit');
  return line;
}

export function releaseCanvasLineEdit(line: GodotCanvasLineEdit): void {
  const state = LINE_EDITS.get(line);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregister();
  state.removeListeners();
  const binding = optionalControlBinding(line);
  binding?.state.write(binding.id, { focusElement: null });
  state.input?.remove();
  state.clearButton?.removeFromParent();
  state.clearButton?.destroy();
  state.selectionLayer?.removeFromParent();
  state.selectionLayer?.destroy();
  state.caretLayer?.removeFromParent();
  state.caretLayer?.destroy();
  LINE_EDITS.delete(line);
}

export interface CanvasRichTextLabelOptions extends Partial<RichTextLabelState> {
  readonly node: Text;
}

/** RichTextLabel text/meta behavior on retained Pixi Text with native hit-tested meta runs. */
export function bindCanvasRichTextLabel(
  options: CanvasRichTextLabelOptions,
): GodotCanvasRichTextLabel {
  const node = options.node as GodotCanvasRichTextLabel;
  if (RICH_TEXT.has(node)) throw new Error('RichTextLabel canvas entity is already bound.');
  bindGodotCanvasItemApi(node);
  const state = retainedPixiTextControlState(node);
  registerControlBinding(node as unknown as GodotControl, { id: 'control', state });
  const rich = bindRichTextLabel(node as unknown as GodotControl, options) as GodotCanvasRichTextLabel;
  let textOwner: object | null = Object.getPrototypeOf(rich) as object | null;
  let nativeText: PropertyDescriptor | undefined;
  while (textOwner !== null && nativeText === undefined) {
    nativeText = Object.getOwnPropertyDescriptor(textOwner, 'text');
    textOwner = Object.getPrototypeOf(textOwner) as object | null;
  }
  const styledChildren: (Text | Sprite | Graphics)[] = [];
  let scrollLine = 0;
  const selectionLayer = markInternalCanvasChild(new Graphics());
  rich.addChild(selectionLayer);
  const drawSelection = (): void => {
    selectionLayer.clear();
    const record = state.read('control');
    const from = Math.min(record.richSelectionFrom ?? 0, record.richSelectionTo ?? 0);
    const to = Math.max(record.richSelectionFrom ?? 0, record.richSelectionTo ?? 0);
    if (!rich.selection_enabled || from === to) return;
    const lines = rich.get_parsed_text().split('\n');
    const lineHeight = CanvasTextMetrics.measureText('Mg', rich.style).lineHeight;
    let cursor = 0;
    lines.forEach((line, lineIndex) => {
      const characters = [...line];
      const lineStart = cursor;
      const lineEnd = lineStart + characters.length;
      const selectedStart = Math.max(lineStart, from);
      const selectedEnd = Math.min(lineEnd, to);
      if (selectedEnd > selectedStart) {
        const before = characters.slice(0, selectedStart - lineStart).join('');
        const selected = characters.slice(selectedStart - lineStart, selectedEnd - lineStart).join('');
        const x = CanvasTextMetrics.measureText(before, rich.style).width;
        const width = CanvasTextMetrics.measureText(selected, rich.style).width;
        selectionLayer.rect(x, (lineIndex - scrollLine) * lineHeight, width, lineHeight).fill({ color: 0x4b82bd, alpha: 0.6 });
      }
      cursor = lineEnd + 1;
    });
  };
  const renderRuns = (runs: readonly ControlRichMetaRun[]): void => {
    for (const child of styledChildren.splice(0)) child.destroy();
    nativeText?.set?.call(rich, '');
    const baseLineHeight = CanvasTextMetrics.measureText('Mg', rich.style).lineHeight;
    const availableWidth = state.read('control').size?.x ?? rich.width;
    const lines: {
      runs: { run: ControlRichMetaRun; text: string; width: number; height: number }[];
      width: number;
      height: number;
    }[] = [
      { runs: [], width: 0, height: baseLineHeight },
    ];
    for (const run of runs) {
      if (run.inlineTexture instanceof Texture) {
        const width = run.inlineWidth ?? run.inlineTexture.width;
        const height = run.inlineHeight ?? run.inlineTexture.height;
        const line = lines.at(-1)!;
        line.runs.push({ run, text: '', width, height });
        line.width += width;
        line.height = Math.max(line.height, height);
        continue;
      }
      const pieces = run.text.split('\n');
      for (let index = 0; index < pieces.length; index += 1) {
        const text = pieces[index] ?? '';
        const style = rich.style.clone();
        if (run.color !== undefined) style.fill = run.color;
        if (run.fontFamily !== undefined) style.fontFamily = run.fontFamily;
        if (run.fontSize !== undefined && Number.isFinite(run.fontSize)) style.fontSize = run.fontSize;
        const metrics = CanvasTextMetrics.measureText(text === '' ? 'Mg' : text, style);
        const width = text === '' ? 0 : metrics.width;
        const line = lines.at(-1)!;
        line.runs.push({ run, text, width, height: metrics.lineHeight });
        line.width += width;
        line.height = Math.max(line.height, metrics.lineHeight);
        if (index < pieces.length - 1) lines.push({ runs: [], width: 0, height: baseLineHeight });
      }
    }
    const lineOffsets: number[] = [];
    let contentHeight = 0;
    for (const line of lines) {
      lineOffsets.push(contentHeight);
      contentHeight += line.height;
    }
    const scrollOffset = lineOffsets[Math.min(scrollLine, Math.max(0, lines.length - 1))] ?? 0;
    const availableHeight = state.read('control').size?.y ?? rich.height;
    const verticalOffset = rich.vertical_alignment === 1
      ? Math.max(0, (availableHeight - contentHeight) / 2)
      : rich.vertical_alignment === 2 ? Math.max(0, availableHeight - contentHeight) : 0;
    lines.forEach((line, lineIndex) => {
      const alignment = line.runs.find((entry) => entry.run.alignment !== undefined)?.run.alignment ?? rich.horizontal_alignment;
      let x = alignment === 1 ? Math.max(0, (availableWidth - line.width) / 2)
        : alignment === 2 ? Math.max(0, availableWidth - line.width) : 0;
      for (const entry of line.runs) {
        if (entry.run.inlineTexture instanceof Texture) {
          const child = markInternalCanvasChild(new Sprite(entry.run.inlineTexture));
          child.width = entry.width;
          child.height = entry.height;
          child.position.set(x, verticalOffset + (lineOffsets[lineIndex] ?? 0) - scrollOffset + Math.max(0, line.height - entry.height));
          rich.addChild(child);
          styledChildren.push(child);
          x += entry.width;
          continue;
        }
        if (entry.text === '') continue;
        const style = rich.style.clone();
        if (entry.run.color !== undefined) style.fill = entry.run.color;
        if (entry.run.fontFamily !== undefined) style.fontFamily = entry.run.fontFamily;
        if (entry.run.fontSize !== undefined && Number.isFinite(entry.run.fontSize)) style.fontSize = entry.run.fontSize;
        const child = markInternalCanvasChild(new Text({ text: entry.text, style }));
        child.position.set(x, verticalOffset + (lineOffsets[lineIndex] ?? 0) - scrollOffset);
        if (entry.run.meta !== null) {
          child.eventMode = 'static';
          child.cursor = 'pointer';
          child.on('pointertap', (event) => {
            state.read('control').onRichTextMeta?.(entry.run.meta);
            event.stopPropagation();
          });
          child.on('pointerover', () => state.read('control').onRichTextMetaHover?.(entry.run.meta, true));
          child.on('pointerout', () => state.read('control').onRichTextMetaHover?.(entry.run.meta, false));
        }
        x += entry.width;
        rich.addChild(child);
        styledChildren.push(child);
        if (entry.run.underline) {
          const underline = markInternalCanvasChild(new Graphics()
            .moveTo(0, 0)
            .lineTo(entry.width, 0)
            .stroke({
              width: Math.max(1, Number(style.fontSize) / 16),
              color: entry.run.color ?? 0xffffff,
            }));
          underline.position.set(
            child.position.x,
            child.position.y + entry.height - Math.max(1, entry.height * 0.08),
          );
          rich.addChild(underline);
          styledChildren.push(underline);
        }
      }
    });
    drawSelection();
  };
  state.write('control', {
    onRichTextRuns: renderRuns,
    onRichTextScrollLine: (line) => {
      scrollLine = line;
      renderRuns(state.read('control').richMetaRuns ?? []);
    },
  });
  rich.append_text('');
  const metaAtPointer = (event: FederatedPointerEvent): void => {
    if (event.target !== rich) return;
    const binding = optionalControlBinding(rich);
    const record = binding?.state.read(binding.id);
    const runs = record?.richMetaRuns;
    if (runs === undefined || !runs.some((run) => run.meta !== null)) return;
    const metrics = CanvasTextMetrics.measureText(String(rich.text), rich.style);
    const local = event.getLocalPosition(rich);
    const bounds = rich.getLocalBounds();
    const lineIndex = Math.floor((local.y - bounds.y) / metrics.lineHeight);
    const line = metrics.lines[lineIndex];
    if (line === undefined) return;
    const lineWidth = metrics.lineWidths[lineIndex] ?? 0;
    const alignmentOffset = rich.style.align === 'center'
      ? (metrics.maxLineWidth - lineWidth) / 2
      : rich.style.align === 'right' ? metrics.maxLineWidth - lineWidth : 0;
    const x = local.x - bounds.x - alignmentOffset;
    if (x < 0 || x > lineWidth) return;
    const textCharacters = [...String(rich.text)];
    const findCharacters = (
      needle: readonly string[],
      from: number,
    ): number => {
      if (needle.length === 0) return from;
      const last = textCharacters.length - needle.length;
      for (let start = from; start <= last; start += 1) {
        if (needle.every((character, offset) => textCharacters[start + offset] === character)) {
          return start;
        }
      }
      return -1;
    };
    let lineStart = 0;
    for (let index = 0; index < lineIndex; index += 1) {
      const previous = [...(metrics.lines[index] ?? '')];
      const found = findCharacters(previous, lineStart);
      lineStart = (found < 0 ? lineStart : found) + previous.length;
      if (textCharacters[lineStart] === '\n') lineStart += 1;
    }
    const lineCharacters = [...line];
    const foundLine = findCharacters(lineCharacters, lineStart);
    if (foundLine >= 0) lineStart = foundLine;
    let column = 0;
    for (let index = 1; index <= lineCharacters.length; index += 1) {
      const prefix = lineCharacters.slice(0, index).join('');
      const width = CanvasTextMetrics.measureText(prefix, rich.style, undefined, false).width;
      if (x < width) { column = index - 1; break; }
      column = index;
    }
    const character = lineStart + column;
    let cursor = 0;
    for (const run of runs) {
      const end = cursor + [...run.text].length;
      if (character >= cursor && character < end && run.meta !== null) {
        record?.onRichTextMeta?.(run.meta);
        event.stopPropagation();
        return;
      }
      cursor = end;
    }
  };
  rich.eventMode = 'static';
  rich.on('pointertap', metaAtPointer);
  let selectionAnchor: number | null = null;
  const characterAt = (event: FederatedPointerEvent): number => {
    const local = event.getLocalPosition(rich);
    const lines = rich.get_parsed_text().split('\n');
    const lineHeight = CanvasTextMetrics.measureText('Mg', rich.style).lineHeight;
    const lineIndex = Math.max(0, Math.min(lines.length - 1, Math.floor(local.y / lineHeight) + scrollLine));
    const characters = [...(lines[lineIndex] ?? '')];
    let column = characters.length;
    for (let index = 0; index < characters.length; index += 1) {
      const width = CanvasTextMetrics.measureText(characters.slice(0, index + 1).join(''), rich.style).width;
      if (local.x < width) { column = index; break; }
    }
    return lines.slice(0, lineIndex).reduce((sum, line) => sum + [...line].length + 1, 0) + column;
  };
  const selectionDown = (event: FederatedPointerEvent): void => {
    if (!rich.selection_enabled || event.button !== 0) return;
    selectionAnchor = characterAt(event);
    state.write('control', { richSelectionFrom: selectionAnchor, richSelectionTo: selectionAnchor });
    drawSelection();
  };
  const selectionMove = (event: FederatedPointerEvent): void => {
    if (selectionAnchor === null) return;
    state.write('control', { richSelectionFrom: selectionAnchor, richSelectionTo: characterAt(event) });
    drawSelection();
  };
  const selectionUp = (): void => { selectionAnchor = null; };
  rich.on('pointerdown', selectionDown);
  rich.on('globalpointermove', selectionMove);
  rich.on('pointerup', selectionUp);
  rich.on('pointerupoutside', selectionUp);
  const containsTarget = (target: unknown): boolean => {
    let current = target as { parent?: unknown } | null;
    while (current !== null && current !== undefined) {
      if (current === rich) return true;
      current = current.parent as { parent?: unknown } | null;
    }
    return false;
  };
  const deselectOnGlobalPointer = (event: FederatedPointerEvent): void => {
    if (!rich.deselect_on_focus_loss_enabled || containsTarget(event.target)) return;
    selectionAnchor = null;
    state.write('control', { richSelectionFrom: 0, richSelectionTo: 0 });
    drawSelection();
  };
  rich.on('globalpointerdown', deselectOnGlobalPointer);
  const wheel = (event: FederatedWheelEvent): void => {
    if (!rich.scroll_active || event.deltaY === 0) return;
    const next = Math.max(0, Math.min(rich.get_line_count() - 1, scrollLine + (event.deltaY > 0 ? 1 : -1)));
    if (next === scrollLine) return;
    scrollLine = next;
    renderRuns(state.read('control').richMetaRuns ?? []);
    event.preventDefault();
    event.stopPropagation();
  };
  rich.on('wheel', wheel);
  const runtime: CanvasTextControlState = {
    released: false,
    unregister: () => {},
    removeListeners: () => {
      rich.off('pointertap', metaAtPointer);
      rich.off('pointerdown', selectionDown);
      rich.off('globalpointermove', selectionMove);
      rich.off('pointerup', selectionUp);
      rich.off('pointerupoutside', selectionUp);
      rich.off('globalpointerdown', deselectOnGlobalPointer);
      rich.off('wheel', wheel);
      for (const child of styledChildren.splice(0)) child.destroy();
      selectionLayer.removeFromParent();
      selectionLayer.destroy();
    },
  };
  RICH_TEXT.set(rich, runtime);
  Object.assign(runtime, {
    unregister: registerCanvasNodeRelease(rich, () => releaseCanvasRichTextLabel(rich)),
  });
  return rich;
}

/** Runtime `RichTextLabel.new()` for the exact plain-text retained Pixi implementation. */
export function createGodotCanvasRichTextLabel(): GodotCanvasRichTextLabel {
  const label = bindCanvasRichTextLabel({
    node: new Text({ text: '' }),
    text: '',
    bbcode_enabled: false,
    fit_content: false,
    scroll_active: true,
    scroll_following: false,
    visible_characters: -1,
  });
  registerGodotObjectIdentity(label, 'RichTextLabel');
  return label;
}

export function releaseCanvasRichTextLabel(label: GodotCanvasRichTextLabel): void {
  const state = RICH_TEXT.get(label);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregister();
  state.removeListeners();
  RICH_TEXT.delete(label);
}
