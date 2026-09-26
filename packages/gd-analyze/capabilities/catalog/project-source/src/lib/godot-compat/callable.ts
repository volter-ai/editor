/**
 * Godot 4's `Callable` Variant protocol.
 *
 * This is protocol, not a scheduler or object registry: a callable holds the JavaScript function
 * or object/method pair the translated project already owns. Deferred calls and RPC accept a
 * caller-owned queue/transport hook; this value protocol never creates either service.
 *
 * Semantics are pinned to Godot 4.7-stable's `core/variant/callable.cpp` and
 * `core/variant/callable_bind.cpp` at 5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88.
 */

import { godotInstanceId } from './gdscript-builtins';

export type GodotCallableMethod = (...args: readonly unknown[]) => unknown;

export type GodotCallableDeferredHook = (invoke: () => void) => void;

export type GodotCallableRpcHook = (
  object: unknown,
  method: string,
  peerId: number | undefined,
  args: readonly unknown[],
) => void;

interface CallableState {
  readonly kind: 'null' | 'custom' | 'standard' | 'bind' | 'unbind';
  readonly fn?: GodotCallableMethod;
  readonly object?: unknown;
  readonly method?: string;
  readonly argumentCount?: number;
  readonly base?: GodotCallable;
  readonly arguments?: readonly unknown[];
  readonly unboundCount?: number;
}

const nullSignalComparator = Object.freeze({});
const standardSignalComparators = new WeakMap<object, Map<string, object>>();
const customSignalComparators = new WeakMap<
  GodotCallableMethod,
  WeakMap<object, Map<string, object>>
>();
const ownerlessCustomCallable = Object.freeze({});

function weakObject(value: unknown): object | undefined {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    ? (value as object)
    : undefined;
}

function methodToken(owner: object, method: string): object {
  let methods = standardSignalComparators.get(owner);
  if (methods === undefined) {
    methods = new Map<string, object>();
    standardSignalComparators.set(owner, methods);
  }
  let token = methods.get(method);
  if (token === undefined) {
    token = Object.freeze({});
    methods.set(method, token);
  }
  return token;
}
export interface GodotCallableOptions {
  /** The Godot object that owns a custom callable, when it has one (script lambdas do). */
  readonly object?: unknown;
  /** Debugger metadata returned by `get_method()`. */
  readonly method?: string;
  /** Total declared parameters. JavaScript `Function.length` omits parameters after a default. */
  readonly argumentCount?: number;
}

/**
 * A value object carrying Godot's call/bind/unbind rules. Public methods use camelCase because the
 * emitter is the one tiny syntax adapter; the behavior remains here and is shared by every port.
 */
export class GodotCallable {
  private constructor(private readonly state: CallableState) {}

  static null(): GodotCallable {
    return new GodotCallable({ kind: 'null' });
  }

  static custom(fn: GodotCallableMethod, options: GodotCallableOptions = {}): GodotCallable {
    if (typeof fn !== 'function') {
      throw new TypeError('Callable custom target must be a source-owned function.');
    }
    return new GodotCallable({
      kind: 'custom',
      fn,
      object: options.object,
      method: options.method ?? (fn.name || '<anonymous lambda>'),
      argumentCount: options.argumentCount ?? fn.length,
    });
  }

  static standard(
    object: unknown,
    method: string,
    argumentCount?: number,
    retainedInvoke?: GodotCallableMethod,
  ): GodotCallable {
    if (object === null || object === undefined || method.length === 0) return GodotCallable.null();
    return new GodotCallable({
      kind: 'standard',
      object,
      method,
      ...(argumentCount === undefined ? {} : { argumentCount }),
      ...(retainedInvoke === undefined ? {} : { fn: retainedInvoke }),
    });
  }

  call(...args: readonly unknown[]): unknown {
    switch (this.state.kind) {
      case 'null':
        return null;
      case 'custom':
        return this.isValid() ? (this.state.fn?.(...args) ?? null) : null;
      case 'standard': {
        if (!this.isValid()) return null;
        const target = this.state.fn ?? methodOf(this.state.object, this.state.method);
        return target === undefined ? null : target.apply(this.state.object, [...args]);
      }
      case 'bind':
        return this.state.base?.call(...args, ...(this.state.arguments ?? [])) ?? null;
      case 'unbind': {
        const count = this.state.unboundCount ?? 0;
        return args.length < count
          ? null
          : (this.state.base?.call(...args.slice(0, -count)) ?? null);
      }
    }
  }

  callv(args: readonly unknown[]): unknown {
    requireCallableArgumentArray(args, 'callv');
    return this.call(...args);
  }

  bind(...args: readonly unknown[]): GodotCallable {
    return new GodotCallable({ kind: 'bind', base: this, arguments: [...args] });
  }

  bindv(args: readonly unknown[]): GodotCallable {
    requireCallableArgumentArray(args, 'bindv');
    // Godot returns the original Callable for an empty bindv, not a fresh wrapper.
    return args.length === 0 ? this : this.bind(...args);
  }

  unbind(argumentCount: number): GodotCallable {
    if (!Number.isSafeInteger(argumentCount)) {
      throw new TypeError('Callable.unbind argument count must be an integer.');
    }
    // Godot reports an engine error and returns an unchanged copy for non-positive values.
    return argumentCount <= 0
      ? this
      : new GodotCallable({ kind: 'unbind', base: this, unboundCount: argumentCount });
  }

  isNull(): boolean {
    return this.state.kind === 'null';
  }

  isCustom(): boolean {
    return (
      this.state.kind === 'custom' || this.state.kind === 'bind' || this.state.kind === 'unbind'
    );
  }

  isStandard(): boolean {
    return this.state.kind === 'standard';
  }

  isValid(): boolean {
    switch (this.state.kind) {
      case 'null':
        return false;
      case 'custom':
        return (
          typeof this.state.fn === 'function' &&
          (this.state.object === undefined || objectIsValid(this.state.object))
        );
      case 'standard':
        return (
          objectIsValid(this.state.object) &&
          (this.state.fn !== undefined || methodOf(this.state.object, this.state.method) !== undefined)
        );
      case 'bind':
      case 'unbind':
        return this.state.base?.isValid() ?? false;
    }
  }

  getObject(): unknown {
    if (this.state.kind === 'bind' || this.state.kind === 'unbind') {
      return this.state.base?.getObject() ?? null;
    }
    return this.state.object !== undefined && objectIsValid(this.state.object)
      ? this.state.object
      : null;
  }

  getMethod(): string {
    return this.state.kind === 'bind' || this.state.kind === 'unbind'
      ? (this.state.base?.getMethod() ?? '')
      : (this.state.method ?? '');
  }

  getObjectId(): bigint {
    const object = this.getObject();
    return weakObject(object) === undefined ? 0n : godotInstanceId(object as object);
  }

  equals(other: unknown): boolean {
    if (!(other instanceof GodotCallable)) return false;
    if (this.state.kind !== other.state.kind) return false;
    if (this.state.kind === 'bind') {
      const left = this.state.arguments ?? [];
      const right = other.state.arguments ?? [];
      return (
        this.state.base?.equals(other.state.base) === true &&
        left.length === right.length &&
        left.every((argument, index) => callableBoundValueEquals(argument, right[index]))
      );
    }
    if (this.state.kind === 'unbind') {
      return (
        this.state.base?.equals(other.state.base) === true &&
        this.state.unboundCount === other.state.unboundCount
      );
    }
    if (this.state.kind === 'standard') {
      return (
        this.state.object === other.state.object &&
        this.state.method === other.state.method
      );
    }
    return (
      this.state.fn === other.state.fn &&
      this.state.object === other.state.object &&
      this.state.method === other.state.method
    );
  }

  hash(): number {
    const objectId = this.getObjectId();
    let value =
      Math.imul(Number(objectId & 0xffff_ffffn), 16777619) ^ hashText(this.getMethod());
    for (const argument of this.getBoundArguments())
      value = Math.imul(value ^ callableBoundValueHash(argument), 16777619);
    return value >>> 0;
  }

  /**
   * Godot Object's signal slot map keys `*callable.get_base_comparator()`: bind/unbind arguments
   * deliberately do not participate, while separately-constructed standard Callables for the same
   * object+method compare equal. This token is that comparator in JavaScript identity form.
   */
  signalComparatorIdentity(): object {
    if (this.state.kind === 'bind' || this.state.kind === 'unbind') {
      return this.state.base?.signalComparatorIdentity() ?? nullSignalComparator;
    }
    if (this.state.kind === 'standard') {
      const owner = weakObject(this.state.object);
      return owner === undefined
        ? nullSignalComparator
        : methodToken(owner, this.state.method ?? '');
    }
    if (this.state.kind === 'custom' && this.state.fn !== undefined) {
      let owners = customSignalComparators.get(this.state.fn);
      if (owners === undefined) {
        owners = new WeakMap<object, Map<string, object>>();
        customSignalComparators.set(this.state.fn, owners);
      }
      const owner = weakObject(this.state.object) ?? ownerlessCustomCallable;
      let methods = owners.get(owner);
      if (methods === undefined) {
        methods = new Map<string, object>();
        owners.set(owner, methods);
      }
      const name = this.state.method ?? '';
      let token = methods.get(name);
      if (token === undefined) {
        token = Object.freeze({});
        methods.set(name, token);
      }
      return token;
    }
    return nullSignalComparator;
  }

  getArgumentCount(): number {
    const own = this.baseArgumentCount();
    if (this.state.kind === 'bind') return own - (this.state.arguments?.length ?? 0);
    if (this.state.kind === 'unbind') return own + (this.state.unboundCount ?? 0);
    return own;
  }

  getBoundArgumentsCount(): number {
    return this.getBoundArguments().length;
  }

  getBoundArguments(): unknown[] {
    if (this.state.kind === 'unbind') return this.state.base?.getBoundArguments() ?? [];
    if (this.state.kind !== 'bind') return [];

    const base = this.state.base;
    const added = this.state.arguments ?? [];
    if (base === undefined) return [...added];
    const visible = Math.max(0, added.length - base.getUnboundArgumentsCount());
    return [...added.slice(0, visible), ...base.getBoundArguments()];
  }

  getUnboundArgumentsCount(): number {
    if (this.state.kind === 'bind') {
      return Math.max(
        0,
        (this.state.base?.getUnboundArgumentsCount() ?? 0) - (this.state.arguments?.length ?? 0),
      );
    }
    if (this.state.kind === 'unbind') {
      return (this.state.base?.getUnboundArgumentsCount() ?? 0) + (this.state.unboundCount ?? 0);
    }
    return 0;
  }

  private baseArgumentCount(): number {
    if (this.state.kind === 'bind' || this.state.kind === 'unbind') {
      return this.state.base?.getArgumentCount() ?? 0;
    }
    if (!this.isValid()) return 0;
    if (this.state.argumentCount !== undefined) return this.state.argumentCount;
    return this.state.fn?.length ?? methodOf(this.state.object, this.state.method)?.length ?? 0;
  }
}

/** The exact signal-slot comparator token used by Object/Signal connection storage. */
export function godotCallableSignalIdentity(callable: GodotCallable): object {
  return callable.signalComparatorIdentity();
}

function hashText(value: string | undefined): number {
  let hash = 2166136261;
  for (const character of value ?? '') {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function requireCallableArgumentArray(
  value: readonly unknown[],
  method: 'callv' | 'bindv',
): void {
  if (!Array.isArray(value)) {
    throw new TypeError(`Callable.${method} requires an Array.`);
  }
}

/**
 * Bound arguments participate in Callable identity with Variant value semantics. This compat path
 * can prove those semantics for scalar values, nested Arrays and byte arrays. Retained engine
 * objects compare by identity. Other host objects are deliberately refused rather than being
 * stringified: JSON loses bigint values, aliases, dictionary key types and native object identity.
 */
function callableBoundValueEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => callableBoundValueEquals(entry, right[index]))
    );
  }
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return (
      left.byteLength === right.byteLength &&
      left.every((entry, index) => entry === right[index])
    );
  }
  if (weakObject(left) !== undefined && weakObject(right) !== undefined) {
    throw new TypeError(
      'Callable equality cannot compare distinct opaque bound host values as Godot Variants.',
    );
  }
  return left === right;
}

function callableBoundValueHash(value: unknown): number {
  if (value === null) return 0x4210_8421;
  switch (typeof value) {
    case 'undefined':
      return 0x811c_9dc5;
    case 'boolean':
      return value ? 0x9e37_79b9 : 0x7f4a_7c15;
    case 'string':
      return hashText(value);
    case 'number':
      return hashText(Object.is(value, -0) ? '0' : String(value));
    case 'bigint':
      return hashText(value.toString());
    case 'symbol':
      throw new TypeError('Callable hash cannot hash a host Symbol as a Godot Variant.');
    case 'function':
      return Number(godotInstanceId(value) & 0xffff_ffffn);
    case 'object':
      if (Array.isArray(value)) {
        return value.reduce(
          (hash, entry) => Math.imul(hash ^ callableBoundValueHash(entry), 16777619),
          2166136261,
        ) >>> 0;
      }
      if (value instanceof Uint8Array) {
        return value.reduce((hash, byte) => Math.imul(hash ^ byte, 16777619), 2166136261) >>> 0;
      }
      throw new TypeError('Callable hash cannot hash an opaque bound host value as a Godot Variant.');
  }
  throw new TypeError(`Callable hash cannot hash unsupported host value type ${typeof value} as a Godot Variant.`);
}

/** Custom Callable used by a translated lambda. */
export function godotCallable(
  fn: GodotCallableMethod,
  options: GodotCallableOptions = {},
): GodotCallable {
  return GodotCallable.custom(fn, options);
}

/** Standard object/method Callable used by a translated method reference or `Callable(obj, name)`. */
export function godotMethodCallable(
  object: unknown,
  method: string,
  argumentCount?: number,
): GodotCallable {
  return GodotCallable.standard(object, method, argumentCount);
}

/** Godot 3 `funcref(instance, function)` over the same retained standard callable identity. */
export function godotFuncRef(object: unknown, method: unknown): GodotCallable {
  if (typeof method !== 'string') throw new TypeError('funcref function name requires String.');
  return GodotCallable.standard(object, method);
}

export function godotFuncRefCallFunc(
  receiver: GodotCallable,
  ...args: readonly unknown[]
): unknown {
  return receiver.call(...args);
}

export function godotFuncRefCallFuncv(receiver: GodotCallable, args: unknown): unknown {
  if (!Array.isArray(args)) throw new TypeError('FuncRef.call_funcv requires Array.');
  return receiver.callv(args);
}

export function godotFuncRefIsValid(receiver: GodotCallable): boolean {
  return receiver.isValid();
}

export function godotFuncRefGetFunction(receiver: GodotCallable): string {
  return receiver.getMethod();
}

/** Default `Callable()` value. */
export function nullGodotCallable(): GodotCallable {
  return GodotCallable.null();
}

export function godotCallableCall(
  receiver: GodotCallable,
  method: 'create' | 'bindv' | 'unbind' | 'bind',
  args: readonly unknown[],
): GodotCallable;
export function godotCallableCall(
  receiver: GodotCallable,
  method: 'is_null' | 'is_custom' | 'is_standard' | 'is_valid',
  args: readonly unknown[],
): boolean;
export function godotCallableCall(
  receiver: GodotCallable,
  method:
    | 'get_argument_count'
    | 'get_bound_arguments_count'
    | 'get_unbound_arguments_count'
    | 'hash',
  args: readonly unknown[],
): number;
export function godotCallableCall(
  receiver: GodotCallable,
  method: 'get_object_id',
  args: readonly unknown[],
): bigint;
export function godotCallableCall(
  receiver: GodotCallable,
  method: 'get_method',
  args: readonly unknown[],
): string;
export function godotCallableCall(
  receiver: GodotCallable,
  method: 'get_bound_arguments',
  args: readonly unknown[],
): readonly unknown[];
export function godotCallableCall<T = unknown>(
  receiver: GodotCallable,
  method: string,
  args: readonly unknown[],
): T;
export function godotCallableCall<T = unknown>(
  receiver: GodotCallable,
  method: string,
  args: readonly unknown[],
): T {
  const fixedArity: Readonly<Record<string, readonly number[]>> = {
    callv: [1], bindv: [1], unbind: [1], is_null: [0], is_custom: [0], is_standard: [0],
    is_valid: [0], get_object: [0], get_object_id: [0], get_method: [0],
    get_argument_count: [0], get_bound_arguments_count: [0], get_bound_arguments: [0],
    get_unbound_arguments_count: [0], hash: [0], create: [2],
  };
  const accepted = fixedArity[method];
  if (accepted !== undefined && !accepted.includes(args.length)) {
    throw new TypeError(`godot-compat: Callable.${method} received ${args.length} arguments.`);
  }
  let result: unknown;
  switch (method) {
    case 'call':
      result = receiver.call(...args);
      break;
    case 'callv':
      result = receiver.callv(requireCallableArrayArgument(args[0], 'callv'));
      break;
    case 'bind':
      result = receiver.bind(...args);
      break;
    case 'bindv':
      result = receiver.bindv(requireCallableArrayArgument(args[0], 'bindv'));
      break;
    case 'unbind':
      result = receiver.unbind(args[0] as number);
      break;
    case 'is_null':
      result = receiver.isNull();
      break;
    case 'is_custom':
      result = receiver.isCustom();
      break;
    case 'is_standard':
      result = receiver.isStandard();
      break;
    case 'is_valid':
      result = receiver.isValid();
      break;
    case 'get_object':
      result = receiver.getObject();
      break;
    case 'get_object_id':
      result = receiver.getObjectId();
      break;
    case 'get_method':
      result = receiver.getMethod();
      break;
    case 'get_argument_count':
      result = receiver.getArgumentCount();
      break;
    case 'get_bound_arguments_count':
      result = receiver.getBoundArgumentsCount();
      break;
    case 'get_bound_arguments':
      result = receiver.getBoundArguments();
      break;
    case 'get_unbound_arguments_count':
      result = receiver.getUnboundArgumentsCount();
      break;
    case 'hash':
      result = receiver.hash();
      break;
    case 'create':
      if (typeof args[1] !== 'string') {
        throw new TypeError('Callable.create requires a StringName method name.');
      }
      result = godotMethodCallable(args[0], args[1]);
      break;
    default:
      throw new Error(`godot-compat: unsupported Callable.${method}`);
  }
  return result as T;
}

function requireCallableArrayArgument(value: unknown, method: 'callv' | 'bindv'): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Callable.${method} requires an Array.`);
  }
  return value;
}

/** `Callable.call_deferred`: invocation semantics here, scheduling in the caller's real queue. */
export function godotCallableCallDeferred(
  receiver: GodotCallable,
  args: readonly unknown[],
  defer: GodotCallableDeferredHook,
): void {
  defer(() => {
    receiver.call(...args);
  });
}

/** `Callable.rpc` / `rpc_id`: reveal the standard target to the caller's real RPC transport. */
export function godotCallableRpc(
  receiver: GodotCallable,
  args: readonly unknown[],
  send: GodotCallableRpcHook,
  peerId?: number,
): void {
  const object = receiver.getObject();
  const method = receiver.getMethod();
  if (!receiver.isStandard() || object === null || method === '') return;
  send(object, method, peerId, args);
}

export function godotCallableOperator(
  operator: string,
  left: GodotCallable,
  right: unknown,
): unknown {
  switch (operator) {
    case '==':
      return left.equals(right);
    case '!=':
      return !left.equals(right);
    case 'not':
      return left.isNull();
    case 'in':
      if (Array.isArray(right)) return right.some((entry) => left.equals(entry));
      if (right instanceof Map) return [...right.keys()].some((entry) => left.equals(entry));
      return false;
    default:
      throw new Error(`godot-compat: unsupported Callable operator ${operator}`);
  }
}

function methodOf(object: unknown, method: string | undefined): GodotCallableMethod | undefined {
  if ((typeof object !== 'object' && typeof object !== 'function') || object === null || !method) {
    return undefined;
  }
  const candidate = Reflect.get(object, method) as unknown;
  return typeof candidate === 'function' ? (candidate as GodotCallableMethod) : undefined;
}

/** A translated scene class exposes Godot's freed state directly; plain RefCounted-like values live. */
function objectIsValid(object: unknown): boolean {
  if ((typeof object !== 'object' && typeof object !== 'function') || object === null) return false;
  const isFreed = Reflect.get(object, 'isFreed') as unknown;
  return typeof isFreed !== 'function' || isFreed.call(object) !== true;
}
