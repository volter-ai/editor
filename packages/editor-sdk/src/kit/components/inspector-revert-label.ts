/**
 * The ONE sentence the inspector's revert arrow says, as a pure function of the
 * descriptor.
 *
 * Extracted rather than inlined in `Inspector.tsx` because the rule it encodes
 * is a product contract worth a test — the arrow NAMES its destination when the
 * adapter knows it (`Revert speed to 1.55`) and admits it doesn't when it
 * doesn't (`Revert speed to default`) — while mounting the whole Inspector panel
 * to assert a tooltip would be exactly the brittle DOM transcript the
 * test-proportionality rule bans.
 *
 * One string serves both the accessible name and the tooltip: two phrasings of
 * the same action is the "three paraphrases" failure this design explicitly
 * legislates against (doctrine rule 2).
 */
export function revertActionLabel(property: { label: string; revertsTo?: string }): string {
  return property.revertsTo === undefined
    ? `Revert ${property.label} to default`
    : `Revert ${property.label} to ${property.revertsTo}`;
}
