/** Surface-independent Node state that Godot retains outside renderer objects. */

import { createSignal, type GodotSignal, type SignalHandle } from './signal';

export const GODOT_NODE_AUTO_TRANSLATE_MODE = Object.freeze({
  INHERIT: 0,
  ALWAYS: 1,
  DISABLED: 2,
} as const);

export const GODOT_NODE_PHYSICS_INTERPOLATION_MODE = Object.freeze({
  INHERIT: 0,
  ON: 1,
  OFF: 2,
} as const);

export const GODOT_NODE_PROCESS_THREAD_GROUP = Object.freeze({
  INHERIT: 0,
  MAIN_THREAD: 1,
  SUB_THREAD: 2,
} as const);

export const GODOT_NODE_PROCESS_THREAD_MESSAGES = Object.freeze({
  PROCESS: 1,
  PHYSICS: 2,
  ALL: 3,
} as const);

interface NodeCoreState {
  autoTranslateMode: number;
  editorDescription: string;
  physicsInterpolationMode: number;
  physicsProcessPriority: number;
  processInternal: boolean;
  physicsProcessInternal: boolean;
  shortcutInput: boolean;
  processThreadGroup: number;
  processThreadGroupOrder: number;
  processThreadMessages: number;
  sceneInstanceLoadPlaceholder: boolean;
  translationDomainInherited: boolean;
  displayedFolded: boolean;
}

const STATES = new WeakMap<object, NodeCoreState>();
const EDITOR_DESCRIPTION_CHANGED = new WeakMap<object, SignalHandle<[]>>();

function stateOf(node: object): NodeCoreState {
  let state = STATES.get(node);
  if (state !== undefined) return state;
  state = {
    autoTranslateMode: GODOT_NODE_AUTO_TRANSLATE_MODE.INHERIT,
    editorDescription: '',
    physicsInterpolationMode: GODOT_NODE_PHYSICS_INTERPOLATION_MODE.INHERIT,
    physicsProcessPriority: 0,
    processInternal: false,
    physicsProcessInternal: false,
    shortcutInput: false,
    processThreadGroup: GODOT_NODE_PROCESS_THREAD_GROUP.INHERIT,
    processThreadGroupOrder: 0,
    processThreadMessages: GODOT_NODE_PROCESS_THREAD_MESSAGES.ALL,
    sceneInstanceLoadPlaceholder: false,
    translationDomainInherited: true,
    displayedFolded: false,
  };
  STATES.set(node, state);
  return state;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Node.${member} requires bool.`);
  return value;
}

function integer(value: unknown, member: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Node.${member} requires int.`);
  return value as number;
}

function enumValue(value: unknown, min: number, max: number, member: string): number {
  const result = integer(value, member);
  if (result < min || result > max) throw new RangeError(`Node.${member} requires enum ${min}..${max}.`);
  return result;
}

export function getNodeAutoTranslateMode(node: object): number {
  return stateOf(node).autoTranslateMode;
}

export function setNodeAutoTranslateMode(node: object, mode: unknown): void {
  stateOf(node).autoTranslateMode = enumValue(mode, 0, 2, 'auto_translate_mode');
}

export function canNodeAutoTranslate(node: object, inherited = true): boolean {
  const mode = stateOf(node).autoTranslateMode;
  if (mode === GODOT_NODE_AUTO_TRANSLATE_MODE.ALWAYS) return true;
  if (mode === GODOT_NODE_AUTO_TRANSLATE_MODE.DISABLED) return false;
  return inherited;
}

export function getNodeEditorDescription(node: object): string {
  return stateOf(node).editorDescription;
}

export function setNodeEditorDescription(node: object, value: unknown): void {
  if (typeof value !== 'string') throw new TypeError('Node.editor_description requires String.');
  const state = stateOf(node);
  if (state.editorDescription === value) return;
  state.editorDescription = value;
  let changed = EDITOR_DESCRIPTION_CHANGED.get(node);
  if (changed === undefined) {
    changed = createSignal<[]>();
    EDITOR_DESCRIPTION_CHANGED.set(node, changed);
  }
  changed.emit();
}

export function getNodeEditorDescriptionChangedSignal(node: object): GodotSignal<[]> {
  let changed = EDITOR_DESCRIPTION_CHANGED.get(node);
  if (changed === undefined) {
    changed = createSignal<[]>();
    EDITOR_DESCRIPTION_CHANGED.set(node, changed);
  }
  return changed.signal;
}

export function getNodePhysicsInterpolationMode(node: object): number {
  return stateOf(node).physicsInterpolationMode;
}

export function setNodePhysicsInterpolationMode(node: object, mode: unknown): void {
  stateOf(node).physicsInterpolationMode = enumValue(mode, 0, 2, 'physics_interpolation_mode');
}

export function isNodePhysicsInterpolated(node: object, inherited = true): boolean {
  const mode = stateOf(node).physicsInterpolationMode;
  if (mode === GODOT_NODE_PHYSICS_INTERPOLATION_MODE.ON) return true;
  if (mode === GODOT_NODE_PHYSICS_INTERPOLATION_MODE.OFF) return false;
  return inherited;
}

export function getNodePhysicsProcessPriority(node: object): number {
  return stateOf(node).physicsProcessPriority;
}

export function setNodePhysicsProcessPriority(node: object, priority: unknown): void {
  stateOf(node).physicsProcessPriority = integer(priority, 'process_physics_priority');
}

export function isNodeProcessingInternal(node: object): boolean {
  return stateOf(node).processInternal;
}

export function setNodeProcessInternal(node: object, enabled: unknown): void {
  stateOf(node).processInternal = boolean(enabled, 'set_process_internal');
}

export function isNodePhysicsProcessingInternal(node: object): boolean {
  return stateOf(node).physicsProcessInternal;
}

export function setNodePhysicsProcessInternal(node: object, enabled: unknown): void {
  stateOf(node).physicsProcessInternal = boolean(enabled, 'set_physics_process_internal');
}

export function isNodeProcessingShortcutInput(node: object): boolean {
  return stateOf(node).shortcutInput;
}

export function setNodeProcessShortcutInput(node: object, enabled: unknown): void {
  stateOf(node).shortcutInput = boolean(enabled, 'set_process_shortcut_input');
}

export function getNodeProcessThreadGroup(node: object): number {
  return stateOf(node).processThreadGroup;
}

export function setNodeProcessThreadGroup(node: object, group: unknown): void {
  stateOf(node).processThreadGroup = enumValue(group, 0, 2, 'process_thread_group');
}

export function getNodeProcessThreadGroupOrder(node: object): number {
  return stateOf(node).processThreadGroupOrder;
}

export function setNodeProcessThreadGroupOrder(node: object, order: unknown): void {
  stateOf(node).processThreadGroupOrder = integer(order, 'process_thread_group_order');
}

export function getNodeProcessThreadMessages(node: object): number {
  return stateOf(node).processThreadMessages;
}

export function setNodeProcessThreadMessages(node: object, messages: unknown): void {
  stateOf(node).processThreadMessages = enumValue(messages, 0, 3, 'process_thread_messages');
}

export function isNodeSceneInstanceLoadPlaceholder(node: object): boolean {
  return stateOf(node).sceneInstanceLoadPlaceholder;
}

export function setNodeSceneInstanceLoadPlaceholder(node: object, enabled: unknown): void {
  stateOf(node).sceneInstanceLoadPlaceholder = boolean(enabled, 'scene_instance_load_placeholder');
}

export function isNodeTranslationDomainInherited(node: object): boolean {
  return stateOf(node).translationDomainInherited;
}

export function setNodeTranslationDomainInherited(node: object, enabled: unknown): void {
  stateOf(node).translationDomainInherited = boolean(enabled, 'translation_domain_inherited');
}

export function isNodeDisplayedFolded(node: object): boolean {
  return stateOf(node).displayedFolded;
}

export function setNodeDisplayedFolded(node: object, enabled: unknown): void {
  stateOf(node).displayedFolded = boolean(enabled, 'displayed_folded');
}
