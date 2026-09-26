/** One translated project's retained, mutable ProjectSettings singleton state. */

import { godotColor } from './color';
import { godotNodePathNew } from './node-path';
import { vec3 } from './variant-3d';
import { type GodotNumericVariantTag, godotTaggedVariantNumber } from './variant-number';
import { vec2 } from './vector2';

export type GodotProjectSettingSeedValue =
  | { readonly kind: 'string'; readonly value: string }
  | {
      readonly kind: 'number';
      readonly value: number;
      readonly variantType?: GodotNumericVariantTag;
    }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'null' }
  | { readonly kind: 'ident'; readonly name: string }
  | { readonly kind: 'array'; readonly items: readonly GodotProjectSettingSeedValue[] }
  | {
      readonly kind: 'dict';
      readonly entries: readonly {
        readonly key: string;
        readonly keyValue?: GodotProjectSettingSeedValue;
        readonly value: GodotProjectSettingSeedValue;
      }[];
    }
  | {
      readonly kind: 'ctor';
      readonly name: string;
      readonly args: readonly GodotProjectSettingSeedValue[];
      readonly fields: readonly {
        readonly key: string;
        readonly value: GodotProjectSettingSeedValue;
      }[];
    };

export type GodotProjectSettingSeed = readonly (readonly [string, GodotProjectSettingSeedValue])[];

interface ProjectSettingsOwner {
  readonly projectSettings: Map<string, unknown>;
}

export interface GodotProjectPropertyInfo {
  readonly name: string;
  readonly type?: number;
  readonly hint?: number;
  readonly hint_string?: string;
  readonly usage?: number;
  readonly class_name?: string;
}

export interface GodotGlobalClassInfo {
  readonly class: string;
  readonly base: string;
  readonly language: string;
  readonly path: string;
  readonly icon?: string;
}

interface ProjectSettingsState {
  readonly initial: Map<string, unknown>;
  readonly orders: Map<string, number>;
  readonly basic: Set<string>;
  readonly internal: Set<string>;
  readonly restartIfChanged: Set<string>;
  readonly propertyInfo: Map<string, GodotProjectPropertyInfo>;
  readonly globalClasses: GodotGlobalClassInfo[];
  readonly customFeatures: Set<string>;
  persist?: (file: string, values: ReadonlyMap<string, unknown>) => number;
}

const PROJECT_SETTINGS_STATE = new WeakMap<object, ProjectSettingsState>();

function numberArgs(value: Extract<GodotProjectSettingSeedValue, { kind: 'ctor' }>): number[] {
  return value.args.map((arg) => {
    if (arg.kind !== 'number') {
      throw new TypeError(`ProjectSettings ${value.name} seed requires numeric arguments.`);
    }
    return arg.value;
  });
}

function decoded(value: GodotProjectSettingSeedValue): unknown {
  switch (value.kind) {
    case 'string':
    case 'bool':
      return value.value;
    case 'number':
      return value.variantType === undefined
        ? value.value
        : godotTaggedVariantNumber(value.value, value.variantType);
    case 'null':
      return null;
    case 'ident':
      return value.name;
    case 'array':
      return value.items.map(decoded);
    case 'dict':
      return new Map(
        value.entries.map((entry) => [
          entry.keyValue === undefined ? entry.key : decoded(entry.keyValue),
          decoded(entry.value),
        ]),
      );
    case 'ctor': {
      if (value.name === 'Vector2' || value.name === 'Vector2i') {
        const [x = 0, y = 0] = numberArgs(value);
        return vec2(x, y);
      }
      if (value.name === 'Vector3' || value.name === 'Vector3i') {
        const [x = 0, y = 0, z = 0] = numberArgs(value);
        return vec3(x, y, z);
      }
      if (value.name === 'Color') {
        const [r = 0, g = 0, b = 0, a = 1] = numberArgs(value);
        return godotColor(r, g, b, a);
      }
      if (value.name === 'NodePath') {
        return godotNodePathNew(decoded(value.args[0] ?? { kind: 'string', value: '' }) as string);
      }
      if (value.name === 'StringName') {
        return decoded(value.args[0] ?? { kind: 'string', value: '' });
      }
      if (value.name.startsWith('Packed') || value.name.startsWith('Pool')) {
        return value.args.map(decoded);
      }
      // Unknown project-setting constructors remain the exact parsed carrier. The translator
      // refuses a get_setting reader without a measured Variant type; fabricating an object-shaped
      // runtime value here would turn that refusal into silent false fidelity. Membership remains
      // exact because the retained Map owns the key independently of its value's runtime support.
      return value;
    }
  }
}

export function createGodotProjectSettings(seed: GodotProjectSettingSeed): Map<string, unknown> {
  return new Map(seed.map(([name, value]) => [name, decoded(value)]));
}

function owner(value: unknown): ProjectSettingsOwner {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('ProjectSettings requires the active translated SceneTree owner.');
  }
  const candidate = value as Partial<ProjectSettingsOwner>;
  if (!(candidate.projectSettings instanceof Map)) {
    throw new TypeError('ProjectSettings requires SceneTree.projectSettings membership data.');
  }
  return candidate as ProjectSettingsOwner;
}

function settingName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('ProjectSettings setting name requires a non-empty StringName.');
  }
  return value;
}

function valuesOf(tree: unknown): Map<string, unknown> {
  return owner(tree).projectSettings;
}

function stateOf(tree: unknown): ProjectSettingsState {
  const target = owner(tree) as ProjectSettingsOwner & object;
  let state = PROJECT_SETTINGS_STATE.get(target);
  if (state === undefined) {
    state = {
      initial: new Map(target.projectSettings),
      orders: new Map(),
      basic: new Set(),
      internal: new Set(),
      restartIfChanged: new Set(),
      propertyInfo: new Map(),
      globalClasses: [],
      customFeatures: new Set(),
    };
    PROJECT_SETTINGS_STATE.set(target, state);
  }
  return state;
}

function deepEqual(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null)
    return false;
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index], seen))
    );
  }
  if (left instanceof Map || right instanceof Map) {
    if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
    for (const [key, value] of left) {
      if (!right.has(key) || !deepEqual(value, right.get(key), seen)) return false;
    }
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        deepEqual(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          seen,
        ),
    )
  );
}

/** Update the in-memory singleton only; browser ports never persist project.godot mutations. */
export function godotProjectSetSetting(tree: unknown, name: unknown, value: unknown): void {
  const settings = valuesOf(tree);
  const key = settingName(name);
  if (value === null || value === undefined) settings.delete(key);
  else settings.set(key, value);
}

/** Read the same retained map that set_setting/clear mutate. The third argument is a compile-time
 * type witness emitted from the registered default; the actual default is already seeded in the
 * Map, so a later clear must return null rather than resurrecting the startup value. */
export function godotProjectGetSetting<T>(tree: unknown, name: unknown, _typeWitness: T): T {
  const settings = valuesOf(tree);
  const key = settingName(name);
  return (settings.has(key) ? settings.get(key) : null) as T;
}

/** Membership, never truthiness: authored null, false, zero, and empty strings all remain present. */
export function godotProjectHasSetting(tree: unknown, name: unknown): boolean {
  return valuesOf(tree).has(settingName(name));
}

export function godotProjectClearSetting(tree: unknown, name: unknown): void {
  valuesOf(tree).delete(settingName(name));
}

export function godotProjectGetSettingWithOverride<T>(tree: unknown, name: unknown): T {
  return godotProjectGetSettingWithOverrideAndCustomFeatures(tree, name, []);
}

export function godotProjectGetSettingWithOverrideAndCustomFeatures<T>(
  tree: unknown,
  name: unknown,
  features: Iterable<string>,
): T {
  const key = settingName(name);
  const settings = valuesOf(tree);
  const activeFeatures = [...stateOf(tree).customFeatures, ...features].filter(
    (value, index, list) =>
      typeof value === 'string' && value.length > 0 && list.indexOf(value) === index,
  );
  for (let length = activeFeatures.length; length > 0; length -= 1) {
    const candidate = `${key}.${activeFeatures.slice(0, length).join('.')}`;
    if (settings.has(candidate)) return settings.get(candidate) as T;
  }
  for (const feature of activeFeatures) {
    const candidate = `${key}.${feature}`;
    if (settings.has(candidate)) return settings.get(candidate) as T;
  }
  return (settings.get(key) ?? null) as T;
}

export function godotProjectSetOrder(tree: unknown, name: unknown, position: number): void {
  const key = settingName(name);
  if (!Number.isInteger(position))
    throw new TypeError('ProjectSettings.set_order position requires int.');
  stateOf(tree).orders.set(key, position);
}

export function godotProjectGetOrder(tree: unknown, name: unknown): number {
  return stateOf(tree).orders.get(settingName(name)) ?? -1;
}

export function godotProjectSetInitialValue(tree: unknown, name: unknown, value: unknown): void {
  const key = settingName(name);
  const state = stateOf(tree);
  if (value === null || value === undefined) state.initial.delete(key);
  else state.initial.set(key, value);
}

export function godotProjectSetAsBasic(tree: unknown, name: unknown, basic: boolean): void {
  if (typeof basic !== 'boolean')
    throw new TypeError('ProjectSettings.set_as_basic requires bool.');
  const set = stateOf(tree).basic;
  const key = settingName(name);
  if (basic) set.add(key);
  else set.delete(key);
}

export function godotProjectSetAsInternal(tree: unknown, name: unknown, internal: boolean): void {
  if (typeof internal !== 'boolean')
    throw new TypeError('ProjectSettings.set_as_internal requires bool.');
  const set = stateOf(tree).internal;
  const key = settingName(name);
  if (internal) set.add(key);
  else set.delete(key);
}

export function godotProjectAddPropertyInfo(tree: unknown, hint: unknown): void {
  const source = hint instanceof Map ? Object.fromEntries(hint) : hint;
  if (typeof source !== 'object' || source === null || !('name' in source)) {
    throw new TypeError('ProjectSettings.add_property_info requires a Dictionary with name.');
  }
  const info = source as GodotProjectPropertyInfo;
  const name = settingName(info.name);
  for (const numeric of ['type', 'hint', 'usage'] as const) {
    if (info[numeric] !== undefined && !Number.isInteger(info[numeric])) {
      throw new TypeError(`ProjectSettings.add_property_info ${numeric} requires int.`);
    }
  }
  stateOf(tree).propertyInfo.set(name, { ...info, name });
}

export function godotProjectSetRestartIfChanged(
  tree: unknown,
  name: unknown,
  restart: boolean,
): void {
  if (typeof restart !== 'boolean')
    throw new TypeError('ProjectSettings.set_restart_if_changed requires bool.');
  const set = stateOf(tree).restartIfChanged;
  const key = settingName(name);
  if (restart) set.add(key);
  else set.delete(key);
}

export function godotProjectGetChangedSettings(tree: unknown): string[] {
  const settings = valuesOf(tree);
  const initial = stateOf(tree).initial;
  const names = new Set([...settings.keys(), ...initial.keys()]);
  return [...names]
    .filter(
      (name) =>
        settings.has(name) !== initial.has(name) ||
        !deepEqual(settings.get(name), initial.get(name)),
    )
    .sort((left, right) => {
      const orders = stateOf(tree).orders;
      return (
        (orders.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (orders.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right)
      );
    });
}

export function godotProjectCheckChangedSettingsInGroup(tree: unknown, prefix: string): boolean {
  if (typeof prefix !== 'string')
    throw new TypeError('ProjectSettings changed group prefix requires String.');
  return godotProjectGetChangedSettings(tree).some((name) => name.startsWith(prefix));
}

export function bindGodotProjectSettingsPersistence(
  tree: unknown,
  persist: (file: string, values: ReadonlyMap<string, unknown>) => number,
): () => void {
  if (typeof persist !== 'function')
    throw new TypeError('ProjectSettings persistence requires a function.');
  const state = stateOf(tree);
  state.persist = persist;
  return () => {
    if (state.persist === persist) delete state.persist;
  };
}

export function godotProjectSave(tree: unknown): number {
  return godotProjectSaveCustom(tree, 'project.godot');
}

export function godotProjectSaveCustom(tree: unknown, file: string): number {
  if (typeof file !== 'string' || file.length === 0) {
    throw new TypeError('ProjectSettings.save_custom requires a non-empty file path.');
  }
  const persist = stateOf(tree).persist;
  if (persist === undefined) {
    throw new Error('ProjectSettings.save requires a project-owned persistence binding.');
  }
  const result = persist(file, valuesOf(tree));
  if (!Number.isInteger(result))
    throw new TypeError('ProjectSettings persistence must return Error.');
  if (result === 0) {
    const state = stateOf(tree);
    state.initial.clear();
    for (const [name, value] of valuesOf(tree)) state.initial.set(name, value);
  }
  return result;
}

export function registerGodotProjectGlobalClass(
  tree: unknown,
  info: GodotGlobalClassInfo,
): () => void {
  if (
    typeof info !== 'object' ||
    info === null ||
    typeof info.class !== 'string' ||
    typeof info.base !== 'string' ||
    typeof info.language !== 'string' ||
    typeof info.path !== 'string'
  ) {
    throw new TypeError('ProjectSettings global class requires class/base/language/path strings.');
  }
  const classes = stateOf(tree).globalClasses;
  const row = { ...info };
  classes.push(row);
  return () => {
    const index = classes.indexOf(row);
    if (index >= 0) classes.splice(index, 1);
  };
}

export function godotProjectGetGlobalClassList(tree: unknown): Record<string, unknown>[] {
  return stateOf(tree).globalClasses.map((info) => ({ ...info }));
}

export function setGodotProjectCustomFeatures(tree: unknown, features: Iterable<string>): void {
  const target = stateOf(tree).customFeatures;
  target.clear();
  for (const feature of features) {
    if (typeof feature !== 'string' || feature.length === 0) {
      throw new TypeError('ProjectSettings custom features require non-empty strings.');
    }
    target.add(feature);
  }
}

/**
 * Runtime `.pck` mounting needs Godot's ResourceFormatPCK binary loader and virtual filesystem.
 * The translated browser project instead carries source-decoded resources in its existing mount,
 * so returning `true` here would fabricate a pack overlay that no resource lookup can observe.
 */
export function godotProjectLoadResourcePack(
  pack: unknown,
  replaceFiles: unknown = true,
  offset: unknown = 0,
): never {
  if (typeof pack !== 'string' || pack.length === 0) {
    throw new TypeError('ProjectSettings.load_resource_pack requires a non-empty pack path.');
  }
  if (typeof replaceFiles !== 'boolean') {
    throw new TypeError('ProjectSettings.load_resource_pack replace_files requires bool.');
  }
  if (!Number.isSafeInteger(offset) || (offset as number) < 0) {
    throw new RangeError(
      'ProjectSettings.load_resource_pack offset must be a non-negative integer.',
    );
  }
  throw new Error(
    `ProjectSettings.load_resource_pack(${JSON.stringify(pack)}) is unavailable: the browser ` +
      'resource mount contains decoded project resources, not Godot ResourceFormatPCK archives.',
  );
}
