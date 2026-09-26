/**
 * Runtime carriers for explicitly supported native extension classes.
 *
 * This is not a second Godot ClassDB and it does not make addon classes look like built-ins.  The
 * generated binding selects one entry only when the authored scene declares that extension class;
 * the declared Godot base members reuse their pinned Three backends, while unlisted extension
 * members fail through the ordinary retained-object protocol.
 */
import {
  type GodotObjectBinding,
  type GodotObjectClassDispatch,
} from './object';
import { GODOT_OBJECT_DISPATCH_4_THREE } from './object-dispatch-4-three';

interface LimboTransition {
  readonly from: object;
  readonly to: object;
  readonly event: string;
  readonly guard: unknown;
}

interface LimboHsmState {
  transitions: LimboTransition[];
  agent: object | null;
  parentScope: unknown;
  active: boolean;
}

const LIMBO_HSM_STATE = new WeakMap<object, LimboHsmState>();

function objectArg(value: unknown, method: string, index: number): object {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    throw new TypeError(`godot-compat: LimboHSM.${method} argument ${index + 1} must be an Object.`);
  }
  return value as object;
}

function hsmState(binding: GodotObjectBinding): LimboHsmState {
  let state = LIMBO_HSM_STATE.get(binding.value);
  if (state === undefined) {
    state = { transitions: [], agent: null, parentScope: null, active: false };
    LIMBO_HSM_STATE.set(binding.value, state);
  }
  return state;
}

function addTransition(binding: GodotObjectBinding, args: readonly unknown[]): void {
  if (args.length !== 3 && args.length !== 4) {
    throw new TypeError(`godot-compat: LimboHSM.add_transition received ${args.length} arguments; expected 3 or 4.`);
  }
  const from = objectArg(args[0], 'add_transition', 0);
  const to = objectArg(args[1], 'add_transition', 1);
  if (typeof args[2] !== 'string') {
    throw new TypeError('godot-compat: LimboHSM.add_transition event must be a StringName/String.');
  }
  hsmState(binding).transitions.push({ from, to, event: args[2], guard: args[3] ?? null });
}

function initialize(binding: GodotObjectBinding, args: readonly unknown[]): void {
  if (args.length !== 1 && args.length !== 2) {
    throw new TypeError(`godot-compat: LimboHSM.initialize received ${args.length} arguments; expected 1 or 2.`);
  }
  const state = hsmState(binding);
  state.agent = objectArg(args[0], 'initialize', 0);
  state.parentScope = args[1] ?? null;
}

function setActive(binding: GodotObjectBinding, args: readonly unknown[]): void {
  if (args.length !== 1 || typeof args[0] !== 'boolean') {
    throw new TypeError('godot-compat: LimboHSM.set_active requires one bool argument.');
  }
  const state = hsmState(binding);
  state.active = args[0];
}

function emptyDispatch(): Pick<GodotObjectClassDispatch, 'properties' | 'signals'> {
  return { properties: {}, signals: {} };
}

function inheritDispatch(
  base: GodotObjectClassDispatch | undefined,
  own: GodotObjectClassDispatch,
): GodotObjectClassDispatch {
  return {
    properties: { ...(base?.properties ?? {}), ...own.properties },
    signals: { ...(base?.signals ?? {}), ...own.signals },
    methods: { ...(base?.methods ?? {}), ...own.methods },
  };
}

const GODOT_LIMBO_STATE_OWN_DISPATCH: GodotObjectClassDispatch = {
  ...emptyDispatch(),
  methods: {},
};

/** LimboState's retained carrier inherits the pinned Node runtime surface. */
export const GODOT_LIMBO_STATE_DISPATCH: GodotObjectClassDispatch = inheritDispatch(
  GODOT_OBJECT_DISPATCH_4_THREE['Node'],
  GODOT_LIMBO_STATE_OWN_DISPATCH,
);

/** Explicit LimboAI method carrier; its Object3D is the authored node's retained native value. */
export const GODOT_LIMBO_HSM_DISPATCH: GodotObjectClassDispatch = inheritDispatch(
  GODOT_LIMBO_STATE_DISPATCH,
  {
    ...emptyDispatch(),
    methods: {
      add_transition: { call: addTransition },
      initialize: { call: initialize },
      set_active: { call: setActive },
    },
  },
);

/** RenIK is retained as a real Three Object3D and inherits Node3D's pinned runtime surface. */
export const GODOT_RENIK_DISPATCH: GodotObjectClassDispatch = inheritDispatch(
  GODOT_OBJECT_DISPATCH_4_THREE['Node3D'],
  { ...emptyDispatch(), methods: {} },
);

export const GODOT_EXTERNAL_NATIVE_DISPATCH: Readonly<Record<string, GodotObjectClassDispatch>> = Object.freeze({
  LimboHSM: GODOT_LIMBO_HSM_DISPATCH,
  LimboState: GODOT_LIMBO_STATE_DISPATCH,
  RenIK: GODOT_RENIK_DISPATCH,
});
