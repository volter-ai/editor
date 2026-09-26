import { registerGodotObjectIdentity } from './object';

export interface GodotSceneStateProperty { name: string; value: unknown }
export interface GodotSceneStateNode {
  type: string;
  name: string;
  path: string;
  ownerPath: string;
  index: number;
  instance: unknown;
  instancePlaceholder: string;
  groups: string[];
  properties: GodotSceneStateProperty[];
}
export interface GodotSceneStateConnection {
  sourceNode: string;
  targetNode: string;
  signal: string;
  method: string;
  flags: number;
  binds: unknown[];
  unbinds: number;
}

function copyNode(node: GodotSceneStateNode): GodotSceneStateNode {
  return { ...node, groups: [...node.groups], properties: node.properties.map((property) => ({ ...property })) };
}

export class GodotSceneState {
  private readonly nodes: GodotSceneStateNode[] = [];
  private readonly connections: GodotSceneStateConnection[] = [];
  private sceneFilePath = '';

  constructor() { registerGodotObjectIdentity(this, 'SceneState'); }

  set_scene_file_path(path: string): void { this.sceneFilePath = path; }
  get_scene_file_path(): string { return this.sceneFilePath; }

  add_node(node: Partial<GodotSceneStateNode> & Pick<GodotSceneStateNode, 'name'>): number {
    const index = this.nodes.length;
    this.nodes.push({
      type: node.type ?? 'Node', name: node.name, path: node.path ?? node.name, ownerPath: node.ownerPath ?? '',
      index: node.index ?? index, instance: node.instance ?? null, instancePlaceholder: node.instancePlaceholder ?? '',
      groups: [...(node.groups ?? [])], properties: (node.properties ?? []).map((property) => ({ ...property })),
    });
    return index;
  }

  remove_node(index: number): void { if (index >= 0 && index < this.nodes.length) this.nodes.splice(index, 1); }
  clear_nodes(): void { this.nodes.length = 0; }
  get_node_count(): number { return this.nodes.length; }
  get_node_type(index: number): string { return this.nodes[index]?.type ?? ''; }
  get_node_name(index: number): string { return this.nodes[index]?.name ?? ''; }
  get_node_path(index: number, forParent = false): string {
    const path = this.nodes[index]?.path ?? '';
    if (!forParent) return path;
    const separator = path.lastIndexOf('/'); return separator < 0 ? '' : path.slice(0, separator);
  }
  get_node_owner_path(index: number): string { return this.nodes[index]?.ownerPath ?? ''; }
  get_node_index(index: number): number { return this.nodes[index]?.index ?? -1; }
  get_node_instance(index: number): unknown { return this.nodes[index]?.instance ?? null; }
  is_node_instance_placeholder(index: number): boolean { return (this.nodes[index]?.instancePlaceholder ?? '') !== ''; }
  get_node_instance_placeholder(index: number): string { return this.nodes[index]?.instancePlaceholder ?? ''; }
  get_node_groups(index: number): string[] { return [...(this.nodes[index]?.groups ?? [])]; }
  get_node_record(index: number): GodotSceneStateNode | null { const node = this.nodes[index]; return node ? copyNode(node) : null; }

  add_node_group(index: number, group: string): void {
    const node = this.nodes[index]; if (node && !node.groups.includes(group)) node.groups.push(group);
  }
  add_node_property(index: number, name: string, value: unknown): void {
    const node = this.nodes[index]; if (!node) return;
    const current = node.properties.find((property) => property.name === name);
    if (current) current.value = value; else node.properties.push({ name, value });
  }
  get_node_property_count(index: number): number { return this.nodes[index]?.properties.length ?? 0; }
  get_node_property_name(index: number, property: number): string { return this.nodes[index]?.properties[property]?.name ?? ''; }
  get_node_property_value(index: number, property: number): unknown { return this.nodes[index]?.properties[property]?.value ?? null; }
  find_node_by_path(path: string): number { return this.nodes.findIndex((node) => node.path === path); }
  find_node_by_name(name: string): number { return this.nodes.findIndex((node) => node.name === name); }

  add_connection(connection: GodotSceneStateConnection): number {
    this.connections.push({ ...connection, binds: [...connection.binds] }); return this.connections.length - 1;
  }
  remove_connection(index: number): void { if (index >= 0 && index < this.connections.length) this.connections.splice(index, 1); }
  clear_connections(): void { this.connections.length = 0; }
  get_connection_count(): number { return this.connections.length; }
  get_connection_source(index: number): string { return this.connections[index]?.sourceNode ?? ''; }
  get_connection_source_node(index: number): string { return this.get_connection_source(index); }
  get_connection_target(index: number): string { return this.connections[index]?.targetNode ?? ''; }
  get_connection_target_node(index: number): string { return this.get_connection_target(index); }
  get_connection_signal(index: number): string { return this.connections[index]?.signal ?? ''; }
  get_connection_method(index: number): string { return this.connections[index]?.method ?? ''; }
  get_connection_flags(index: number): number { return this.connections[index]?.flags ?? 0; }
  get_connection_binds(index: number): unknown[] { return [...(this.connections[index]?.binds ?? [])]; }
  get_connection_unbinds(index: number): number { return this.connections[index]?.unbinds ?? 0; }

  duplicate(): GodotSceneState {
    const state = new GodotSceneState(); state.sceneFilePath = this.sceneFilePath;
    for (const node of this.nodes) state.nodes.push(copyNode(node));
    for (const connection of this.connections) state.connections.push({ ...connection, binds: [...connection.binds] });
    return state;
  }
}

export const createGodotSceneState = (): GodotSceneState => new GodotSceneState();
