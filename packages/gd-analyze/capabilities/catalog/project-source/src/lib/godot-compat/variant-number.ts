/** Numeric Variant carrier used only where JavaScript would erase Godot's int/float tag. */

export type GodotNumericVariantTag = 'int' | 'float';

const TAGGED_NUMBER = Symbol('godot.numeric-variant');

interface TaggedNumberCarrier {
  readonly [TAGGED_NUMBER]: GodotNumericVariantTag;
  readonly numericValue: number;
  valueOf(): number;
  toString(): string;
  [Symbol.toPrimitive](hint: string): number | string;
}

/**
 * Retain one authored numeric Variant tag while remaining coercible at ordinary JS arithmetic
 * sites. The public return type stays `number`: callers consume the Godot value, while exact
 * Variant operations use the explicit helpers below to observe its otherwise-erased tag.
 */
export function godotTaggedVariantNumber(value: number, tag: GodotNumericVariantTag): number {
  if (typeof value !== 'number' || (tag === 'int' && !Number.isSafeInteger(value))) {
    throw new TypeError(`godot-compat: tagged Variant ${tag} requires an exact numeric payload.`);
  }
  const carrier: TaggedNumberCarrier = {
    [TAGGED_NUMBER]: tag,
    numericValue: value,
    valueOf: () => value,
    toString: () => String(value),
    [Symbol.toPrimitive]: (hint) => (hint === 'string' ? String(value) : value),
  };
  return Object.freeze(carrier) as unknown as number;
}

export function godotNumericVariantTag(value: unknown): GodotNumericVariantTag | undefined {
  return typeof value === 'object' && value !== null && TAGGED_NUMBER in value
    ? (value as TaggedNumberCarrier)[TAGGED_NUMBER]
    : undefined;
}

export function godotNumericVariantValue(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  return godotNumericVariantTag(value) === undefined
    ? undefined
    : (value as TaggedNumberCarrier).numericValue;
}
