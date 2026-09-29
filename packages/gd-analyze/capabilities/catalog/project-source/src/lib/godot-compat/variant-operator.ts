/**
 * @godot-class Variant
 * @role PROTOCOL
 *
 * An operator where analysis leaves an operand untyped (`OPCODE_OPERATOR`,
 * `modules/gdscript/gdscript_vm.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * `Variant::evaluate` selects the evaluator by the kinds of value the operands hold at run time
 * (`core/variant/variant_op.cpp`), and so does this. Numbers, text, booleans, Arrays and the
 * numeric built-in records (vectors, colours) are evaluated as their typed operators are; a
 * record's arithmetic is member-wise, with a number broadcast over the members.
 *
 * Where Godot differs: compat holds an int and a float as the same JS number, so `/` and `%` of
 * two untyped ints divide as floats do. A pair of kinds with no evaluator throws Godot's error.
 */

import { godot_variant_equal } from './variant-equal';

/** A Variant: whatever the value holds, as the script uses it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Variant = any;


/** `Variant::Operator` (`core/variant/variant.h:519`). */
const OP_EQUAL = 0;
const OP_NOT_EQUAL = 1;
const OP_LESS = 2;
const OP_LESS_EQUAL = 3;
const OP_GREATER = 4;
const OP_GREATER_EQUAL = 5;
const OP_ADD = 6;
const OP_SUBTRACT = 7;
const OP_MULTIPLY = 8;
const OP_DIVIDE = 9;
const OP_NEGATE = 10;
const OP_POSITIVE = 11;
const OP_MODULE = 12;
const OP_POWER = 13;
const OP_SHIFT_LEFT = 14;
const OP_SHIFT_RIGHT = 15;
const OP_BIT_AND = 16;
const OP_BIT_OR = 17;
const OP_BIT_XOR = 18;
const OP_BIT_NEGATE = 19;
const OP_AND = 20;
const OP_OR = 21;
const OP_XOR = 22;
const OP_NOT = 23;
const OP_IN = 24;

type NumericRecord = Readonly<Record<string, number>>;

function isNumericRecord(value: unknown): value is NumericRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.isFrozen(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every((member) => typeof member === 'number')
  );
}

function truth(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value !== '';
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Map) return value.size > 0;
  if (isNumericRecord(value)) return Object.values(value).some((member) => member !== 0);
  return true;
}

function arithmetic(op: number, a: number, b: number): number {
  switch (op) {
    case OP_ADD:
      return a + b;
    case OP_SUBTRACT:
      return a - b;
    case OP_MULTIPLY:
      return a * b;
    case OP_DIVIDE:
      return a / b;
    case OP_MODULE:
      return a % b;
    case OP_POWER:
      return a ** b;
    default:
      return Number.NaN;
  }
}

function memberwise(op: number, a: unknown, b: unknown): NumericRecord | undefined {
  const shape = isNumericRecord(a) ? a : isNumericRecord(b) ? b : undefined;
  if (shape === undefined) return undefined;
  const left = (key: string) => (typeof a === 'number' ? a : (a as NumericRecord)[key]);
  const right = (key: string) => (typeof b === 'number' ? b : (b as NumericRecord)[key]);
  const out: Record<string, number> = {};
  for (const key of Object.keys(shape)) {
    const l = left(key);
    const r = right(key);
    if (l === undefined || r === undefined) return undefined;
    out[key] = arithmetic(op, l, r);
  }
  return Object.freeze(out);
}

function compare(a: unknown, b: unknown): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (isNumericRecord(a) && isNumericRecord(b)) {
    // Vectors compare member by member, the first unequal member deciding (`Vector3::operator<`).
    for (const key of Object.keys(a)) {
      const l = a[key] as number;
      const r = b[key];
      if (r === undefined) return undefined;
      if (l !== r) return l - r;
    }
    return 0;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      const order = compare(a[index], b[index]);
      if (order === undefined) return undefined;
      if (order !== 0) return order;
    }
    return a.length - b.length;
  }
  return undefined;
}

function kind(value: unknown): string {
  if (value === null || value === undefined) return 'Nil';
  if (Array.isArray(value)) return 'Array';
  if (value instanceof Map) return 'Dictionary';
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') return 'float';
  if (typeof value === 'boolean') return 'bool';
  return isNumericRecord(value) ? 'Vector' : 'Object';
}

/**
 * `a <op> b` (or `<op> a`) on values whose types are known only at run time.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant_op.cpp:1041
 */
export function godot_variant_evaluate(op: number, a: unknown, b?: unknown): Variant {
  const invalid = (): never => {
    throw new Error(`Invalid operands '${kind(a)}' and '${kind(b)}' in operator ${String(op)}.`);
  };
  switch (op) {
    case OP_EQUAL:
      return godot_variant_equal(a, b);
    case OP_NOT_EQUAL:
      return !godot_variant_equal(a, b);
    case OP_LESS:
    case OP_LESS_EQUAL:
    case OP_GREATER:
    case OP_GREATER_EQUAL: {
      const order = compare(a, b) ?? invalid();
      return op === OP_LESS ? order < 0 : op === OP_LESS_EQUAL ? order <= 0 : op === OP_GREATER ? order > 0 : order >= 0;
    }
    case OP_AND:
      return truth(a) && truth(b);
    case OP_OR:
      return truth(a) || truth(b);
    case OP_XOR:
      return truth(a) !== truth(b);
    case OP_NOT:
      return !truth(a);
    case OP_NEGATE:
      if (typeof a === 'number') return -a;
      return memberwise(OP_SUBTRACT, 0, a) ?? invalid();
    case OP_POSITIVE:
      return typeof a === 'number' || isNumericRecord(a) ? a : invalid();
    case OP_BIT_NEGATE:
      return typeof a === 'number' ? ~a : invalid();
    case OP_SHIFT_LEFT:
    case OP_SHIFT_RIGHT:
    case OP_BIT_AND:
    case OP_BIT_OR:
    case OP_BIT_XOR: {
      if (typeof a !== 'number' || typeof b !== 'number') return invalid();
      const x = BigInt.asIntN(64, BigInt(Math.trunc(a)));
      const y = BigInt.asIntN(64, BigInt(Math.trunc(b)));
      const out = op === OP_SHIFT_LEFT ? x << y : op === OP_SHIFT_RIGHT ? x >> y : op === OP_BIT_AND ? x & y : op === OP_BIT_OR ? x | y : x ^ y;
      return Number(BigInt.asIntN(64, out));
    }
    case OP_IN:
      if (Array.isArray(b)) return b.some((element) => godot_variant_equal(element, a));
      if (b instanceof Map) return b.has(a);
      if (typeof b === 'string' && typeof a === 'string') return b.includes(a);
      return invalid();
    default: {
      if (typeof a === 'number' && typeof b === 'number') return arithmetic(op, a, b);
      if (op === OP_ADD && typeof a === 'string' && typeof b === 'string') return a + b;
      if (op === OP_ADD && Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      return memberwise(op, a, b) ?? invalid();
    }
  }
}
