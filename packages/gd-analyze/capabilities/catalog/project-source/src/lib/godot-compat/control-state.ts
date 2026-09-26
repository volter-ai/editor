/**
 * Godot Control's imperative property surface over a native React/DOM tree.
 *
 * This is a PROTOCOL: Godot scripts mutate Control objects while the translated project owns
 * ordinary JSX. The store carries only mutable values, never structure; the JSX element remains
 * the node. A translated port creates one runtime with {@link createControlRuntime} and owns it.
 * Compat owns no scheduler, React tree, or module-global game state.
 */

import {
  bindControlThemeConsumer,
  controlThemeColorOverride,
  controlThemeFontFamily,
  controlThemeFontOutline,
  controlThemeFontSizeOverride,
  controlThemeResolvedFontSize,
  type GodotTheme,
} from './theme';
import type { GodotTransform2D } from './transform-2d';
import type { GodotViewportTexture } from './viewport';

export interface ControlPoint {
  readonly x: number;
  readonly y: number;
}

export interface ControlColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface ControlGuiPointerEvent {
  readonly kind: 'button' | 'motion';
  readonly local: ControlPoint;
  readonly global: ControlPoint;
  readonly button: number;
  readonly buttons: number;
  readonly pressed: boolean;
  readonly ctrlPressed: boolean;
  readonly altPressed?: boolean;
  readonly shiftPressed?: boolean;
  readonly metaPressed?: boolean;
  readonly movement?: ControlPoint;
  readonly elapsedSeconds?: number;
  readonly pointerId?: number;
  readonly documentValue?: Document;
  readonly transferCapture?: (element?: HTMLElement) => void;
}

/** Native choice item projected by OptionButton and ItemList. */
export interface ControlChoiceItem {
  readonly text: string;
  readonly icon?: unknown;
  readonly iconSource?: string;
  readonly customFgColor?: ControlColor;
  readonly id: number;
  readonly separator: boolean;
  readonly disabled: boolean;
  readonly selected: boolean;
  readonly selectable: boolean;
  readonly tooltip: string;
}

export interface ControlMenuItem {
  readonly text: string;
  readonly icon?: unknown;
  readonly iconSource?: string;
  readonly iconMaxWidth?: number;
  readonly indent?: number;
  readonly id: number;
  readonly metadata: unknown;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly separator: boolean;
  readonly checkable: 'none' | 'check' | 'radio';
  readonly submenu: string;
}

export interface ControlRichMetaRun {
  readonly text: string;
  readonly meta: unknown | null;
  readonly color?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly alignment?: number;
  readonly underline?: boolean;
  readonly inlineTexture?: unknown;
  readonly inlineTextureSource?: string;
  readonly inlineWidth?: number;
  readonly inlineHeight?: number;
}

/** Everything the source scene authors for one Control handle. */
export interface AuthoredControl {
  readonly visible: boolean;
  readonly text: string;
  readonly texture: string;
  readonly viewportTexture?: GodotViewportTexture;
  readonly position: ControlPoint;
  readonly size: ControlPoint;
  readonly custom_minimum_size: ControlPoint;
  readonly size_flags_horizontal: number;
  readonly size_flags_vertical: number;
  readonly mouse_filter: number;
  readonly focusMode: number;
  readonly pivot_offset: ControlPoint;
  readonly scale: ControlPoint;
  readonly rotationDegrees?: number;
  readonly modulate: ControlColor;
  /** CanvasItem.self_modulate affects this Control's own draw, never its children. */
  readonly self_modulate: ControlColor;
  readonly z_index?: number;
  readonly color?: ControlColor;
  readonly referenceBorderColor?: ControlColor;
  readonly referenceBorderWidth?: number;
  readonly referenceEditorOnly?: boolean;
  readonly parentId?: string;
  readonly fontFamily?: string;
  /** Label.max_lines_visible; absent for every other Control class. */
  readonly labelMaxLinesVisible?: number;
  readonly labelHorizontalAlignment?: number;
  readonly videoExpand?: boolean;
  readonly tooltipText?: string;
}

/** The fields a translated script may change after the source scene has been built. */
export interface ControlRecord {
  readonly visible?: boolean;
  readonly text?: string;
  readonly texture?: string;
  readonly viewportTexture?: GodotViewportTexture | undefined;
  readonly position?: ControlPoint;
  readonly size?: ControlPoint;
  readonly custom_minimum_size?: ControlPoint;
  readonly size_flags_horizontal?: number;
  readonly size_flags_vertical?: number;
  readonly mouse_filter?: number;
  readonly pivot_offset?: ControlPoint;
  readonly scale?: ControlPoint;
  readonly modulate?: ControlColor;
  readonly self_modulate?: ControlColor;
  readonly z_index?: number;
  readonly color?: ControlColor;
  readonly referenceBorderColor?: ControlColor;
  readonly referenceBorderWidth?: number;
  readonly referenceEditorOnly?: boolean;
  readonly fontFamily?: string;
  readonly tooltipText?: string;
  readonly richAutowrapMode?: number;
  readonly richMetaRuns?: readonly ControlRichMetaRun[];
  readonly onRichTextMeta?: (meta: unknown) => void;
  readonly onRichTextMetaHover?: (meta: unknown, hovered: boolean) => void;
  readonly onRichTextRuns?: (runs: readonly ControlRichMetaRun[]) => void;
  readonly onRichTextScrollLine?: (line: number) => void;
  readonly richSelectionFrom?: number;
  readonly richSelectionTo?: number;
  readonly labelMaxLinesVisible?: number;
  readonly labelTextDirection?: number;
  readonly labelLanguage?: string;
  readonly labelMinimumLines?: number;
  readonly richFitContent?: boolean;
  readonly richScrollActive?: boolean;
  readonly labelHorizontalAlignment?: number;
  readonly videoExpand?: boolean;
  readonly onControlMouseExited?: () => void;
  readonly onControlFocusEntered?: (() => void) | undefined;
  readonly onControlFocusExited?: (() => void) | undefined;
  readonly onControlGuiInput?: ((event: ControlGuiPointerEvent) => void) | undefined;
  readonly onControlResized?: (() => void) | undefined;
  /** Returns false when a retained click grab redirected this native event to another Control. */
  readonly routeControlPointer?: (event: ControlGuiPointerEvent) => boolean;
  readonly focusMode?: number;
  readonly rotationDegrees?: number;
  readonly theme?: GodotTheme | null;
  readonly themeTypeVariation?: string;
  readonly themeFontColorOverride?: ControlColor | null;
  readonly themeFontSizeOverride?: number | null;
  readonly themeFontOutline?: { readonly size: number; readonly color: string } | null;
  readonly themeFontFamily?: string;
  readonly themeFontSize?: number;
  readonly onButtonPointerDown?: (button?: number) => boolean | void;
  readonly onButtonPointerUp?: (button?: number) => boolean | void;
  readonly onButtonPointerCancel?: () => void;
  readonly onButtonPointerOutside?: (button?: number) => void;
  readonly buttonMask?: number;
  readonly buttonKeepPressedOutside?: boolean;
  readonly buttonShortcutFeedback?: boolean;
  readonly buttonShortcutInTooltip?: boolean;
  readonly onLineEditInput?: (
    value: string,
    selectionStart?: number | null,
    selectionEnd?: number | null,
  ) => void;
  readonly onLineEditSelection?: (
    selectionStart?: number | null,
    selectionEnd?: number | null,
    selectionDirection?: 'forward' | 'backward' | 'none' | null,
  ) => void;
  readonly syncLineEditSelection?: () => void;
  readonly onLineEditSubmit?: () => void;
  readonly onTextEditInput?: (value: string, selectionStart?: number | null) => void;
  readonly onTextEditCaret?: (
    selectionStart?: number | null,
    selectionEnd?: number | null,
    selectionDirection?: 'forward' | 'backward' | 'none' | null,
  ) => void;
  readonly onTextEditScrollLine?: (line: number) => void;
  readonly textEditScrollVertical?: number;
  readonly textEditScrollHorizontal?: number;
  readonly onRangeInput?: (value: number) => void;
  readonly onRangeWheel?: (deltaY: number) => void;
  readonly focusElement?: HTMLElement | null;
  readonly bindFocusElement?: (element: HTMLElement | null) => void;
  readonly presentationElement?: HTMLElement | null;
  readonly bindPresentationElement?: (element: HTMLElement | null) => void;
  readonly rangeValue?: number;
  readonly rangeMin?: number;
  readonly rangeMax?: number;
  readonly rangeStep?: number | 'any';
  readonly rangeVertical?: boolean;
  readonly rangeEditable?: boolean;
  readonly rangeTickCount?: number;
  readonly rangeTicksOnBorders?: boolean;
  readonly onRangeDragStart?: () => void;
  readonly onRangeDragEnd?: () => void;
  readonly colorPickerHex?: string;
  readonly colorPickerAlpha?: number;
  readonly colorPickerEditAlpha?: boolean;
  readonly colorPickerMode?: number;
  readonly colorPickerSamplerVisible?: boolean;
  readonly colorPickerSlidersVisible?: boolean;
  readonly colorPickerHexVisible?: boolean;
  readonly colorPickerPresetsVisible?: boolean;
  readonly colorPickerModesVisible?: boolean;
  readonly colorPickerPresets?: readonly string[];
  readonly onColorPickerInput?: (hex: string, alpha: number, commit: boolean) => void;
  readonly onColorPickerCommit?: () => void;
  readonly linePlaceholder?: string;
  readonly lineEditable?: boolean;
  readonly lineSecret?: boolean;
  readonly lineSelecting?: boolean;
  readonly lineClearButtonEnabled?: boolean;
  readonly lineSecretCharacter?: string;
  readonly lineExpandToTextLength?: boolean;
  readonly lineFlat?: boolean;
  readonly lineAlignment?: number;
  readonly textEditEditable?: boolean;
  readonly textEditPlaceholder?: string;
  readonly textEditWrapMode?: number;
  readonly buttonDisabled?: boolean;
  readonly buttonPressed?: boolean;
  readonly buttonIconSource?: string | undefined;
  readonly buttonFlat?: boolean | undefined;
  readonly buttonIconAlignment?: number | undefined;
  readonly buttonAutowrapMode?: number | undefined;
  readonly buttonClipText?: boolean | undefined;
  readonly buttonExpandIcon?: boolean | undefined;
  readonly buttonAlignment?: number | undefined;
  readonly buttonVerticalIconAlignment?: number | undefined;
  readonly buttonTextOverrunBehavior?: number | undefined;
  readonly buttonTextDirection?: number | undefined;
  readonly buttonLanguage?: string | undefined;
  readonly onMouseEntered?: () => void;
  readonly progressShowPercentage?: boolean;
  readonly progressFillMode?: number;
  readonly progressIndeterminate?: boolean;
  readonly textureProgressUnder?: string;
  readonly textureProgressOver?: string;
  readonly textureProgressValue?: string;
  readonly textureProgressInitialAngle?: number;
  readonly textureProgressFillDegrees?: number;
  readonly textureProgressCenterOffset?: ControlPoint;
  readonly textureProgressOffset?: ControlPoint;
  readonly textureProgressTintUnder?: string;
  readonly textureProgressTintOver?: string;
  readonly textureProgressTintValue?: string;
  readonly separatorOrientation?: 'horizontal' | 'vertical';
  readonly choiceItems?: readonly ControlChoiceItem[];
  readonly choiceSelected?: number;
  readonly choiceMultiple?: boolean;
  readonly choicePopupOpen?: boolean;
  readonly choiceScrollIndex?: number;
  /** Native ItemList vertical viewport offset, in retained canvas pixels. */
  readonly choiceScrollOffset?: number;
  readonly onChoiceSelect?: (indices: readonly number[]) => void;
  readonly onChoiceClick?: (index: number, position: ControlPoint, button: number) => void;
  readonly getDragData?: ((position: ControlPoint) => unknown) | undefined;
  readonly canDropData?: ((position: ControlPoint, data: unknown) => boolean) | undefined;
  readonly dropData?: ((position: ControlPoint, data: unknown) => void) | undefined;
  readonly menuItems?: readonly ControlMenuItem[];
  readonly menuOpen?: boolean;
  readonly menuFocusedItem?: number;
  readonly onMenuSelect?: (index: number) => void;
  readonly onMenuFocus?: (index: number) => void;
  readonly onMenuCloseRequest?: () => void;
  readonly bindMenuPresentationElement?: (element: HTMLElement | null) => void;
  readonly containerAlignment?: number;
  readonly containerColumns?: number;
  readonly containerSpacers?: readonly GodotControl[];
  readonly scrollHorizontal?: number;
  readonly scrollVertical?: number;
  readonly scrollHorizontalEnabled?: boolean;
  readonly scrollVerticalEnabled?: boolean;
  readonly bindScrollElement?: (element: HTMLElement | null) => void;
  readonly onControlScroll?: (left: number, top: number) => void;
  readonly onControlScrollStart?: () => void;
  readonly onControlScrollEnd?: () => void;
  readonly flowVertical?: boolean;
  readonly flowAlignment?: number;
  readonly flowLastWrapAlignment?: number;
  readonly flowReverseFill?: boolean;
  readonly splitVertical?: boolean;
  readonly splitOffset?: number;
  readonly splitCollapsed?: boolean;
  readonly splitDraggable?: boolean;
  readonly splitDraggerVisibility?: number;
  readonly onSplitDrag?: (value: number) => void;
  readonly aspectRatio?: number;
  readonly aspectStretchMode?: number;
  readonly aspectAlignmentHorizontal?: number;
  readonly aspectAlignmentVertical?: number;
  readonly linkUri?: string;
  readonly linkUnderline?: number;
  readonly textureButtonSource?: string;
  readonly textureButtonFocused?: string;
  readonly textureButtonFit?: 'fill' | 'none' | 'contain' | 'cover';
  readonly textureButtonCentered?: boolean;
  readonly textureButtonFlipH?: boolean;
  readonly textureButtonFlipV?: boolean;
  readonly onTextureButtonHover?: (value: boolean) => void;
  readonly onTextureButtonFocus?: (value: boolean) => void;
  readonly onTextureButtonHeld?: (value: boolean) => void;
  readonly textureButtonAcceptsPoint?: (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => boolean;
  readonly onTextureButtonSourceSize?: (width: number, height: number) => void;
  readonly spinPrefix?: string;
  readonly spinSuffix?: string;
  readonly spinAlign?: number;
  readonly tabCurrent?: number;
  readonly tabTitles?: readonly string[];
  readonly tabDisabled?: readonly boolean[];
  readonly tabCloseDisplayPolicy?: number;
  readonly onTabClose?: (index: number) => void;
  readonly onTabSelect?: (index: number) => void;
  readonly onTabHover?: (index: number) => void;
  readonly dialogText?: string;
  readonly dialogAutowrap?: boolean;
  readonly dialogAutowrapMode?: number;
  readonly dialogHideOnOk?: boolean;
  readonly dialogCloseOnEscape?: boolean;
  readonly dialogButtons?: readonly string[];
  readonly dialogFocusedButton?: number;
  readonly windowTitle?: string;
  readonly windowTransparentBackground?: boolean;
  readonly windowAttentionRequested?: boolean;
  readonly onWindowCloseRequest?: () => void;
  readonly onDialogConfirm?: () => void;
  readonly onDialogCancel?: () => void;
  readonly onDialogButton?: (index: number) => void;
  readonly fileAccept?: string;
  readonly fileDirectoryMode?: boolean;
  readonly fileCurrentDir?: string;
  readonly fileCurrentFile?: string;
  readonly fileShowHiddenFiles?: boolean;
  readonly fileUseNativeDialog?: boolean;
  readonly fileRootSubfolder?: string;
  readonly fileDisplayMode?: number;
  readonly fileFilenameFilter?: string;
  readonly fileOptions?: readonly {
    readonly name: string;
    readonly values: readonly string[];
    readonly defaultValue: number;
  }[];
  readonly onFileNameInput?: (file: string) => void;
  readonly onFileSelect?: (path: string) => void;
  readonly treeColumns?: number;
  readonly treeColumnExpand?: readonly boolean[];
  readonly treeColumnExpandRatio?: readonly number[];
  readonly treeColumnMinimumWidth?: readonly number[];
  readonly treeColumnClipContent?: readonly boolean[];
  readonly treeColumnTitles?: readonly string[];
  readonly treeColumnTitleAlignment?: readonly number[];
  readonly treeColumnTitlesVisible?: boolean;
  readonly treeScroll?: ControlPoint;
  readonly treeHoveredRowKey?: number | undefined;
  readonly treeRows?: readonly {
    readonly key: number;
    readonly text: string;
    readonly depth: number;
    readonly selected: boolean;
    readonly selectedColumns?: readonly number[];
    readonly cells: readonly {
      readonly text: string;
      readonly iconSource?: string;
      readonly iconTexture?: unknown;
      readonly iconMaxWidth: number;
      readonly iconModulate?: number;
      readonly iconModulateAlpha?: number;
      readonly textAlignment?: number;
      readonly customColor?: number;
      readonly customColorAlpha?: number;
      readonly customBackgroundColor?: number;
      readonly customBackgroundAlpha?: number;
      readonly customBackgroundOutline?: boolean;
      readonly cellMode?: number;
      readonly rangeMin?: number;
      readonly rangeMax?: number;
      readonly rangeStep?: number;
      readonly rangeExpression?: boolean;
      readonly buttons: readonly {
        readonly key: number;
        readonly iconSource?: string;
        readonly iconTexture?: unknown;
        readonly id: number;
        readonly disabled: boolean;
        readonly tooltip: string;
        readonly description: string;
      }[];
    }[];
  }[];
  readonly onTreeButtonClick?: (
    rowKey: number,
    column: number,
    buttonKey: number,
    mouseButton: number,
  ) => void;
  readonly onTreeCellClick?: (
    rowKey: number,
    column: number,
    position?: ControlPoint,
    mouseButton?: number,
    doubleClick?: boolean,
  ) => void;
  readonly onTreeEmptyClick?: (position: ControlPoint, mouseButton: number) => void;
  readonly onTreeColumnTitleClick?: (column: number, mouseButton: number) => void;
}

/** The retained API object a translated scene class holds for one Control. */
export interface GodotControl {
  visible: boolean;
  text: string;
  texture: string;
  /** Host projection of an authored ViewportTexture; separate from script-visible URL textures. */
  viewportTexture: GodotViewportTexture | undefined;
  position: ControlPoint;
  rect_position: ControlPoint;
  global_position: ControlPoint;
  size: ControlPoint;
  rect_size: ControlPoint;
  custom_minimum_size: ControlPoint;
  size_flags_horizontal: number;
  size_flags_vertical: number;
  mouse_filter: number;
  pivot_offset: ControlPoint;
  scale: ControlPoint;
  modulate: ControlColor;
  self_modulate: ControlColor;
  z_index: number;
  zIndex: number;
  color: ControlColor;
  tooltip_text: string;
  set_visible(value: boolean): void;
  is_visible(): boolean;
  show(): void;
  hide(): void;
  set_z_index(value: number): void;
  get_z_index(): number;
  get_global_position(): ControlPoint;
  set_global_position(value: ControlPoint): void;
  get_global_transform(): GodotTransform2D;
  get_global_transform_with_canvas(): GodotTransform2D;
  get_position(): ControlPoint;
  set_position(value: ControlPoint, keepOffsets?: boolean): void;
  get_size(): ControlPoint;
  set_size(value: ControlPoint, keepOffsets?: boolean): void;
  get_scale(): ControlPoint;
  set_scale(value: ControlPoint): void;
  readonly bindPresentationElement?: (element: HTMLElement | null) => void;
}

export interface ControlBinding {
  readonly id: string;
  readonly state: ControlState;
}

const controlBindings = new WeakMap<GodotControl, ControlBinding>();
const controlsByFocusElement = new WeakMap<HTMLElement, GodotControl>();
let retainedHoveredControl: GodotControl | null = null;
const focusOwnersByRoot = new WeakMap<object, GodotControl>();
const focusRootByControl = new WeakMap<GodotControl, object>();
const pointerRootByControl = new WeakMap<GodotControl, object>();
const dragViewportByControl = new WeakMap<GodotControl, object>();
const dragViewportByNativeRoot = new WeakMap<
  object,
  {
    readonly viewportRoot: object;
    readonly owners: Set<GodotControl>;
  }
>();

interface PointerRootState {
  owner: GodotControl | null;
  last: ControlGuiPointerEvent | null;
  readonly heldButtons: Set<number>;
  dragStart: ControlPoint | null;
  dragData: unknown | null;
  dragging: boolean;
  dragPreview: object | null;
  dragPreviewRoot: object | null;
  outsideDocument: Document | null;
  outsidePointerId: number | null;
  outsideRelease: ((event: PointerEvent) => void) | null;
}

const pointerStateByRoot = new WeakMap<object, PointerRootState>();
const pointerStateByViewport = new WeakMap<object, PointerRootState>();

function retainedControlRoot(control: GodotControl, binding: ControlBinding): object {
  let current: object = control;
  const visited = new Set<object>();
  while (!visited.has(current)) {
    visited.add(current);
    const parent = Reflect.get(current, 'parent') as object | null | undefined;
    if (parent === undefined || parent === null) break;
    current = parent;
  }
  return current === control ? binding.state : current;
}

function dragViewportRootOf(control: GodotControl, binding: ControlBinding): object | undefined {
  let viewportRoot = dragViewportByControl.get(control);
  if (viewportRoot === undefined) {
    let current: object | null = control;
    const visited = new Set<object>();
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      const mapped = dragViewportByNativeRoot.get(current);
      if (mapped !== undefined) {
        viewportRoot = mapped.viewportRoot;
        break;
      }
      current = (Reflect.get(current, 'parent') as object | null | undefined) ?? null;
    }
    viewportRoot ??= dragViewportByNativeRoot.get(binding.state)?.viewportRoot;
  }
  return viewportRoot;
}

function pointerStateKey(control: GodotControl, binding: ControlBinding): object {
  return dragViewportRootOf(control, binding) ?? retainedControlRoot(control, binding);
}

function pointerRootState(control: GodotControl, binding: ControlBinding): PointerRootState {
  const viewportRoot = dragViewportRootOf(control, binding);
  const root = retainedControlRoot(control, binding);
  const stateKey = viewportRoot ?? root;
  let state = pointerStateByRoot.get(stateKey);
  if (state === undefined) {
    state = {
      owner: null,
      last: null,
      heldButtons: new Set(),
      dragStart: null,
      dragData: null,
      dragging: false,
      dragPreview: null,
      dragPreviewRoot: null,
      outsideDocument: null,
      outsidePointerId: null,
      outsideRelease: null,
    };
    pointerStateByRoot.set(stateKey, state);
  }
  if (viewportRoot !== undefined) pointerStateByViewport.set(viewportRoot, state);
  return state;
}

function positionDragPreview(pointer: PointerRootState, event: ControlGuiPointerEvent): void {
  const preview = pointer.dragPreview;
  if (preview === null) return;
  if (typeof HTMLElement !== 'undefined' && preview instanceof HTMLElement) {
    preview.style.left = `${String(event.global.x)}px`;
    preview.style.top = `${String(event.global.y)}px`;
    return;
  }
  const nativeRoot = pointer.dragPreviewRoot as {
    toLocal?: (point: Readonly<ControlPoint>) => Readonly<ControlPoint>;
  } | null;
  const nativePreview = preview as {
    position?: { set(x: number, y: number): void };
  };
  if (nativePreview.position === undefined) return;
  const point = nativeRoot?.toLocal?.(event.global) ?? event.global;
  nativePreview.position.set(point.x, point.y);
}

function releaseDragPreview(pointer: PointerRootState): void {
  const preview = pointer.dragPreview;
  if (preview === null) return;
  if (typeof HTMLElement !== 'undefined' && preview instanceof HTMLElement) preview.remove();
  else {
    const native = preview as {
      removeFromParent?: () => void;
      destroy?: (options?: { children?: boolean }) => void;
    };
    native.removeFromParent?.();
    native.destroy?.({ children: true });
  }
  pointer.dragPreview = null;
  pointer.dragPreviewRoot = null;
}

function releaseOutsidePointer(pointer: PointerRootState): void {
  if (pointer.outsideDocument !== null && pointer.outsideRelease !== null) {
    pointer.outsideDocument.removeEventListener('pointerup', pointer.outsideRelease, true);
    pointer.outsideDocument.removeEventListener('pointercancel', pointer.outsideRelease, true);
  }
  pointer.outsideDocument = null;
  pointer.outsidePointerId = null;
  pointer.outsideRelease = null;
}

function finishGuiDrag(pointer: PointerRootState): void {
  releaseOutsidePointer(pointer);
  releaseDragPreview(pointer);
  pointer.dragStart = null;
  pointer.dragData = null;
  pointer.dragging = false;
}

function retainOutsidePointer(pointer: PointerRootState, event: ControlGuiPointerEvent): void {
  if (event.documentValue === undefined || event.pointerId === undefined) return;
  releaseOutsidePointer(pointer);
  pointer.outsideDocument = event.documentValue;
  pointer.outsidePointerId = event.pointerId;
  pointer.outsideRelease = (nativeEvent): void => {
    if (nativeEvent.pointerId !== pointer.outsidePointerId) return;
    const pointerId = nativeEvent.pointerId;
    const button = nativeEvent.button;
    const canceled = nativeEvent.type === 'pointercancel';
    // Capture guarantees an outside release cannot be swallowed by unrelated DOM. The microtask
    // lets a retained Control's target/bubble handler perform its exact drop first; if it already
    // finished the gesture, the retained pointer id no longer matches and this becomes a no-op.
    queueMicrotask(() => {
      if (pointer.outsidePointerId !== pointerId) return;
      if (canceled) pointer.heldButtons.clear();
      else pointer.heldButtons.delete(button);
      if (pointer.heldButtons.size !== 0) return;
      if (pointer.owner !== null) pointerRootByControl.delete(pointer.owner);
      pointer.owner = null;
      pointer.last = null;
      finishGuiDrag(pointer);
    });
  };
  event.documentValue.addEventListener('pointerup', pointer.outsideRelease, true);
  event.documentValue.addEventListener('pointercancel', pointer.outsideRelease, true);
}

/** `Control.set_drag_preview` takes ownership of the caller's real native Control until release. */
export function setControlDragPreview(control: object, preview: object): void {
  if (typeof preview !== 'object' || preview === null) {
    throw new TypeError('Control.set_drag_preview requires a retained Control.');
  }
  const typed = control as GodotControl;
  const binding = controlBindings.get(typed);
  if (binding === undefined)
    throw new Error('Control.set_drag_preview requires a retained Control in an active viewport.');
  const root = retainedControlRoot(typed, binding);
  const pointer = pointerRootState(typed, binding);
  if ((pointer.heldButtons.size === 0 && !pointer.dragging) || pointer.last === null) {
    throw new Error('Control.set_drag_preview is only valid during an active GUI pointer drag.');
  }
  if (pointer.dragPreview !== null) releaseDragPreview(pointer);
  if (typeof HTMLElement !== 'undefined' && preview instanceof HTMLElement) {
    if (preview.isConnected)
      throw new Error('Control.set_drag_preview requires a Control outside the scene tree.');
    const documentValue = preview.ownerDocument;
    preview.style.position = 'fixed';
    preview.style.pointerEvents = 'none';
    documentValue.body.append(preview);
  } else {
    const nativeRoot = root as { addChild?: (child: object) => void };
    const nativePreview = preview as { parent?: object | null };
    if (nativePreview.parent !== undefined && nativePreview.parent !== null) {
      throw new Error('Control.set_drag_preview requires a Control outside the scene tree.');
    }
    if (nativeRoot.addChild === undefined) {
      throw new Error('Control.set_drag_preview requires a retained DOM or Pixi viewport carrier.');
    }
    nativeRoot.addChild(preview);
  }
  pointer.dragPreview = preview;
  pointer.dragPreviewRoot = root;
  positionDragPreview(pointer, pointer.last);
}

/** `Control.force_drag` begins a retained GUI drag without waiting for the pointer threshold. */
export function forceControlDrag(control: object, data: unknown, preview: object): void {
  if (data === null || data === undefined) {
    throw new TypeError('Control.force_drag requires non-null drag data.');
  }
  if (typeof preview !== 'object' || preview === null) {
    throw new TypeError('Control.force_drag requires a retained Control preview.');
  }
  const typed = control as GodotControl;
  const binding = controlBindings.get(typed);
  if (binding === undefined)
    throw new Error('Control.force_drag requires a retained Control binding.');
  const pointer = pointerRootState(typed, binding);
  if (pointer.dragging || pointer.dragPreview !== null) finishGuiDrag(pointer);
  const current = binding.state.read(binding.id);
  const global = current.position ?? { x: 0, y: 0 };
  pointer.owner = typed;
  pointer.dragStart = { x: global.x, y: global.y };
  pointer.dragData = data;
  pointer.dragging = true;
  pointer.last = {
    kind: 'motion',
    local: { x: 0, y: 0 },
    global: { x: global.x, y: global.y },
    button: 0,
    buttons: 0,
    pressed: false,
    ctrlPressed: false,
  };
  const viewportRoot = dragViewportRootOf(typed, binding);
  if (viewportRoot !== undefined) pointerStateByViewport.set(viewportRoot, pointer);
  setControlDragPreview(typed, preview);
}

/** `Viewport.gui_is_dragging` over the active pointer lifecycle of this native viewport/root. */
export function godotGuiIsDragging(viewportRoot: object): boolean {
  return pointerStateByViewport.get(viewportRoot)?.dragging ?? false;
}

/** `Viewport.gui_get_drag_data` returns the retained Variant produced by `_get_drag_data`. */
export function godotGuiGetDragData(viewportRoot: object): unknown | null {
  return pointerStateByViewport.get(viewportRoot)?.dragData ?? null;
}

export interface ControlDragCallbacks {
  readonly getDragData?: (position: ControlPoint) => unknown;
  readonly canDropData?: (position: ControlPoint, data: unknown) => boolean;
  readonly dropData?: (position: ControlPoint, data: unknown) => void;
}

/** Bind translated script virtuals to the native Control that owns pointer routing. */
export function bindControlDragCallbacks(
  control: object,
  viewportRoot: object,
  callbacks: ControlDragCallbacks,
): () => void {
  const typed = control as GodotControl;
  const binding = controlBindings.get(typed);
  if (binding === undefined)
    throw new Error('Control drag callbacks require a retained Control binding.');
  const retainedRoot = retainedControlRoot(typed, binding);
  const roots =
    retainedRoot === binding.state && typeof Reflect.get(typed, 'addChild') === 'function'
      ? [retainedRoot, typed]
      : [retainedRoot];
  const rootBindings = roots.map((nativeRoot) => {
    let rootBinding = dragViewportByNativeRoot.get(nativeRoot);
    if (rootBinding === undefined) {
      rootBinding = { viewportRoot, owners: new Set() };
      dragViewportByNativeRoot.set(nativeRoot, rootBinding);
    } else if (rootBinding.viewportRoot !== viewportRoot) {
      throw new Error('A retained Control root cannot belong to two GUI viewports.');
    }
    rootBinding.owners.add(typed);
    return { nativeRoot, rootBinding };
  });
  dragViewportByControl.set(typed, viewportRoot);
  binding.state.write(binding.id, {
    ...(callbacks.getDragData === undefined ? {} : { getDragData: callbacks.getDragData }),
    ...(callbacks.canDropData === undefined ? {} : { canDropData: callbacks.canDropData }),
    ...(callbacks.dropData === undefined ? {} : { dropData: callbacks.dropData }),
  });
  return () => {
    for (const { nativeRoot, rootBinding } of rootBindings) {
      rootBinding.owners.delete(typed);
      if (
        rootBinding.owners.size === 0 &&
        dragViewportByNativeRoot.get(nativeRoot) === rootBinding
      ) {
        dragViewportByNativeRoot.delete(nativeRoot);
      }
    }
    const current = controlBindings.get(typed);
    if (current !== binding) return;
    const record = binding.state.read(binding.id);
    const stillOwnsCallbacks =
      (callbacks.getDragData === undefined || record.getDragData === callbacks.getDragData) &&
      (callbacks.canDropData === undefined || record.canDropData === callbacks.canDropData) &&
      (callbacks.dropData === undefined || record.dropData === callbacks.dropData);
    binding.state.write(binding.id, {
      ...(record.getDragData === callbacks.getDragData ? { getDragData: undefined } : {}),
      ...(record.canDropData === callbacks.canDropData ? { canDropData: undefined } : {}),
      ...(record.dropData === callbacks.dropData ? { dropData: undefined } : {}),
    });
    if (stillOwnsCallbacks && dragViewportByControl.get(typed) === viewportRoot) {
      dragViewportByControl.delete(typed);
    }
  };
}

/** Key-focus owner scoped to this Control's actual retained Pixi tree or DOM ControlState root. */
export function retainedControlFocusOwner(control: object): GodotControl | null {
  const typed = control as GodotControl;
  const binding = controlBindings.get(typed);
  return binding === undefined
    ? null
    : (focusOwnersByRoot.get(
        focusRootByControl.get(typed) ?? retainedControlRoot(typed, binding),
      ) ?? null);
}

/** Seat the existing Control protocol on a renderer-owned retained entity. */
export function registerControlBinding(control: GodotControl, binding: ControlBinding): void {
  const previous = controlBindings.get(control);
  if (previous !== undefined && previous.state !== binding.state) {
    previous.state.removeControl(previous.id, control);
  }
  controlBindings.set(control, binding);
  binding.state.seatControl(binding.id, control);
  binding.state.write(binding.id, {
    routeControlPointer: (event) => binding.state.routePointer(control, event),
  });
}

/** Remove one retained Control from its root store, including viewport focus ownership. */
export function releaseControlBinding(control: object): void {
  const typed = control as GodotControl;
  const binding = controlBindings.get(typed);
  if (binding === undefined) return;
  binding.state.removeControl(binding.id, typed);
  controlBindings.delete(typed);
}

export function controlBinding(control: GodotControl): ControlBinding {
  const binding = controlBindings.get(control);
  if (binding === undefined)
    throw new Error('Godot Control handle is not bound to a ControlState.');
  return binding;
}

/** Resolve a renderer-owned Control binding without fabricating one for native Pixi entities. */
export function optionalControlBinding(control: object): ControlBinding | undefined {
  return controlBindings.get(control as GodotControl);
}

/** The retained Control whose native browser element currently owns keyboard focus. */
export function retainedGuiFocusOwner(
  documentValue: Document | undefined = typeof document === 'undefined' ? undefined : document,
): GodotControl | null {
  if (documentValue === undefined) return null;
  const active = documentValue.activeElement;
  return typeof HTMLElement !== 'undefined' && active instanceof HTMLElement
    ? (controlsByFocusElement.get(active) ?? null)
    : null;
}

/** The retained Control most recently targeted by the native DOM/Pixi pointer stream. */
export function retainedGuiHoveredOwner(): GodotControl | null {
  return retainedHoveredControl;
}

export type ControlSnapshot = Readonly<Record<string, ControlRecord>>;

/** One port- or story-owned value store. */
export interface ControlState {
  read(id: string): ControlRecord;
  write(id: string, patch: ControlRecord): void;
  register(id: string, authored: AuthoredControl): void;
  authored(id: string): AuthoredControl | undefined;
  seatControl(id: string, control: GodotControl): void;
  control(id: string): GodotControl | undefined;
  childControls(id: string): readonly GodotControl[];
  focusOwner(): GodotControl | null;
  releaseFocus(control?: GodotControl): void;
  routePointer(control: GodotControl, event: ControlGuiPointerEvent): boolean;
  grabClickFocus(control: GodotControl): void;
  removeControl(id: string, control: GodotControl): void;
  retain(release: () => void): void;
  clear(): void;
  snapshot(): ControlSnapshot;
}

const EMPTY: ControlRecord = {};

/** Create an isolated Control property store. */
export function createControlState(): ControlState {
  const records = new Map<string, ControlRecord>();
  const authored = new Map<string, AuthoredControl>();
  const controls = new Map<string, GodotControl>();
  const releases = new Set<() => void>();
  const focusListeners = new Map<
    string,
    {
      readonly element: HTMLElement;
      readonly focus: () => void;
      readonly blur: () => void;
    }
  >();
  let focusOwner: GodotControl | null = null;
  let snapshot: ControlSnapshot = {};
  const refresh = (): void => {
    snapshot = Object.fromEntries(records);
  };
  const detachFocusElement = (id: string): void => {
    const listeners = focusListeners.get(id);
    if (listeners === undefined) return;
    listeners.element.removeEventListener('focus', listeners.focus);
    listeners.element.removeEventListener('blur', listeners.blur);
    controlsByFocusElement.delete(listeners.element);
    focusListeners.delete(id);
  };
  const attachFocusElement = (id: string, element: HTMLElement): void => {
    detachFocusElement(id);
    const focus = (): void => {
      focusOwner = controls.get(id) ?? null;
      if (focusOwner !== null) {
        const binding = controlBindings.get(focusOwner);
        if (binding !== undefined) {
          const root = retainedControlRoot(focusOwner, binding);
          focusRootByControl.set(focusOwner, root);
          focusOwnersByRoot.set(root, focusOwner);
        }
        records.get(id)?.onControlFocusEntered?.();
      }
    };
    const blur = (): void => {
      const control = controls.get(id);
      if (focusOwner === control) focusOwner = null;
      if (control !== undefined) {
        const binding = controlBindings.get(control);
        const root =
          binding === undefined
            ? focusRootByControl.get(control)
            : (focusRootByControl.get(control) ?? retainedControlRoot(control, binding));
        if (root !== undefined && focusOwnersByRoot.get(root) === control)
          focusOwnersByRoot.delete(root);
        focusRootByControl.delete(control);
        records.get(id)?.onControlFocusExited?.();
      }
    };
    element.addEventListener('focus', focus);
    element.addEventListener('blur', blur);
    focusListeners.set(id, { element, focus, blur });
    const control = controls.get(id);
    if (control !== undefined) controlsByFocusElement.set(element, control);
    if (element.ownerDocument.activeElement === element) {
      focusOwner = control ?? null;
      if (control !== undefined) {
        const root = retainedControlRoot(control, controlBindings.get(control)!);
        focusRootByControl.set(control, root);
        focusOwnersByRoot.set(root, control);
      }
    }
  };
  const pointerFor = (
    control: GodotControl,
    event: ControlGuiPointerEvent,
    pressed = event.pressed,
  ): ControlGuiPointerEvent => {
    const binding = controlBindings.get(control);
    if (binding === undefined) {
      throw new Error(
        'Control.grab_click_focus target is not retained in the active viewport/root.',
      );
    }
    const native = control as unknown as {
      toLocal?: (point: Readonly<{ x: number; y: number }>) => Readonly<{ x: number; y: number }>;
    };
    let local: ControlPoint;
    const element = binding.state.read(binding.id).focusElement;
    if (typeof native.toLocal === 'function') {
      const projected = native.toLocal(event.global);
      local = { x: projected.x, y: projected.y };
    } else if (element !== undefined && element !== null && element.isConnected) {
      const rect = element.getBoundingClientRect();
      local = { x: event.global.x - rect.left, y: event.global.y - rect.top };
    } else {
      throw new Error(
        'Control.grab_click_focus cannot project the active pointer into a Control without a retained DOM or Pixi transform.',
      );
    }
    return { ...event, local, pressed };
  };
  const dispatchPointer = (
    control: GodotControl,
    event: ControlGuiPointerEvent,
    pressed = event.pressed,
  ): void => {
    const binding = controlBindings.get(control);
    if (binding === undefined) return;
    const projected = pointerFor(control, event, pressed);
    const record = binding.state.read(binding.id);
    record.onControlGuiInput?.(projected);
    if (projected.kind !== 'button' || projected.button !== 0) return;
    if (pressed) record.onButtonPointerDown?.(projected.button);
    else record.onButtonPointerUp?.(projected.button);
  };
  const state: ControlState = {
    read(id) {
      return records.get(id) ?? EMPTY;
    },
    write(id, patch) {
      const previousElement = records.get(id)?.focusElement;
      const previousSize = records.get(id)?.size ?? authored.get(id)?.size;
      records.set(id, { ...(records.get(id) ?? EMPTY), ...patch });
      const nextSize = records.get(id)?.size ?? authored.get(id)?.size;
      if (Object.hasOwn(patch, 'focusElement') && patch.focusElement !== previousElement) {
        detachFocusElement(id);
        if (typeof HTMLElement !== 'undefined' && patch.focusElement instanceof HTMLElement) {
          attachFocusElement(id, patch.focusElement);
        } else if (focusOwner === controls.get(id)) {
          const control = controls.get(id);
          focusOwner = null;
          if (control !== undefined) {
            const binding = controlBindings.get(control);
            const root =
              focusRootByControl.get(control) ??
              (binding === undefined ? undefined : retainedControlRoot(control, binding));
            if (root !== undefined && focusOwnersByRoot.get(root) === control)
              focusOwnersByRoot.delete(root);
            focusRootByControl.delete(control);
          }
        }
      }
      if (
        previousSize !== undefined &&
        nextSize !== undefined &&
        (previousSize.x !== nextSize.x || previousSize.y !== nextSize.y)
      ) {
        records.get(id)?.onControlResized?.();
      }
      refresh();
    },
    register(id, value) {
      authored.set(id, value);
      const element = records.get(id)?.focusElement;
      const control = controls.get(id);
      if (
        typeof HTMLElement !== 'undefined' &&
        element instanceof HTMLElement &&
        control !== undefined
      ) {
        controlsByFocusElement.set(element, control);
      }
    },
    authored(id) {
      return authored.get(id);
    },
    seatControl(id, control) {
      controls.set(id, control);
      const element = records.get(id)?.focusElement;
      if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) {
        controlsByFocusElement.set(element, control);
        if (!focusListeners.has(id)) attachFocusElement(id, element);
      }
    },
    control(id) {
      return controls.get(id);
    },
    childControls(id) {
      return [...controls].flatMap(([childId, child]) =>
        authored.get(childId)?.parentId === id ? [child] : [],
      );
    },
    focusOwner() {
      return focusOwner;
    },
    releaseFocus(control) {
      if (control !== undefined && focusOwner !== control) return;
      const previous = focusOwner;
      focusOwner = null;
      if (previous !== null) {
        const previousBinding = controlBindings.get(previous);
        const root =
          focusRootByControl.get(previous) ??
          (previousBinding === undefined
            ? undefined
            : retainedControlRoot(previous, previousBinding));
        if (root !== undefined && focusOwnersByRoot.get(root) === previous)
          focusOwnersByRoot.delete(root);
        focusRootByControl.delete(previous);
      }
      if (previous === null) return;
      const previousBinding = controlBindings.get(previous);
      const element = previousBinding?.state.read(previousBinding.id).focusElement;
      if (
        element !== undefined &&
        element !== null &&
        element.ownerDocument.activeElement === element
      ) {
        element.blur();
      }
    },
    routePointer(control, event) {
      const binding = controlBindings.get(control);
      if (binding === undefined) return true;
      const pointer = pointerRootState(control, binding);
      if (event.kind === 'motion') retainedHoveredControl = control;
      if (event.kind === 'button') {
        if (event.pressed) {
          const beginsGesture = pointer.heldButtons.size === 0;
          pointer.heldButtons.add(event.button);
          if (pointer.owner === null) {
            pointer.owner = control;
            pointerRootByControl.set(control, pointerStateKey(control, binding));
          }
          if (beginsGesture && event.button === 0) {
            pointer.dragStart = { x: event.global.x, y: event.global.y };
            retainOutsidePointer(pointer, event);
          }
        } else {
          pointer.heldButtons.delete(event.button);
        }
      }
      pointer.last = event;
      positionDragPreview(pointer, event);
      if (
        event.kind === 'motion' &&
        !pointer.dragging &&
        pointer.owner !== null &&
        pointer.dragStart !== null &&
        pointer.heldButtons.has(0)
      ) {
        const dx = event.global.x - pointer.dragStart.x;
        const dy = event.global.y - pointer.dragStart.y;
        if (dx * dx + dy * dy >= 100) {
          const source = pointer.owner;
          const sourceBinding = controlBindings.get(source);
          const callback = sourceBinding?.state.read(sourceBinding.id).getDragData;
          if (callback !== undefined) {
            const local = pointerFor(source, event).local;
            const data = callback(local);
            if (data !== null && data !== undefined) {
              pointer.dragData = data;
              pointer.dragging = true;
            } else {
              releaseDragPreview(pointer);
            }
          }
        }
      }
      if (
        event.kind === 'button' &&
        !event.pressed &&
        pointer.dragging &&
        pointer.dragData !== null
      ) {
        const targetBinding = controlBindings.get(control);
        const targetRecord = targetBinding?.state.read(targetBinding.id);
        const canDrop = targetRecord?.canDropData;
        const drop = targetRecord?.dropData;
        if (
          canDrop !== undefined &&
          drop !== undefined &&
          canDrop(event.local, pointer.dragData) === true
        ) {
          drop(event.local, pointer.dragData);
        }
      }
      if (event.kind === 'motion' && pointer.dragging && pointer.dragData !== null) {
        const targetBinding = controlBindings.get(control);
        targetBinding?.state.read(targetBinding.id).canDropData?.(event.local, pointer.dragData);
      }
      if (pointer.owner !== null && pointer.owner !== control) {
        dispatchPointer(pointer.owner, event);
        if (event.kind === 'button' && !event.pressed && pointer.heldButtons.size === 0) {
          pointerRootByControl.delete(pointer.owner);
          pointer.owner = null;
          finishGuiDrag(pointer);
        }
        return false;
      }
      if (event.kind === 'button' && !event.pressed && pointer.heldButtons.size === 0) {
        if (pointer.owner !== null) pointerRootByControl.delete(pointer.owner);
        pointer.owner = null;
        finishGuiDrag(pointer);
      }
      return true;
    },
    grabClickFocus(control) {
      const controlBinding = controlBindings.get(control);
      if (controlBinding === undefined) return;
      const rootPointer = pointerRootState(control, controlBinding);
      if (
        rootPointer.owner === null ||
        rootPointer.owner === control ||
        rootPointer.last === null ||
        rootPointer.heldButtons.size === 0
      )
        return;
      // Godot defers this transfer until the current GUI dispatch finishes. A microtask provides
      // the same boundary without introducing a second scheduler beside the native event loop.
      const previous = rootPointer.owner;
      const pointer = rootPointer.last;
      queueMicrotask(() => {
        if (rootPointer.owner !== previous || rootPointer.heldButtons.size === 0) return;
        const binding = controlBindings.get(control);
        const element = binding?.state.read(binding.id).focusElement;
        const nativePixi =
          typeof (control as unknown as { toLocal?: unknown }).toLocal === 'function';
        if (
          pointer.transferCapture === undefined ||
          ((element === undefined || element === null) && !nativePixi)
        ) {
          throw new Error(
            'Control.grab_click_focus requires an active retained DOM/Pixi pointer capture target.',
          );
        }
        pointer.transferCapture(element ?? undefined);
        for (const button of rootPointer.heldButtons) {
          const event = { ...pointer, kind: 'button' as const, button };
          dispatchPointer(previous, event, false);
          dispatchPointer(control, event, true);
        }
        rootPointer.owner = control;
        pointerRootByControl.delete(previous);
        pointerRootByControl.set(control, pointerStateKey(control, controlBinding));
      });
    },
    removeControl(id, control) {
      if (controls.get(id) !== control) return;
      if (retainedHoveredControl === control) retainedHoveredControl = null;
      if (focusOwner === control) state.releaseFocus(control);
      const binding = controlBindings.get(control);
      const pointerRoot = pointerRootByControl.get(control);
      const pointer =
        pointerRoot === undefined
          ? binding === undefined
            ? undefined
            : pointerRootState(control, binding)
          : pointerStateByRoot.get(pointerRoot);
      if (pointer?.owner === control) {
        pointer.owner = null;
        pointer.heldButtons.clear();
        pointer.last = null;
        const root =
          pointerRoot ??
          (binding === undefined ? undefined : retainedControlRoot(control, binding));
        if (root !== undefined) finishGuiDrag(pointer);
      }
      pointerRootByControl.delete(control);
      focusRootByControl.delete(control);
      detachFocusElement(id);
      controls.delete(id);
      authored.delete(id);
      records.delete(id);
      const currentBinding = controlBindings.get(control);
      if (currentBinding?.state === state && currentBinding.id === id)
        controlBindings.delete(control);
      refresh();
    },
    retain(release) {
      releases.add(release);
    },
    clear() {
      state.releaseFocus();
      for (const release of releases) release();
      releases.clear();
      for (const [id, control] of controls) state.removeControl(id, control);
      for (const id of focusListeners.keys()) detachFocusElement(id);
      records.clear();
      authored.clear();
      controls.clear();
      refresh();
    },
    snapshot() {
      return snapshot;
    },
  };
  return state;
}

function authoredRecord(authored: AuthoredControl): ControlRecord {
  return {
    visible: authored.visible,
    text: authored.text,
    texture: authored.texture,
    ...(authored.viewportTexture === undefined
      ? {}
      : { viewportTexture: authored.viewportTexture }),
    position: authored.position,
    size: authored.size,
    custom_minimum_size: authored.custom_minimum_size,
    size_flags_horizontal: authored.size_flags_horizontal,
    size_flags_vertical: authored.size_flags_vertical,
    mouse_filter: authored.mouse_filter,
    focusMode: authored.focusMode,
    pivot_offset: authored.pivot_offset,
    scale: authored.scale,
    modulate: authored.modulate,
    self_modulate: authored.self_modulate,
    ...(authored.rotationDegrees === undefined
      ? {}
      : { rotationDegrees: authored.rotationDegrees }),
    ...(authored.z_index === undefined ? {} : { z_index: authored.z_index }),
    ...(authored.color === undefined ? {} : { color: authored.color }),
    ...(authored.referenceBorderColor === undefined
      ? {}
      : { referenceBorderColor: authored.referenceBorderColor }),
    ...(authored.referenceBorderWidth === undefined
      ? {}
      : { referenceBorderWidth: authored.referenceBorderWidth }),
    ...(authored.referenceEditorOnly === undefined
      ? {}
      : { referenceEditorOnly: authored.referenceEditorOnly }),
    ...(authored.fontFamily === undefined ? {} : { fontFamily: authored.fontFamily }),
    ...(authored.labelMaxLinesVisible === undefined
      ? {}
      : { labelMaxLinesVisible: authored.labelMaxLinesVisible }),
    ...(authored.labelHorizontalAlignment === undefined
      ? {}
      : { labelHorizontalAlignment: authored.labelHorizontalAlignment }),
    ...(authored.videoExpand === undefined ? {} : { videoExpand: authored.videoExpand }),
    ...(authored.tooltipText === undefined ? {} : { tooltipText: authored.tooltipText }),
  };
}

function globalPosition(
  id: string,
  authored: AuthoredControl,
  state: ControlState,
  seen: ReadonlySet<string> = new Set(),
): ControlPoint {
  if (seen.has(id)) throw new Error(`Godot Control parent cycle at '${id}'.`);
  const local = state.read(id).position ?? authored.position;
  const parentId = authored.parentId;
  const parentAuthored = parentId === undefined ? undefined : state.authored(parentId);
  if (parentId === undefined || parentAuthored === undefined) return { x: local.x, y: local.y };
  const nextSeen = new Set(seen);
  nextSeen.add(id);
  const parent = globalPosition(parentId, parentAuthored, state, nextSeen);
  return { x: parent.x + local.x, y: parent.y + local.y };
}

function composeControlTransform(
  parent: GodotTransform2D,
  child: GodotTransform2D,
): GodotTransform2D {
  return {
    x: {
      x: parent.x.x * child.x.x + parent.y.x * child.x.y,
      y: parent.x.y * child.x.x + parent.y.y * child.x.y,
    },
    y: {
      x: parent.x.x * child.y.x + parent.y.x * child.y.y,
      y: parent.x.y * child.y.x + parent.y.y * child.y.y,
    },
    origin: {
      x: parent.x.x * child.origin.x + parent.y.x * child.origin.y + parent.origin.x,
      y: parent.x.y * child.origin.x + parent.y.y * child.origin.y + parent.origin.y,
    },
  };
}

function controlGlobalTransform(
  id: string,
  authored: AuthoredControl,
  state: ControlState,
  seen: ReadonlySet<string> = new Set(),
): GodotTransform2D {
  if (seen.has(id)) throw new Error(`Godot Control parent cycle at '${id}'.`);
  const record = state.read(id);
  const position = record.position ?? authored.position;
  const scale = record.scale ?? authored.scale ?? { x: 1, y: 1 };
  const pivot = record.pivot_offset ?? authored.pivot_offset;
  const radians = ((record.rotationDegrees ?? authored.rotationDegrees ?? 0) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = { x: cosine * scale.x, y: sine * scale.x };
  const y = { x: -sine * scale.y, y: cosine * scale.y };
  const local: GodotTransform2D = {
    x,
    y,
    origin: {
      x: position.x + pivot.x - x.x * pivot.x - y.x * pivot.y,
      y: position.y + pivot.y - x.y * pivot.x - y.y * pivot.y,
    },
  };
  const parentId = authored.parentId;
  const parentAuthored = parentId === undefined ? undefined : state.authored(parentId);
  if (parentId === undefined || parentAuthored === undefined) return local;
  const nextSeen = new Set(seen);
  nextSeen.add(id);
  return composeControlTransform(
    controlGlobalTransform(parentId, parentAuthored, state, nextSeen),
    local,
  );
}

export function retainedControlGlobalTransform(control: object): GodotTransform2D {
  const binding = optionalControlBinding(control);
  if (binding === undefined)
    throw new Error('Control.get_global_transform requires a retained Control binding.');
  const authored = binding.state.authored(binding.id);
  if (authored === undefined) throw new Error(`Control '${binding.id}' has no authored layout.`);
  return controlGlobalTransform(binding.id, authored, binding.state);
}

function sizeFlags(value: number): number {
  if (!Number.isInteger(value) || value < 0 || (value & ~0xf) !== 0) {
    throw new Error(
      `Godot Control size flags must contain only FILL/EXPAND/SHRINK_CENTER/SHRINK_END bits; received ${String(value)}.`,
    );
  }
  return value;
}

function mouseFilter(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error(
      `Godot Control mouse_filter must be STOP (0), PASS (1), or IGNORE (2); received ${String(value)}.`,
    );
  }
  return value;
}

function controlColor(value: ControlColor, member: string): ControlColor {
  if (
    typeof value !== 'object' ||
    value === null ||
    ![value.r, value.g, value.b, value.a].every(
      (channel) => typeof channel === 'number' && Number.isFinite(channel),
    )
  ) {
    throw new TypeError(`Godot ${member} requires a finite Color.`);
  }
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

/** Seat one retained Godot Control API object on a caller-owned state. */
export function createControlHandle(
  id: string,
  authored: AuthoredControl,
  state: ControlState,
): GodotControl {
  state.register(id, authored);
  state.write(id, authoredRecord(authored));
  const control: GodotControl = {
    get visible() {
      return state.read(id).visible ?? authored.visible;
    },
    set visible(value) {
      state.write(id, { visible: value });
    },
    get text() {
      return state.read(id).text ?? authored.text;
    },
    set text(value) {
      state.write(id, { text: value });
    },
    get texture() {
      return state.read(id).texture ?? authored.texture;
    },
    set texture(value) {
      state.write(id, { texture: value });
    },
    get viewportTexture() {
      return state.read(id).viewportTexture ?? authored.viewportTexture;
    },
    set viewportTexture(value) {
      state.write(id, { viewportTexture: value });
    },
    get position() {
      return state.read(id).position ?? authored.position;
    },
    set position(value) {
      state.write(id, { position: { x: value.x, y: value.y } });
    },
    get rect_position() {
      return state.read(id).position ?? authored.position;
    },
    set rect_position(value) {
      state.write(id, { position: { x: value.x, y: value.y } });
    },
    get size() {
      return state.read(id).size ?? authored.size;
    },
    set size(value) {
      const minimum = state.read(id).custom_minimum_size ?? authored.custom_minimum_size;
      state.write(id, {
        size: { x: Math.max(value.x, minimum.x), y: Math.max(value.y, minimum.y) },
      });
    },
    get rect_size() {
      return state.read(id).size ?? authored.size;
    },
    set rect_size(value) {
      const minimum = state.read(id).custom_minimum_size ?? authored.custom_minimum_size;
      state.write(id, {
        size: { x: Math.max(value.x, minimum.x), y: Math.max(value.y, minimum.y) },
      });
    },
    get custom_minimum_size() {
      return state.read(id).custom_minimum_size ?? authored.custom_minimum_size;
    },
    set custom_minimum_size(value) {
      const current = state.read(id).size ?? authored.size;
      state.write(id, {
        custom_minimum_size: { x: value.x, y: value.y },
        size: { x: Math.max(current.x, value.x), y: Math.max(current.y, value.y) },
      });
    },
    get size_flags_horizontal() {
      return state.read(id).size_flags_horizontal ?? authored.size_flags_horizontal;
    },
    set size_flags_horizontal(value) {
      state.write(id, { size_flags_horizontal: sizeFlags(value) });
    },
    get size_flags_vertical() {
      return state.read(id).size_flags_vertical ?? authored.size_flags_vertical;
    },
    set size_flags_vertical(value) {
      state.write(id, { size_flags_vertical: sizeFlags(value) });
    },
    get mouse_filter() {
      return state.read(id).mouse_filter ?? authored.mouse_filter;
    },
    set mouse_filter(value) {
      state.write(id, { mouse_filter: mouseFilter(value) });
    },
    get pivot_offset() {
      return state.read(id).pivot_offset ?? authored.pivot_offset;
    },
    set pivot_offset(value) {
      state.write(id, { pivot_offset: { x: value.x, y: value.y } });
    },
    get scale() {
      return state.read(id).scale ?? authored.scale ?? { x: 1, y: 1 };
    },
    set scale(value) {
      if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
        throw new TypeError('Godot Control.scale requires a finite Vector2.');
      }
      state.write(id, { scale: { x: value.x, y: value.y } });
    },
    get global_position() {
      return globalPosition(id, authored, state);
    },
    set global_position(value) {
      const parentId = authored.parentId;
      const parentAuthored = parentId === undefined ? undefined : state.authored(parentId);
      if (parentId === undefined || parentAuthored === undefined) {
        state.write(id, { position: { x: value.x, y: value.y } });
        return;
      }
      const parent = globalPosition(parentId, parentAuthored, state);
      state.write(id, {
        position: { x: value.x - parent.x, y: value.y - parent.y },
      });
    },
    get modulate() {
      return state.read(id).modulate ?? authored.modulate;
    },
    set modulate(value) {
      state.write(id, {
        modulate: controlColor(value, 'CanvasItem.modulate'),
      });
    },
    get self_modulate() {
      return state.read(id).self_modulate ?? authored.self_modulate;
    },
    set self_modulate(value) {
      state.write(id, {
        self_modulate: controlColor(value, 'CanvasItem.self_modulate'),
      });
    },
    get z_index() {
      return state.read(id).z_index ?? authored.z_index ?? 0;
    },
    set z_index(value) {
      if (!Number.isSafeInteger(value) || value < -4096 || value > 4096) {
        throw new RangeError(
          'Godot CanvasItem.z_index requires an integer from -4096 through 4096.',
        );
      }
      state.write(id, { z_index: value });
    },
    get zIndex() {
      return state.read(id).z_index ?? authored.z_index ?? 0;
    },
    set zIndex(value) {
      control.z_index = value;
    },
    get color() {
      return state.read(id).color ?? authored.color ?? { r: 1, g: 1, b: 1, a: 1 };
    },
    set color(value) {
      state.write(id, { color: controlColor(value, 'ColorRect.color') });
    },
    get tooltip_text() {
      return state.read(id).tooltipText ?? authored.tooltipText ?? '';
    },
    set tooltip_text(value) {
      if (typeof value !== 'string')
        throw new TypeError('Godot Control.tooltip_text requires a String.');
      state.write(id, { tooltipText: value });
      const record = state.read(id);
      for (const element of [record.presentationElement, record.focusElement]) {
        if (element !== undefined && element !== null) element.title = value;
      }
    },
    set_visible(value) {
      state.write(id, { visible: value });
    },
    is_visible() {
      return state.read(id).visible ?? authored.visible;
    },
    show() {
      state.write(id, { visible: true });
    },
    hide() {
      state.write(id, { visible: false });
    },
    set_z_index(value) {
      control.z_index = value;
    },
    get_z_index() {
      return control.z_index;
    },
    get_global_position() {
      return control.global_position;
    },
    set_global_position(value) {
      control.global_position = value;
    },
    get_global_transform() {
      return retainedControlGlobalTransform(control);
    },
    get_global_transform_with_canvas() {
      return retainedControlGlobalTransform(control);
    },
    get_position() {
      return control.position;
    },
    set_position(value) {
      control.position = value;
    },
    get_size() {
      return control.size;
    },
    set_size(value) {
      control.size = value;
    },
    get_scale() {
      return control.scale;
    },
    set_scale(value) {
      control.scale = value;
    },
  };
  registerControlBinding(control, { id, state });
  state.write(id, {
    presentationElement: null,
    bindPresentationElement(element): void {
      state.write(id, { presentationElement: element });
      if (element !== null)
        element.title = state.read(id).tooltipText ?? authored.tooltipText ?? '';
    },
  });
  state.retain(
    bindControlThemeConsumer(
      control,
      (theme, themeTypeVariation) => {
        const themeFontFamily = controlThemeFontFamily(control, 'font', authored.fontFamily);
        const themeFontSize = controlThemeResolvedFontSize(control, 'font', 'font_size');
        state.write(id, {
          theme,
          themeTypeVariation,
          themeFontColorOverride: controlThemeColorOverride(control, 'font_color'),
          themeFontSizeOverride: controlThemeFontSizeOverride(control, 'font_size'),
          themeFontOutline: controlThemeFontOutline(control, 'font'),
          ...(themeFontFamily === undefined ? {} : { themeFontFamily }),
          ...(themeFontSize === undefined ? {} : { themeFontSize }),
        });
      },
      () => (authored.parentId === undefined ? null : (state.control(authored.parentId) ?? null)),
    ),
  );
  return control;
}

/** Resolve the authored literals plus any later script writes for native JSX. */
export function controlValue(
  state: ControlSnapshot,
  id: string,
  authored: AuthoredControl,
): AuthoredControl & ControlRecord & { readonly color: ControlColor } {
  const current = state[id];
  return {
    ...authored,
    ...current,
    color: current?.color ?? authored.color ?? { r: 1, g: 1, b: 1, a: 1 },
  };
}

export interface ControlRuntime {
  readonly gameControlState: ControlState;
  readonly getControlState: () => ControlSnapshot;
  readonly controlHandle: (
    id: string,
    authored: AuthoredControl,
    state?: ControlState,
  ) => GodotControl;
  readonly resetControlState: (state?: ControlState) => void;
}

/** Create the one Control binding owned by a translated port. */
export function createControlRuntime(): ControlRuntime {
  const gameControlState = createControlState();
  return {
    gameControlState,
    getControlState: () => gameControlState.snapshot(),
    controlHandle: (id, authored, state = gameControlState) =>
      createControlHandle(id, authored, state),
    resetControlState: (state = gameControlState) => state.clear(),
  };
}
