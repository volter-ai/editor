/** Canonical support identity for a dynamic non-call property routed through compat at runtime. */
export const OPEN_VARIANT_PROPERTY_PREFIX = 'Variant.@property:';

export function openVariantPropertyMember(name: string): string {
  return `${OPEN_VARIANT_PROPERTY_PREFIX}${name}`;
}

export function isOpenVariantPropertyMember(member: string): boolean {
  return member.startsWith(OPEN_VARIANT_PROPERTY_PREFIX);
}
