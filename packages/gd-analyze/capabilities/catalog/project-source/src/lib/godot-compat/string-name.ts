/** Godot 4.7 StringName value protocol, backed by the shared String algorithms. */

import { godotStringCall, godotStringNew, godotStringNot, godotStringOperator } from './string';

const INTERN_ORDER = new Map<string, number>();
let nextInternOrder = -1;

function internOrder(value: string): number {
  if (value.length === 0) return 0;
  const known = INTERN_ORDER.get(value);
  if (known !== undefined) return known;
  const order = nextInternOrder;
  nextInternOrder -= 1;
  INTERN_ORDER.set(value, order);
  return order;
}

export function godotStringNameNew(value: unknown = ''): string {
  const name = godotStringNew(value);
  internOrder(name);
  return name;
}

export function godotStringNameCall<T = unknown>(
  method: string,
  value: unknown,
  args: readonly unknown[],
): T {
  if (typeof value !== 'string') {
    throw new TypeError(`godot-compat: StringName.${method} requires a retained StringName value.`);
  }
  return godotStringCall<T>(method, value, args);
}

export function godotStringNameOperator(
  operator: '+' | '%',
  left: string,
  right: unknown,
): string;
export function godotStringNameOperator(
  operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in',
  left: string,
  right: unknown,
): boolean;
export function godotStringNameOperator(operator: string, left: string, right: unknown): unknown;
export function godotStringNameOperator(operator: string, left: string, right: unknown): unknown {
  if (operator === '==' || operator === '!=') {
    const equal = typeof right === 'string' && left === right;
    return operator === '==' ? equal : !equal;
  }
  if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
    if (typeof right !== 'string') {
      throw new Error(`godot-compat: StringName ${operator} requires another StringName`);
    }
    const a = internOrder(left);
    const b = internOrder(right);
    if (operator === '<') return a < b;
    if (operator === '<=') return a <= b;
    if (operator === '>') return a > b;
    return a >= b;
  }
  return godotStringOperator(operator, left, right);
}

export const godotStringNameNot = godotStringNot;
