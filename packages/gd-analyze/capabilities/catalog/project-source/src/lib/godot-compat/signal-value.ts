import { GodotCallable } from './callable';
import { godotOpenObjectSignalCall, godotRetainedSignalValueOwner } from './object';
import {
  isSignalHandle,
  type GodotSignal,
  type SignalHandle,
} from './signal';

type SignalCallReceiver = GodotSignalValue | SignalHandle<readonly any[]>;

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

function objectId(value: unknown): number {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return 0;
  const object = value as object;
  const found = objectIds.get(object);
  if (found !== undefined) return found;
  const id = nextObjectId++;
  objectIds.set(object, id);
  return id;
}

/** Godot 4.7's first-class `Signal` Variant, over a project-owned signal handle. */
export class GodotSignalValue {
  private constructor(
    readonly object: unknown,
    readonly name: string,
    private readonly signal?: GodotSignal<readonly unknown[]>,
    private readonly emitSignal?: (...args: readonly unknown[]) => void,
  ) {}

  static null(): GodotSignalValue {
    return new GodotSignalValue(null, '');
  }
  static from(value: GodotSignalValue): GodotSignalValue {
    return value;
  }
  static standard(object: unknown, name: string): GodotSignalValue {
    if (object === null || object === undefined || name === '') return GodotSignalValue.null();
    const found = godotRetainedSignalValueOwner(object, name);
    return new GodotSignalValue(object, name, found.signal, found.emit);
  }

  isNull(): boolean {
    return this.object === null || this.object === undefined || this.name === '';
  }
  getObject(): unknown {
    return this.object;
  }
  getObjectId(): number {
    return objectId(this.object);
  }
  getName(): string {
    return this.name;
  }
  connect(callable: GodotCallable, flags = 0): number {
    if (this.signal === undefined || !(callable instanceof GodotCallable) || !callable.isValid()) {
      return 3;
    }
    if (!Number.isInteger(flags) || flags < 0 || (flags & ~15) !== 0) {
      throw new Error(
        `godot-compat: Signal.connect received unsupported script-visible flags ${String(flags)}; ` +
          'only CONNECT_DEFERRED/PERSIST/ONE_SHOT/REFERENCE_COUNTED (1/2/4/8) exist.',
      );
    }
    if ((flags & 1) !== 0) {
      throw new Error(
        'godot-compat: Signal.connect CONNECT_DEFERRED requires the Godot MessageQueue ordering ' +
          'which this direct EventTarget signal does not own.',
      );
    }
    if (this.signal.isConnected(callable) && (flags & 8) === 0) return 31;
    this.signal.connect(
      (...args) => callable.call(...args),
      { oneShot: (flags & 4) !== 0, flags },
      callable,
    );
    return 0;
  }
  disconnect(callable: GodotCallable): void {
    if (!(callable instanceof GodotCallable)) {
      throw new TypeError('godot-compat: Signal.disconnect requires a Callable.');
    }
    this.signal?.disconnect(callable);
  }
  isConnected(callable: GodotCallable): boolean {
    if (!(callable instanceof GodotCallable)) {
      throw new TypeError('godot-compat: Signal.is_connected requires a Callable.');
    }
    return this.signal?.isConnected(callable) ?? false;
  }
  getConnections(): unknown[] {
    return (this.signal?.getConnections() ?? []).map(({ callable, flags }) => ({
      signal: this,
      callable,
      flags,
    }));
  }
  hasConnections(): boolean {
    return this.signal?.hasConnections() ?? false;
  }
  emit(...args: readonly unknown[]): void {
    if (this.emitSignal === undefined) {
      throw new Error(
        'godot-compat: Signal.emit requires an authored user/script signal; native and missing ' +
          'signal emitters are private.',
      );
    }
    this.emitSignal(...args);
  }
  equals(other: unknown): boolean {
    return (
      other instanceof GodotSignalValue && this.object === other.object && this.name === other.name
    );
  }
}

export function godotSignalNew(...args: unknown[]): GodotSignalValue {
  if (args.length === 0) return GodotSignalValue.null();
  if (args.length === 1) {
    if (!(args[0] instanceof GodotSignalValue)) {
      throw new TypeError('godot-compat: Signal copy constructor requires a Signal.');
    }
    return GodotSignalValue.from(args[0]);
  }
  if (args.length === 2) {
    if (typeof args[1] !== 'string') {
      throw new TypeError('godot-compat: Signal(object, signal) requires a StringName.');
    }
    return GodotSignalValue.standard(args[0], args[1]);
  }
  throw new Error(`godot-compat: unsupported Signal constructor arity ${args.length}`);
}

/** Object.get_signal_connection_list over the same underlying signal slot map as Signal values. */
export function godotObjectSignalConnectionList(object: unknown, name: string): unknown[] {
  return GodotSignalValue.standard(object, name).getConnections();
}

export function godotSignalCall(
  receiver: SignalCallReceiver,
  method: 'is_null' | 'is_connected' | 'has_connections',
  args: readonly unknown[],
): boolean;
export function godotSignalCall(
  receiver: SignalCallReceiver,
  method: 'get_object_id' | 'connect',
  args: readonly unknown[],
): number;
export function godotSignalCall(
  receiver: SignalCallReceiver,
  method: 'get_name',
  args: readonly unknown[],
): string;
export function godotSignalCall(
  receiver: SignalCallReceiver,
  method: 'get_connections',
  args: readonly unknown[],
): readonly unknown[];
export function godotSignalCall<T = unknown>(
  receiver: SignalCallReceiver,
  method: string,
  args: readonly unknown[],
): T;
export function godotSignalCall<T = unknown>(
  receiver: SignalCallReceiver,
  method: string,
  args: readonly unknown[],
): T {
  const arity: Readonly<Record<string, readonly number[]>> = {
    is_null: [0], get_object: [0], get_object_id: [0], get_name: [0],
    connect: [1, 2], disconnect: [1], is_connected: [1], get_connections: [0],
    has_connections: [0], emit: [],
  };
  const accepted = arity[method];
  if (accepted === undefined || (method !== 'emit' && !accepted.includes(args.length))) {
    throw new TypeError(`godot-compat: Signal.${method} received ${args.length} arguments.`);
  }
  let result: unknown;
  switch (method) {
    case 'is_null':
      result = receiver instanceof GodotSignalValue ? receiver.isNull() : false;
      break;
    case 'get_object':
      if (!(receiver instanceof GodotSignalValue)) {
        throw new TypeError('godot-compat: a raw script SignalHandle does not retain its owner object.');
      }
      result = receiver.getObject();
      break;
    case 'get_object_id':
      if (!(receiver instanceof GodotSignalValue)) {
        throw new TypeError('godot-compat: a raw script SignalHandle does not retain its owner object id.');
      }
      result = receiver.getObjectId();
      break;
    case 'get_name':
      if (!(receiver instanceof GodotSignalValue)) {
        throw new TypeError('godot-compat: a raw script SignalHandle does not retain its authored name.');
      }
      result = receiver.getName();
      break;
    case 'connect': {
      if (receiver instanceof GodotSignalValue) {
        result = receiver.connect(args[0] as GodotCallable, (args[1] ?? 0) as number);
        break;
      }
      const handle = receiver;
      const callable = args[0];
      const flags = (args[1] ?? 0) as number;
      if (!(callable instanceof GodotCallable) || !callable.isValid()) {
        result = 3;
        break;
      }
      if (!Number.isInteger(flags) || flags < 0 || (flags & ~15) !== 0) {
        throw new Error(
          `godot-compat: Signal.connect received unsupported script-visible flags ${String(flags)}; ` +
            'only CONNECT_DEFERRED/PERSIST/ONE_SHOT/REFERENCE_COUNTED (1/2/4/8) exist.',
        );
      }
      if ((flags & 1) !== 0) {
        throw new Error(
          'godot-compat: Signal.connect CONNECT_DEFERRED requires the Godot MessageQueue ordering ' +
            'which this direct EventTarget signal does not own.',
        );
      }
      if (handle.signal.isConnected(callable) && (flags & 8) === 0) {
        result = 31;
        break;
      }
      handle.signal.connect(
        (...emitted) => callable.call(...emitted),
        { oneShot: (flags & 4) !== 0, flags },
        callable,
      );
      result = 0;
      break;
    }
    case 'disconnect':
      if (!(args[0] instanceof GodotCallable)) {
        throw new TypeError('godot-compat: Signal.disconnect requires a Callable.');
      }
      if (receiver instanceof GodotSignalValue) receiver.disconnect(args[0]);
      else receiver.signal.disconnect(args[0]);
      result = null;
      break;
    case 'is_connected':
      if (!(args[0] instanceof GodotCallable)) {
        throw new TypeError('godot-compat: Signal.is_connected requires a Callable.');
      }
      result = receiver instanceof GodotSignalValue
        ? receiver.isConnected(args[0])
        : receiver.signal.isConnected(args[0]);
      break;
    case 'get_connections':
      result = receiver instanceof GodotSignalValue
        ? receiver.getConnections()
        : receiver.signal.getConnections().map(({ callable, flags }) => ({
            signal: receiver,
            callable,
            flags,
          }));
      break;
    case 'has_connections':
      result = receiver instanceof GodotSignalValue
        ? receiver.hasConnections()
        : receiver.signal.hasConnections();
      break;
    case 'emit':
      if (receiver instanceof GodotSignalValue) receiver.emit(...args);
      else receiver.emit(...args);
      result = null;
      break;
    default:
      throw new Error(`godot-compat: unsupported Signal.${method}`);
  }
  return result as T;
}

type OpenSignalOrObjectMethod =
  | 'connect'
  | 'disconnect'
  | 'is_connected'
  | 'get_connections'
  | 'has_connections'
  | 'emit'
  | 'emit_signal';

/** Open Variant signal calls discriminate only retained Signal and retained Object identities. */
export function godotOpenSignalOrObjectCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenSignalOrObjectMethod,
  args: readonly unknown[],
): unknown {
  if (receiver instanceof GodotSignalValue || isSignalHandle(receiver)) {
    if (major !== 4) {
      throw new Error(`godot-compat: first-class Signal.${method} is not declared by Godot 3.x.`);
    }
    if (method === 'emit_signal') {
      throw new Error('godot-compat: Signal values expose emit(...), not emit_signal(...).');
    }
    return godotSignalCall(receiver, method, args);
  }
  if (method === 'emit') {
    throw new TypeError('godot-compat: Variant.emit requires a retained Signal value.');
  }
  if (method === 'get_connections' || method === 'has_connections') {
    throw new TypeError(`godot-compat: Variant.${method} requires a retained Signal value.`);
  }
  return godotOpenObjectSignalCall(receiver, major, method, args);
}

export function godotSignalOperator(
  operator: string,
  left: GodotSignalValue,
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
      throw new Error(`godot-compat: unsupported Signal operator ${operator}`);
  }
}
