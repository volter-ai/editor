/** Godot 4.7 NodePath value, copied from core/string/node_path.cpp. */
export interface GodotNodePath {
  readonly absolute: boolean;
  readonly names: readonly string[];
  readonly subnames: readonly string[];
}

/** Structural Variant guard shared by stringify/type-conversion boundaries. NodePath is a value
 * type, not an Object and not a String; accepting an arbitrary object with one coincidental field
 * would make Variant.typeof/str disagree with the method protocol below. */
export function isGodotNodePath(value: unknown): value is GodotNodePath {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<GodotNodePath>;
  return (
    typeof candidate.absolute === 'boolean' &&
    Array.isArray(candidate.names) &&
    candidate.names.every((name) => typeof name === 'string') &&
    Array.isArray(candidate.subnames) &&
    candidate.subnames.every((name) => typeof name === 'string')
  );
}

export function godotNodePathNew(from: GodotNodePath | string = ''): GodotNodePath {
  if (typeof from !== 'string') {
    if (!isGodotNodePath(from)) {
      throw new TypeError('godot-compat: NodePath constructor requires a String or NodePath value.');
    }
    return { absolute: from.absolute, names: [...from.names], subnames: [...from.subnames] };
  }
  if (from.length === 0) return { absolute: false, names: [], subnames: [] };
  const colon = from.indexOf(':');
  const path = colon === -1 ? from : from.slice(0, colon);
  const subpath = colon === -1 ? '' : from.slice(colon + 1);
  return {
    absolute: path.startsWith('/'),
    names: path
      .slice(path.startsWith('/') ? 1 : 0)
      .split('/')
      .filter(Boolean),
    subnames: subpath.length === 0 ? [] : subpath.split(':').filter(Boolean),
  };
}

export function godotNodePathString(value: GodotNodePath): string {
  if (!isGodotNodePath(value)) {
    throw new TypeError('godot-compat: NodePath stringify requires a NodePath value.');
  }
  const path = `${value.absolute ? '/' : ''}${value.names.join('/')}`;
  return value.subnames.length === 0 ? path : `${path}:${value.subnames.join(':')}`;
}

function sliceIndex(value: number, count: number): number {
  const clamped = Math.max(-count, Math.min(count, value));
  return clamped < 0 ? clamped + count : clamped;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function godotNodePathCall<T = unknown>(
  receiver: GodotNodePath,
  method: string,
  args: readonly unknown[],
): T {
  let result: unknown;
  switch (method) {
    case 'is_absolute':
      result = receiver.absolute;
      break;
    case 'get_name_count':
      result = receiver.names.length;
      break;
    case 'get_name':
      result = receiver.names[Number(args[0])] ?? '';
      break;
    case 'get_subname_count':
      result = receiver.subnames.length;
      break;
    case 'get_subname':
      result = receiver.subnames[Number(args[0])] ?? '';
      break;
    case 'get_concatenated_names':
      result = receiver.names.join('/');
      break;
    case 'get_concatenated_subnames':
      result = receiver.subnames.join(':');
      break;
    case 'hash': {
      const hash = hashString(`${receiver.names.join('/')}\0${receiver.subnames.join(':')}`);
      result = receiver.absolute ? hash : ~hash >>> 0;
      break;
    }
    case 'slice': {
      const total = receiver.names.length + receiver.subnames.length;
      const begin = sliceIndex(Number(args[0]), total);
      const end = sliceIndex(Number(args[1] ?? 2147483647), total);
      result = {
        absolute: receiver.absolute && begin === 0,
        names: receiver.names.slice(begin, end),
        subnames: receiver.subnames.slice(
          Math.max(begin - receiver.names.length, 0),
          Math.max(end - receiver.names.length, 0),
        ),
      } satisfies GodotNodePath;
      break;
    }
    case 'get_as_property_path':
      result =
        receiver.names.length === 0
          ? godotNodePathNew(receiver)
          : ({
              absolute: false,
              names: [],
              subnames: [receiver.names.join('/'), ...receiver.subnames],
            } satisfies GodotNodePath);
      break;
    case 'is_empty':
      result = receiver.names.length === 0 && receiver.subnames.length === 0 && !receiver.absolute;
      break;
    default:
      throw new Error(`godot-compat: unsupported NodePath.${method}`);
  }
  return result as T;
}

function equal(a: GodotNodePath, b: unknown): boolean {
  return (
    typeof b === 'object' &&
    b !== null &&
    'names' in b &&
    godotNodePathString(a) === godotNodePathString(b as GodotNodePath)
  );
}

export function godotNodePathOperator(
  operator: string,
  left: GodotNodePath,
  right: unknown,
): unknown {
  switch (operator) {
    case '==':
      return equal(left, right);
    case '!=':
      return !equal(left, right);
    case 'not':
      return godotNodePathCall(left, 'is_empty', []);
    case 'in':
      if (Array.isArray(right)) return right.some((entry) => equal(left, entry));
      if (right instanceof Map) return [...right.keys()].some((entry) => equal(left, entry));
      return false;
    default:
      throw new Error(`godot-compat: unsupported NodePath operator ${operator}`);
  }
}
