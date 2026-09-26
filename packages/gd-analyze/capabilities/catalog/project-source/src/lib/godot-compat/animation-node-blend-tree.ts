import { createSignal, type GodotSignal } from './signal';

export const GODOT_BLEND_TREE_CONNECTION_OK = 0;
export const GODOT_BLEND_TREE_CONNECTION_ERROR_NO_INPUT = 1;
export const GODOT_BLEND_TREE_CONNECTION_ERROR_NO_INPUT_INDEX = 2;
export const GODOT_BLEND_TREE_CONNECTION_ERROR_NO_OUTPUT = 3;
export const GODOT_BLEND_TREE_CONNECTION_ERROR_SAME_NODE = 4;
export const GODOT_BLEND_TREE_CONNECTION_ERROR_CONNECTION_EXISTS = 5;

export interface GodotAnimationBlendTreeNode {
  get_input_count?(): number;
  readonly inputCount?: number;
  readonly [key: string]: unknown;
}

export interface GodotAnimationBlendTreeConnection {
  inputNode: string;
  inputIndex: number;
  outputNode: string;
}

export class GodotAnimationNodeBlendTree {
  private readonly nodes = new Map<string, GodotAnimationBlendTreeNode>();
  private readonly positions = new Map<string, Readonly<{ x: number; y: number }>>();
  private readonly connections = new Map<string, GodotAnimationBlendTreeConnection>();
  private readonly nodeChangedSignal = createSignal<readonly [string]>();
  private graphOffset = { x: 0, y: 0 };

  readonly node_changed: GodotSignal<readonly [string]> = this.nodeChangedSignal.signal;

  constructor() {
    this.nodes.set('output', { inputCount: 1 });
    this.positions.set('output', { x: 300, y: 150 });
  }

  add_node(name: string, node: GodotAnimationBlendTreeNode, position: Readonly<{ x: number; y: number }> = { x: 0, y: 0 }): void {
    this.validateName(name);
    if (this.nodes.has(name)) throw new Error(`AnimationNodeBlendTree already has node ${name}.`);
    this.nodes.set(name, node);
    this.positions.set(name, this.vector(position));
    this.nodeChangedSignal.emit(name);
  }

  get_node(name: string): GodotAnimationBlendTreeNode | null { return this.nodes.get(name) ?? null; }

  remove_node(name: string): void {
    if (name === 'output' || !this.nodes.delete(name)) return;
    this.positions.delete(name);
    for (const [key, connection] of this.connections) {
      if (connection.inputNode === name || connection.outputNode === name) this.connections.delete(key);
    }
    this.nodeChangedSignal.emit(name);
  }

  rename_node(name: string, newName: string): void {
    this.validateName(newName);
    if (name === 'output' || name === newName || this.nodes.has(newName)) return;
    const node = this.nodes.get(name);
    if (node === undefined) return;
    const position = this.positions.get(name) ?? { x: 0, y: 0 };
    this.nodes.delete(name);
    this.positions.delete(name);
    this.nodes.set(newName, node);
    this.positions.set(newName, position);
    const replacements = [...this.connections.values()].map((connection) => ({
      inputNode: connection.inputNode === name ? newName : connection.inputNode,
      inputIndex: connection.inputIndex,
      outputNode: connection.outputNode === name ? newName : connection.outputNode,
    }));
    this.connections.clear();
    for (const connection of replacements) this.connections.set(this.key(connection.inputNode, connection.inputIndex), connection);
    this.nodeChangedSignal.emit(newName);
  }

  has_node(name: string): boolean { return this.nodes.has(name); }

  connect_node(inputNode: string, inputIndex: number, outputNode: string): number {
    const input = this.nodes.get(inputNode);
    if (input === undefined) return GODOT_BLEND_TREE_CONNECTION_ERROR_NO_INPUT;
    if (!Number.isSafeInteger(inputIndex) || inputIndex < 0 || inputIndex >= this.inputCount(input)) {
      return GODOT_BLEND_TREE_CONNECTION_ERROR_NO_INPUT_INDEX;
    }
    if (!this.nodes.has(outputNode)) return GODOT_BLEND_TREE_CONNECTION_ERROR_NO_OUTPUT;
    if (inputNode === outputNode) return GODOT_BLEND_TREE_CONNECTION_ERROR_SAME_NODE;
    const key = this.key(inputNode, inputIndex);
    if (this.connections.has(key)) return GODOT_BLEND_TREE_CONNECTION_ERROR_CONNECTION_EXISTS;
    this.connections.set(key, { inputNode, inputIndex, outputNode });
    this.nodeChangedSignal.emit(inputNode);
    return GODOT_BLEND_TREE_CONNECTION_OK;
  }

  disconnect_node(inputNode: string, inputIndex: number): void {
    if (this.connections.delete(this.key(inputNode, inputIndex))) this.nodeChangedSignal.emit(inputNode);
  }

  get_node_list(): readonly string[] { return [...this.nodes.keys()].sort(); }

  set_node_position(name: string, position: Readonly<{ x: number; y: number }>): void {
    if (!this.nodes.has(name)) throw new Error(`AnimationNodeBlendTree has no node ${name}.`);
    this.positions.set(name, this.vector(position));
    this.nodeChangedSignal.emit(name);
  }

  get_node_position(name: string): Readonly<{ x: number; y: number }> {
    return this.positions.get(name) ?? { x: 0, y: 0 };
  }

  set_graph_offset(offset: Readonly<{ x: number; y: number }>): void { this.graphOffset = this.vector(offset); }
  get_graph_offset(): Readonly<{ x: number; y: number }> { return this.graphOffset; }
  get_connections(): readonly GodotAnimationBlendTreeConnection[] { return [...this.connections.values()]; }
  get_connection(inputNode: string, inputIndex: number): GodotAnimationBlendTreeConnection | null {
    return this.connections.get(this.key(inputNode, inputIndex)) ?? null;
  }

  private inputCount(node: GodotAnimationBlendTreeNode): number {
    const count = node.get_input_count?.() ?? node.inputCount ?? 0;
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  }

  private key(inputNode: string, inputIndex: number): string { return `${inputNode}\u0000${inputIndex}`; }
  private validateName(name: string): void { if (name === '' || name.includes('/')) throw new TypeError('AnimationNodeBlendTree node name is invalid.'); }
  private vector(value: Readonly<{ x: number; y: number }>): Readonly<{ x: number; y: number }> {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError('AnimationNodeBlendTree position must be finite.');
    return { x: value.x, y: value.y };
  }
}

export function createGodotAnimationNodeBlendTree(): GodotAnimationNodeBlendTree {
  return new GodotAnimationNodeBlendTree();
}
