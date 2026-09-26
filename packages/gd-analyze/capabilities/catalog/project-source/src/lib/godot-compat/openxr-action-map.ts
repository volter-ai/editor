/**
 * Godot OpenXR action-map Resources as retained authored data.
 *
 * These objects deliberately do not synthesize XR input.  A binding becomes live only when a
 * caller supplies the browser's current XRSession and one of its native XRInputSource identities
 * advertises the exact authored interaction-profile path.  Without a session the authored graph
 * remains inspectable, duplicable Resource data and the resolved binding list is empty.
 */

import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedStringArray } from './packed-array';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  getGodotResourceName,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
  hasGodotResourceProtocol,
} from './resource-io';
import type { GodotConnection } from './signal';

/** Godot source's OpenXRAction::ActionType, including output-only haptics. */
export type OpenXRActionType = 0 | 1 | 2 | 3 | 4;

export interface GodotOpenXRAction {
  localized_name: string;
  action_type: OpenXRActionType;
  toplevel_paths: PackedStringArray;
  set_localized_name(value: string): void;
  get_localized_name(): string;
  set_action_type(value: number): void;
  get_action_type(): OpenXRActionType;
  set_toplevel_paths(value: Iterable<unknown>): void;
  get_toplevel_paths(): PackedStringArray;
}

export interface GodotOpenXRActionSet {
  localized_name: string;
  priority: number;
  actions: GodotOpenXRAction[];
  set_localized_name(value: string): void;
  get_localized_name(): string;
  set_priority(value: number): void;
  get_priority(): number;
  set_actions(value: readonly GodotOpenXRAction[]): void;
  get_actions(): GodotOpenXRAction[];
  get_action_count(): number;
  add_action(action: GodotOpenXRAction): void;
  remove_action(action: GodotOpenXRAction): void;
}

export interface GodotOpenXRIPBinding {
  action: GodotOpenXRAction | null;
  binding_path: string;
  binding_modifiers: object[];
  paths: PackedStringArray;
  set_action(value: GodotOpenXRAction | null): void;
  get_action(): GodotOpenXRAction | null;
  set_binding_path(value: string): void;
  get_binding_path(): string;
  set_binding_modifiers(value: readonly object[]): void;
  get_binding_modifiers(): object[];
  get_binding_modifier_count(): number;
  get_binding_modifier(index: number): object | null;
  set_paths(value: Iterable<unknown>): void;
  get_paths(): PackedStringArray;
  get_path_count(): number;
  has_path(path: string): boolean;
  add_path(path: string): void;
  remove_path(path: string): void;
}

export interface GodotOpenXRInteractionProfile {
  interaction_profile_path: string;
  bindings: GodotOpenXRIPBinding[];
  binding_modifiers: object[];
  set_interaction_profile_path(value: string): void;
  get_interaction_profile_path(): string;
  set_bindings(value: readonly GodotOpenXRIPBinding[]): void;
  get_bindings(): GodotOpenXRIPBinding[];
  get_binding_count(): number;
  get_binding(index: number): GodotOpenXRIPBinding | null;
  set_binding_modifiers(value: readonly object[]): void;
  get_binding_modifiers(): object[];
  get_binding_modifier_count(): number;
  get_binding_modifier(index: number): object | null;
}

export interface GodotOpenXRActionMap {
  action_sets: GodotOpenXRActionSet[];
  interaction_profiles: GodotOpenXRInteractionProfile[];
  set_action_sets(value: readonly GodotOpenXRActionSet[]): void;
  get_action_sets(): GodotOpenXRActionSet[];
  get_action_set_count(): number;
  find_action_set(name: string): GodotOpenXRActionSet | null;
  get_action_set(index: number): GodotOpenXRActionSet | null;
  add_action_set(actionSet: GodotOpenXRActionSet): void;
  remove_action_set(actionSet: GodotOpenXRActionSet): void;
  set_interaction_profiles(value: readonly GodotOpenXRInteractionProfile[]): void;
  get_interaction_profiles(): GodotOpenXRInteractionProfile[];
  get_interaction_profile_count(): number;
  find_interaction_profile(path: string): GodotOpenXRInteractionProfile | null;
  get_interaction_profile(index: number): GodotOpenXRInteractionProfile | null;
  add_interaction_profile(profile: GodotOpenXRInteractionProfile): void;
  remove_interaction_profile(profile: GodotOpenXRInteractionProfile): void;
  create_default_action_sets(): never;
}

const ACTIONS = new WeakSet<object>();
const ACTION_SETS = new WeakSet<object>();
const BINDINGS = new WeakSet<object>();
const PROFILES = new WeakSet<object>();

function stringValue(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} requires String.`);
  return value;
}

function integer(value: unknown, member: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${member} requires int.`);
  return value as number;
}

function int32(value: unknown, member: string): number {
  const result = integer(value, member);
  if (result < -0x8000_0000 || result > 0x7fff_ffff) {
    throw new RangeError(`${member} requires a signed 32-bit int.`);
  }
  return result;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function nullableIndex(value: unknown, length: number, member: string): number | undefined {
  const index = integer(value, member);
  return index < 0 || index >= length ? undefined : index;
}

function exact<T extends object>(value: unknown, identities: WeakSet<object>, member: string): T {
  if (typeof value !== 'object' || value === null || !identities.has(value)) {
    throw new TypeError(`${member} requires its exact OpenXR Resource type.`);
  }
  return value as T;
}

function resourceObjects(values: readonly unknown[], member: string): object[] {
  return values.map((value) => {
    if (typeof value !== 'object' || value === null || !hasGodotResourceProtocol(value)) {
      throw new TypeError(`${member} requires Resource-valued modifiers.`);
    }
    return value;
  });
}

const CHILD_CONNECTIONS = new WeakMap<object, Map<object, GodotConnection>>();
function retainNestedChanges(owner: object, values: readonly unknown[]): void {
  const prior = CHILD_CONNECTIONS.get(owner) ?? new Map<object, GodotConnection>();
  const next = new Set<object>();
  for (const value of values) {
    if (typeof value !== 'object' || value === null || !hasGodotResourceProtocol(value)) continue;
    next.add(value);
    if (!prior.has(value)) {
      prior.set(value, godotResourceChangedSignal(value).connect(() => godotResourceEmitChanged(owner)));
    }
  }
  for (const [value, connection] of prior) {
    if (next.has(value)) continue;
    connection.disconnect();
    prior.delete(value);
  }
  CHILD_CONNECTIONS.set(owner, prior);
}

function defineRetainedProperty<T extends object, K extends keyof T>(
  owner: T,
  key: K,
  initial: T[K],
  normalize: (value: T[K]) => T[K],
  nested = false,
): { get(): T[K]; set(value: T[K]): void } {
  let retained = normalize(initial);
  const children = (): unknown[] =>
    Array.isArray(retained) ? retained : retained === null ? [] : [retained];
  if (nested) retainNestedChanges(owner, children());
  const access = {
    get: (): T[K] => retained,
    set: (value: T[K]): void => {
      retained = normalize(value);
      if (nested) retainNestedChanges(owner, children());
      godotResourceEmitChanged(owner);
    },
  };
  Object.defineProperty(owner, key, { enumerable: true, configurable: false, get: access.get, set: access.set });
  return access;
}

export function createGodotOpenXRAction(init: Partial<Pick<GodotOpenXRAction, 'localized_name' | 'action_type' | 'toplevel_paths'>> = {}): GodotOpenXRAction {
  const action = {} as GodotOpenXRAction;
  ACTIONS.add(action);
  registerGodotObjectIdentity(action, 'OpenXRAction');
  const localized = defineRetainedProperty(action, 'localized_name', init.localized_name ?? '', (v) => stringValue(v, 'OpenXRAction.localized_name'));
  // Godot's authored default is FLOAT (1); BOOL actions are serialized explicitly as 0.
  const actionType = defineRetainedProperty(action, 'action_type', init.action_type ?? 1, (v) => {
    const type = integer(v, 'OpenXRAction.action_type');
    if (type < 0 || type > 4) {
      throw new RangeError(
        'OpenXRAction.action_type must be BOOL, FLOAT, VECTOR2, POSE, or HAPTIC.',
      );
    }
    return type as OpenXRActionType;
  });
  const paths = defineRetainedProperty(action, 'toplevel_paths', init.toplevel_paths ?? packedStringArray(), (v) => packedStringArray(v));
  Object.assign(action, {
    set_localized_name: localized.set, get_localized_name: localized.get,
    set_action_type: actionType.set, get_action_type: actionType.get,
    set_toplevel_paths: paths.set, get_toplevel_paths: paths.get,
  });
  return bindGodotResourceProtocol(action, {
    createDuplicate(source) { return createGodotOpenXRAction({ localized_name: source.localized_name, action_type: source.action_type, toplevel_paths: source.toplevel_paths }); },
  });
}

export function createGodotOpenXRActionSet(init: Partial<Pick<GodotOpenXRActionSet, 'localized_name' | 'priority' | 'actions'>> = {}): GodotOpenXRActionSet {
  const set = {} as GodotOpenXRActionSet;
  ACTION_SETS.add(set);
  registerGodotObjectIdentity(set, 'OpenXRActionSet');
  const localized = defineRetainedProperty(set, 'localized_name', init.localized_name ?? '', (v) => stringValue(v, 'OpenXRActionSet.localized_name'));
  const priority = defineRetainedProperty(set, 'priority', init.priority ?? 0, (v) => int32(v, 'OpenXRActionSet.priority'));
  const actions = defineRetainedProperty(set, 'actions', init.actions ?? [], (v) => unique([...v].map((one) => exact<GodotOpenXRAction>(one, ACTIONS, 'OpenXRActionSet.actions'))), true);
  Object.assign(set, {
    set_localized_name: localized.set, get_localized_name: localized.get,
    set_priority: priority.set, get_priority: priority.get,
    set_actions: actions.set, get_actions: () => [...actions.get()],
    get_action_count: () => actions.get().length,
    add_action: (action: GodotOpenXRAction) => {
      const retained = exact<GodotOpenXRAction>(action, ACTIONS, 'OpenXRActionSet.add_action');
      if (!actions.get().includes(retained)) actions.set([...actions.get(), retained]);
    },
    remove_action: (action: GodotOpenXRAction) => {
      const index = actions.get().indexOf(action);
      if (index >= 0) actions.set(actions.get().filter((_, at) => at !== index));
    },
  });
  return bindGodotResourceProtocol(set, {
    createDuplicate(source) { return createGodotOpenXRActionSet({ localized_name: source.localized_name, priority: source.priority, actions: source.actions }); },
    populateDuplicate(source, target, deep, memo) { if (deep) target.actions = source.actions.map((one) => duplicateGodotSubresource(one, memo)); },
  });
}

export function createGodotOpenXRIPBinding(init: Partial<Pick<GodotOpenXRIPBinding, 'action' | 'binding_path' | 'binding_modifiers' | 'paths'>> = {}): GodotOpenXRIPBinding {
  const binding = {} as GodotOpenXRIPBinding;
  BINDINGS.add(binding);
  registerGodotObjectIdentity(binding, 'OpenXRIPBinding');
  const action = defineRetainedProperty(binding, 'action', init.action ?? null, (v) => v === null ? null : exact<GodotOpenXRAction>(v, ACTIONS, 'OpenXRIPBinding.action'), true);
  const bindingPath = defineRetainedProperty(binding, 'binding_path', init.binding_path ?? '', (v) => stringValue(v, 'OpenXRIPBinding.binding_path'));
  const modifiers = defineRetainedProperty(binding, 'binding_modifiers', init.binding_modifiers ?? [], (v) => resourceObjects(v, 'OpenXRIPBinding.binding_modifiers'), true);
  const paths = defineRetainedProperty(binding, 'paths', init.paths ?? packedStringArray(), (v) => packedStringArray(v));
  Object.assign(binding, {
    set_action: action.set, get_action: action.get,
    set_binding_path: bindingPath.set, get_binding_path: bindingPath.get,
    set_binding_modifiers: modifiers.set, get_binding_modifiers: () => [...modifiers.get()],
    get_binding_modifier_count: () => modifiers.get().length,
    get_binding_modifier: (at: number) => {
      const index = nullableIndex(at, modifiers.get().length, 'OpenXRIPBinding.get_binding_modifier');
      return index === undefined ? null : modifiers.get()[index] ?? null;
    },
    set_paths: paths.set, get_paths: paths.get,
    get_path_count: () => paths.get().length,
    has_path: (path: string) => paths.get().includes(stringValue(path, 'OpenXRIPBinding.has_path')),
    add_path: (path: string) => { const value = stringValue(path, 'OpenXRIPBinding.add_path'); if (!paths.get().includes(value)) paths.set(packedStringArray([...paths.get(), value])); },
    remove_path: (path: string) => {
      const value = stringValue(path, 'OpenXRIPBinding.remove_path');
      if (paths.get().includes(value)) paths.set(packedStringArray(paths.get().filter((one) => one !== value)));
    },
  });
  return bindGodotResourceProtocol(binding, {
    createDuplicate(source) { return createGodotOpenXRIPBinding({ action: source.action, binding_path: source.binding_path, binding_modifiers: source.binding_modifiers, paths: source.paths }); },
    populateDuplicate(source, target, deep, memo) {
      if (!deep) return;
      target.action = source.action === null ? null : duplicateGodotSubresource(source.action, memo);
      target.binding_modifiers = source.binding_modifiers.map((one) => duplicateGodotSubresource(one, memo));
    },
  });
}

export function createGodotOpenXRInteractionProfile(init: Partial<Pick<GodotOpenXRInteractionProfile, 'interaction_profile_path' | 'bindings' | 'binding_modifiers'>> = {}): GodotOpenXRInteractionProfile {
  const profile = {} as GodotOpenXRInteractionProfile;
  PROFILES.add(profile);
  registerGodotObjectIdentity(profile, 'OpenXRInteractionProfile');
  const path = defineRetainedProperty(profile, 'interaction_profile_path', init.interaction_profile_path ?? '', (v) => stringValue(v, 'OpenXRInteractionProfile.interaction_profile_path'));
  const bindings = defineRetainedProperty(profile, 'bindings', init.bindings ?? [], (v) => unique([...v].map((one) => exact<GodotOpenXRIPBinding>(one, BINDINGS, 'OpenXRInteractionProfile.bindings'))), true);
  const modifiers = defineRetainedProperty(profile, 'binding_modifiers', init.binding_modifiers ?? [], (v) => resourceObjects(v, 'OpenXRInteractionProfile.binding_modifiers'), true);
  Object.assign(profile, {
    set_interaction_profile_path: path.set, get_interaction_profile_path: path.get,
    set_bindings: bindings.set, get_bindings: () => [...bindings.get()],
    get_binding_count: () => bindings.get().length,
    get_binding: (at: number) => {
      const index = nullableIndex(at, bindings.get().length, 'OpenXRInteractionProfile.get_binding');
      return index === undefined ? null : bindings.get()[index] ?? null;
    },
    set_binding_modifiers: modifiers.set, get_binding_modifiers: () => [...modifiers.get()],
    get_binding_modifier_count: () => modifiers.get().length,
    get_binding_modifier: (at: number) => {
      const index = nullableIndex(at, modifiers.get().length, 'OpenXRInteractionProfile.get_binding_modifier');
      return index === undefined ? null : modifiers.get()[index] ?? null;
    },
  });
  return bindGodotResourceProtocol(profile, {
    createDuplicate(source) { return createGodotOpenXRInteractionProfile({ interaction_profile_path: source.interaction_profile_path, bindings: source.bindings, binding_modifiers: source.binding_modifiers }); },
    populateDuplicate(source, target, deep, memo) {
      if (!deep) return;
      target.bindings = source.bindings.map((one) => duplicateGodotSubresource(one, memo));
      target.binding_modifiers = source.binding_modifiers.map((one) => duplicateGodotSubresource(one, memo));
    },
  });
}

export function createGodotOpenXRActionMap(init: Partial<Pick<GodotOpenXRActionMap, 'action_sets' | 'interaction_profiles'>> = {}): GodotOpenXRActionMap {
  const map = {} as GodotOpenXRActionMap;
  registerGodotObjectIdentity(map, 'OpenXRActionMap');
  const sets = defineRetainedProperty(map, 'action_sets', init.action_sets ?? [], (v) => unique([...v].map((one) => exact<GodotOpenXRActionSet>(one, ACTION_SETS, 'OpenXRActionMap.action_sets'))), true);
  const profiles = defineRetainedProperty(map, 'interaction_profiles', init.interaction_profiles ?? [], (v) => unique([...v].map((one) => exact<GodotOpenXRInteractionProfile>(one, PROFILES, 'OpenXRActionMap.interaction_profiles'))), true);
  Object.assign(map, {
    set_action_sets: sets.set, get_action_sets: () => [...sets.get()], get_action_set_count: () => sets.get().length,
    find_action_set: (name: string) => sets.get().find((one) => getGodotResourceName(one) === stringValue(name, 'OpenXRActionMap.find_action_set')) ?? null,
    get_action_set: (at: number) => {
      const index = nullableIndex(at, sets.get().length, 'OpenXRActionMap.get_action_set');
      return index === undefined ? null : sets.get()[index] ?? null;
    },
    add_action_set: (one: GodotOpenXRActionSet) => {
      const retained = exact<GodotOpenXRActionSet>(one, ACTION_SETS, 'OpenXRActionMap.add_action_set');
      if (!sets.get().includes(retained)) sets.set([...sets.get(), retained]);
    },
    remove_action_set: (one: GodotOpenXRActionSet) => {
      const index = sets.get().indexOf(one);
      if (index >= 0) sets.set(sets.get().filter((_, at) => at !== index));
    },
    set_interaction_profiles: profiles.set, get_interaction_profiles: () => [...profiles.get()], get_interaction_profile_count: () => profiles.get().length,
    find_interaction_profile: (path: string) => profiles.get().find((one) => one.interaction_profile_path === stringValue(path, 'OpenXRActionMap.find_interaction_profile')) ?? null,
    get_interaction_profile: (at: number) => {
      const index = nullableIndex(at, profiles.get().length, 'OpenXRActionMap.get_interaction_profile');
      return index === undefined ? null : profiles.get()[index] ?? null;
    },
    add_interaction_profile: (one: GodotOpenXRInteractionProfile) => {
      const retained = exact<GodotOpenXRInteractionProfile>(one, PROFILES, 'OpenXRActionMap.add_interaction_profile');
      if (!profiles.get().includes(retained)) profiles.set([...profiles.get(), retained]);
    },
    remove_interaction_profile: (one: GodotOpenXRInteractionProfile) => {
      const index = profiles.get().indexOf(one);
      if (index >= 0) profiles.set(profiles.get().filter((_, at) => at !== index));
    },
    create_default_action_sets: (): never => { throw new Error('OpenXRActionMap.create_default_action_sets requires Godot editor defaults not authored by this project.'); },
  });
  return bindGodotResourceProtocol(map, {
    createDuplicate(source) { return createGodotOpenXRActionMap({ action_sets: source.action_sets, interaction_profiles: source.interaction_profiles }); },
    populateDuplicate(source, target, deep, memo) {
      if (!deep) return;
      target.action_sets = source.action_sets.map((one) => duplicateGodotSubresource(one, memo));
      target.interaction_profiles = source.interaction_profiles.map((one) => duplicateGodotSubresource(one, memo));
    },
  });
}

export interface WebXRInputSourceLike {
  readonly profiles: readonly string[];
  readonly handedness?: string;
  readonly targetRayMode?: string;
}

export interface WebXRSessionLike {
  readonly inputSources: Iterable<WebXRInputSourceLike>;
}

export interface ResolvedOpenXRBinding {
  readonly inputSource: WebXRInputSourceLike;
  readonly interactionProfile: GodotOpenXRInteractionProfile;
  readonly binding: GodotOpenXRIPBinding;
  readonly action: GodotOpenXRAction;
  readonly paths: PackedStringArray;
}

export type WebXRProfilePathResolver = (
  webXRProfile: string,
  inputSource: WebXRInputSourceLike,
) => string | undefined;

function bindingMatchesHand(binding: GodotOpenXRIPBinding, inputSource: WebXRInputSourceLike): boolean {
  if (inputSource.handedness !== 'left' && inputSource.handedness !== 'right') return true;
  const prefix = `/user/hand/${inputSource.handedness}`;
  const authored = binding.paths.length === 0 ? [binding.binding_path] : binding.paths;
  return authored.some((path) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Exact native-session view of the authored map. WebXR profile ids and OpenXR interaction-profile
 * paths are different namespaces, so callers must supply the resolver owned by their WebXR input
 * profile registry. No session or no resolver means no active bindings.
 */
export function resolveGodotOpenXRBindings(
  map: GodotOpenXRActionMap,
  session: WebXRSessionLike | null | undefined,
  profilePathOf?: WebXRProfilePathResolver,
): ResolvedOpenXRBinding[] {
  if (session == null || profilePathOf === undefined) return [];
  const resolved: ResolvedOpenXRBinding[] = [];
  for (const inputSource of session.inputSources) {
    for (const profile of map.interaction_profiles) {
      if (!inputSource.profiles.some((one) => profilePathOf(one, inputSource) === profile.interaction_profile_path)) continue;
      for (const binding of profile.bindings) {
        if (binding.action === null || !bindingMatchesHand(binding, inputSource)) continue;
        resolved.push({ inputSource, interactionProfile: profile, binding, action: binding.action, paths: packedStringArray(binding.paths) });
      }
    }
  }
  return resolved;
}
