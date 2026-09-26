/**
 * WHO IS PLAYING, and under what identity — the host's own declaration for one
 * private play run or coordinated team test.
 *
 * Its own module because it is a PUBLISHED path: a project's Colyseus
 * networking adapter (the `colyseus` capability, copied into every game) names
 * this type, so it must live somewhere that survives. The engine never joins a
 * room and never couples this authoring identity to a networking library —
 * games may pass `roomKey` as a Colyseus filter/join option, and that is the
 * whole of the coupling.
 */

/** Host-supplied identity for one private play run or coordinated team test.
 * Games may pass `roomKey` as a Colyseus filter/join option; the engine never
 * joins a room or couples this authoring identity to a networking library. */
export interface PlaytestContext {
  readonly mode: 'private' | 'team';
  readonly id: string;
  readonly roomKey: string;
  readonly revision: number | null;
  readonly participantId: string | null;
}
