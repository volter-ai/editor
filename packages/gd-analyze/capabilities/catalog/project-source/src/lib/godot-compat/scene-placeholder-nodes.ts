import { Object3D } from 'three';
import { registerGodotObjectIdentity } from './object';
import type { GodotPackedSceneResource } from './packed-scene';

export interface GodotInstancePlaceholderResolver {
  load(path: string): GodotPackedSceneResource<Object3D> | Object3D | null;
}

function string(member: string, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} requires String.`);
  return value;
}

function instantiate(value: GodotPackedSceneResource<Object3D> | Object3D, member: string): Object3D {
  if (value instanceof Object3D) return value.clone(true);
  if (typeof value.instantiate !== 'function' || !value.can_instantiate()) {
    throw new Error(`${member} requires an instantiable PackedScene.`);
  }
  const result = value.instantiate();
  if (!(result instanceof Object3D)) throw new TypeError(`${member} PackedScene root must be Node3D-compatible.`);
  return result;
}

export class GodotInstancePlaceholder extends Object3D {
  private instancePathValue: string;
  private resolver: GodotInstancePlaceholderResolver | null;
  private replacement: Object3D | null = null;

  constructor(instancePath = '', resolver: GodotInstancePlaceholderResolver | null = null) {
    super();
    this.instancePathValue = string('InstancePlaceholder.instance_path', instancePath);
    this.resolver = resolver;
    registerGodotObjectIdentity(this, 'InstancePlaceholder');
  }

  set_instance_path(value: string): void { this.instancePathValue = string('InstancePlaceholder.instance_path', value); }
  get_instance_path(): string { return this.instancePathValue; }
  set_resolver(value: GodotInstancePlaceholderResolver | null): void { this.resolver = value; }
  get_resolver(): GodotInstancePlaceholderResolver | null { return this.resolver; }

  create_instance(replace = false, customScene: GodotPackedSceneResource<Object3D> | Object3D | null = null): Object3D | null {
    if (typeof replace !== 'boolean') throw new TypeError('InstancePlaceholder.create_instance replace requires bool.');
    const source = customScene ?? this.resolveInstance();
    if (source === null) return null;
    const created = instantiate(source, 'InstancePlaceholder.create_instance');
    created.name = this.name;
    created.position.copy(this.position);
    created.quaternion.copy(this.quaternion);
    created.scale.copy(this.scale);
    created.visible = this.visible;
    created.renderOrder = this.renderOrder;
    created.layers.mask = this.layers.mask;
    created.userData = { ...this.userData, ...created.userData };
    if (replace) this.replaceWith(created);
    else this.add(created);
    this.replacement = created;
    return created;
  }

  get_last_instance(): Object3D | null { return this.replacement; }
  clear_last_instance(removeFromTree = false): void {
    if (removeFromTree && this.replacement !== null) this.replacement.removeFromParent();
    this.replacement = null;
  }

  private resolveInstance(): GodotPackedSceneResource<Object3D> | Object3D | null {
    if (this.instancePathValue === '') throw new Error('InstancePlaceholder has no instance path.');
    if (this.resolver === null) throw new Error('InstancePlaceholder requires a resource resolver.');
    return this.resolver.load(this.instancePathValue);
  }

  private replaceWith(created: Object3D): void {
    const parent = this.parent;
    if (parent === null) return;
    const index = parent.children.indexOf(this);
    parent.remove(this);
    parent.add(created);
    const current = parent.children.indexOf(created);
    if (current !== index && index >= 0) {
      parent.children.splice(current, 1);
      parent.children.splice(index, 0, created);
    }
  }
}

interface MissingNodeState {
  originalClass: string;
  originalScene: string;
  recordingProperties: boolean;
  readonly properties: Map<string, unknown>;
}

export interface GodotMissingNodeProperty {
  readonly name: string;
  readonly value: unknown;
}

const MISSING_NODES = new WeakMap<GodotMissingNode, MissingNodeState>();

export class GodotMissingNode extends Object3D {
  constructor(originalClass = '', originalScene = '') {
    super();
    MISSING_NODES.set(this, {
      originalClass: string('MissingNode.original_class', originalClass),
      originalScene: string('MissingNode.original_scene', originalScene),
      recordingProperties: false,
      properties: new Map(),
    });
    registerGodotObjectIdentity(this, 'MissingNode');
  }

  set_original_class(value: string): void { this.state().originalClass = string('MissingNode.original_class', value); }
  get_original_class(): string { return this.state().originalClass; }
  set_original_scene(value: string): void { this.state().originalScene = string('MissingNode.original_scene', value); }
  get_original_scene(): string { return this.state().originalScene; }
  set_recording_properties(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('MissingNode.recording_properties requires bool.');
    this.state().recordingProperties = value;
  }
  is_recording_properties(): boolean { return this.state().recordingProperties; }

  set_missing_property(name: string, value: unknown): boolean {
    const key = string('MissingNode property name', name);
    if (!this.state().recordingProperties) return false;
    this.state().properties.set(key, value);
    return true;
  }
  get_missing_property(name: string): unknown { return this.state().properties.get(string('MissingNode property name', name)); }
  has_missing_property(name: string): boolean { return this.state().properties.has(string('MissingNode property name', name)); }
  remove_missing_property(name: string): boolean { return this.state().properties.delete(string('MissingNode property name', name)); }
  clear_missing_properties(): void { this.state().properties.clear(); }
  get_missing_property_list(): GodotMissingNodeProperty[] {
    return [...this.state().properties].map(([name, value]) => ({ name, value }));
  }
  get_missing_property_names(): string[] { return [...this.state().properties.keys()]; }

  restore(factory: (originalClass: string, originalScene: string) => Object3D | null, replace = true): Object3D | null {
    if (typeof factory !== 'function') throw new TypeError('MissingNode.restore requires Callable factory.');
    const state = this.state();
    const restored = factory(state.originalClass, state.originalScene);
    if (restored === null) return null;
    if (!(restored instanceof Object3D)) throw new TypeError('MissingNode.restore factory must return Node3D or null.');
    restored.name = this.name;
    restored.position.copy(this.position);
    restored.quaternion.copy(this.quaternion);
    restored.scale.copy(this.scale);
    restored.visible = this.visible;
    restored.layers.mask = this.layers.mask;
    const record = restored as unknown as Record<string, unknown>;
    for (const [name, value] of state.properties) record[name] = value;
    if (replace && this.parent !== null) {
      const parent = this.parent;
      const index = parent.children.indexOf(this);
      parent.remove(this);
      parent.add(restored);
      const current = parent.children.indexOf(restored);
      if (index >= 0 && index !== current) {
        parent.children.splice(current, 1);
        parent.children.splice(index, 0, restored);
      }
    }
    return restored;
  }

  duplicate_missing(): GodotMissingNode {
    const state = this.state();
    const copy = new GodotMissingNode(state.originalClass, state.originalScene);
    copy.name = this.name;
    copy.position.copy(this.position);
    copy.quaternion.copy(this.quaternion);
    copy.scale.copy(this.scale);
    copy.visible = this.visible;
    copy.set_recording_properties(state.recordingProperties);
    for (const [name, value] of state.properties) copy.state().properties.set(name, value);
    for (const child of this.children) copy.add(child.clone(true));
    return copy;
  }

  private state(): MissingNodeState {
    const value = MISSING_NODES.get(this);
    if (value === undefined) throw new Error('MissingNode retained state is unavailable.');
    return value;
  }
}

export const createGodotInstancePlaceholder = (path = '', resolver: GodotInstancePlaceholderResolver | null = null): GodotInstancePlaceholder => new GodotInstancePlaceholder(path, resolver);
export const createGodotMissingNode = (originalClass = '', originalScene = ''): GodotMissingNode => new GodotMissingNode(originalClass, originalScene);
