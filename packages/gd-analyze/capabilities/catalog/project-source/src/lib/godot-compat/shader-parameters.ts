import type { Material, Object3D } from 'three';

export interface GodotGlobalShaderParameterSnapshot {
  readonly name: string;
  readonly type: number;
  readonly defaultValue: unknown;
  readonly value: unknown;
  readonly overrideValue: unknown;
  readonly effectiveValue: unknown;
  readonly revision: number;
}

interface GlobalParameterState {
  name: string;
  type: number;
  defaultValue: unknown;
  value: unknown;
  overrideValue: unknown;
  revision: number;
}

export interface GodotInstanceShaderParametersSnapshot {
  readonly parameters: ReadonlyMap<string, unknown>;
  readonly revision: number;
}

interface InstanceParameterState {
  parameters: Map<string, unknown>;
  revision: number;
  watchers: Set<(snapshot: GodotInstanceShaderParametersSnapshot, changedName: string) => void>;
}

const GLOBALS = new Map<string, GlobalParameterState>();
const GLOBAL_WATCHERS = new Set<(snapshot: GodotGlobalShaderParameterSnapshot | null, changedName: string) => void>();
const INSTANCES = new WeakMap<object, InstanceParameterState>();

function nameOf(value: unknown, member: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`godot-compat: ${member} requires StringName.`);
  const name = String(value);
  if (name.length === 0) throw new RangeError(`godot-compat: ${member} requires non-empty name.`);
  return name;
}

function parameterType(value: unknown, member: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0x7fff_ffff) throw new RangeError(`godot-compat: ${member} requires non-negative integer type.`);
  return value as number;
}

function globalOf(value: unknown, member: string): GlobalParameterState {
  const name = nameOf(value, member), state = GLOBALS.get(name);
  if (state === undefined) throw new RangeError(`godot-compat: RenderingServer.${member} unknown global shader parameter ${name}.`);
  return state;
}

function effective(state: GlobalParameterState): unknown { return state.overrideValue === undefined ? state.value : state.overrideValue; }

function globalSnapshot(state: GlobalParameterState): GodotGlobalShaderParameterSnapshot {
  return Object.freeze({ name: state.name, type: state.type, defaultValue: state.defaultValue, value: state.value, overrideValue: state.overrideValue, effectiveValue: effective(state), revision: state.revision });
}

function publishGlobal(state: GlobalParameterState | null, changedName: string): void {
  if (state !== null) state.revision += 1;
  const snapshot = state === null ? null : globalSnapshot(state);
  for (const watcher of GLOBAL_WATCHERS) watcher(snapshot, changedName);
}

function instanceState(target: object): InstanceParameterState {
  let state = INSTANCES.get(target);
  if (state === undefined) { state = { parameters: new Map(), revision: 0, watchers: new Set() }; INSTANCES.set(target, state); }
  return state;
}

function instanceSnapshot(state: InstanceParameterState): GodotInstanceShaderParametersSnapshot {
  return Object.freeze({ parameters: new Map(state.parameters), revision: state.revision });
}

function materialsOf(target: object): Material[] {
  const materials: Material[] = [];
  const root = target as Partial<Object3D> & { material?: Material | Material[] };
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) for (const one of value) collect(one);
    else if (typeof value === 'object' && value !== null && 'isMaterial' in value) materials.push(value as Material);
  };
  collect(root.material);
  root.traverse?.((child) => collect(Reflect.get(child, 'material')));
  return materials;
}

function applyMaterialParameter(material: Material, name: string, value: unknown): void {
  const uniforms = Reflect.get(material, 'uniforms') as Record<string, { value: unknown }> | undefined;
  if (uniforms?.[name] !== undefined) uniforms[name].value = value;
  material.userData['godotInstanceShaderParameters'] ??= {};
  (material.userData['godotInstanceShaderParameters'] as Record<string, unknown>)[name] = value;
  material.needsUpdate = true;
}

export function godotRenderingServerGlobalShaderParameterAdd(nameValue: unknown, typeValue: unknown, defaultValue: unknown): void {
  const name = nameOf(nameValue, 'global_shader_parameter_add.name');
  if (GLOBALS.has(name)) throw new Error(`godot-compat: RenderingServer.global_shader_parameter_add duplicate ${name}.`);
  const state: GlobalParameterState = { name, type: parameterType(typeValue, 'global_shader_parameter_add.type'), defaultValue, value: defaultValue, overrideValue: undefined, revision: 0 };
  GLOBALS.set(name, state); publishGlobal(state, name);
}

export function godotRenderingServerGlobalShaderParameterRemove(nameValue: unknown): void {
  const name = nameOf(nameValue, 'global_shader_parameter_remove.name');
  if (!GLOBALS.delete(name)) throw new RangeError(`godot-compat: RenderingServer.global_shader_parameter_remove unknown ${name}.`);
  publishGlobal(null, name);
}

export function godotRenderingServerGlobalShaderParameterGetList(): string[] { return [...GLOBALS.keys()]; }
export function godotRenderingServerGlobalShaderParameterSet(name: unknown, value: unknown): void { const state = globalOf(name, 'global_shader_parameter_set'); state.value = value; publishGlobal(state, state.name); }
export function godotRenderingServerGlobalShaderParameterSetOverride(name: unknown, value: unknown): void { const state = globalOf(name, 'global_shader_parameter_set_override'); state.overrideValue = value === null ? undefined : value; publishGlobal(state, state.name); }
export function godotRenderingServerGlobalShaderParameterGet(name: unknown): unknown { return effective(globalOf(name, 'global_shader_parameter_get')); }
export function godotRenderingServerGlobalShaderParameterGetType(name: unknown): number { return globalOf(name, 'global_shader_parameter_get_type').type; }
export function godotRenderingServerGlobalShaderParameterGetSnapshot(name: unknown): GodotGlobalShaderParameterSnapshot { return globalSnapshot(globalOf(name, 'global_shader_parameter_get_snapshot')); }

export function watchGodotGlobalShaderParameters(watcher: (snapshot: GodotGlobalShaderParameterSnapshot | null, changedName: string) => void): () => void {
  GLOBAL_WATCHERS.add(watcher);
  for (const state of GLOBALS.values()) watcher(globalSnapshot(state), state.name);
  return () => GLOBAL_WATCHERS.delete(watcher);
}

export function bindGodotGlobalShaderParametersToMaterial(material: Material): () => void {
  const apply = (snapshot: GodotGlobalShaderParameterSnapshot | null, changedName: string): void => {
    if (snapshot === null) {
      const uniforms = Reflect.get(material, 'uniforms') as Record<string, { value: unknown }> | undefined;
      if (uniforms?.[changedName] !== undefined) uniforms[changedName].value = null;
      delete (material.userData['godotGlobalShaderParameters'] as Record<string, unknown> | undefined)?.[changedName];
    } else {
      const uniforms = Reflect.get(material, 'uniforms') as Record<string, { value: unknown }> | undefined;
      if (uniforms?.[changedName] !== undefined) uniforms[changedName].value = snapshot.effectiveValue;
      material.userData['godotGlobalShaderParameters'] ??= {};
      (material.userData['godotGlobalShaderParameters'] as Record<string, unknown>)[changedName] = snapshot.effectiveValue;
    }
    material.needsUpdate = true;
  };
  return watchGodotGlobalShaderParameters(apply);
}

export function setGodotInstanceShaderParameter(target: object, nameValue: unknown, value: unknown): void {
  if (typeof target !== 'object' || target === null) throw new TypeError('godot-compat: set_instance_shader_parameter requires renderable object.');
  const name = nameOf(nameValue, 'GeometryInstance3D.set_instance_shader_parameter.name'), state = instanceState(target);
  if (value === null) state.parameters.delete(name); else state.parameters.set(name, value);
  state.revision += 1;
  for (const material of materialsOf(target)) applyMaterialParameter(material, name, value);
  const snapshot = instanceSnapshot(state); for (const watcher of state.watchers) watcher(snapshot, name);
}

export function getGodotInstanceShaderParameter(target: object, nameValue: unknown): unknown {
  const name = nameOf(nameValue, 'GeometryInstance3D.get_instance_shader_parameter.name');
  return instanceState(target).parameters.get(name) ?? null;
}

export function getGodotInstanceShaderParameters(target: object): ReadonlyMap<string, unknown> { return new Map(instanceState(target).parameters); }

export function watchGodotInstanceShaderParameters(target: object, watcher: (snapshot: GodotInstanceShaderParametersSnapshot, changedName: string) => void): () => void {
  const state = instanceState(target); state.watchers.add(watcher); watcher(instanceSnapshot(state), ''); return () => state.watchers.delete(watcher);
}

export function clearGodotInstanceShaderParameters(target: object): void {
  const state = instanceState(target), names = [...state.parameters.keys()]; state.parameters.clear(); state.revision += 1;
  for (const name of names) for (const material of materialsOf(target)) applyMaterialParameter(material, name, null);
  const snapshot = instanceSnapshot(state); for (const watcher of state.watchers) watcher(snapshot, '');
}
