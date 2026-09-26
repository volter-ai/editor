/**
 * WHICH PATCH PLAYS A NOTE: a soundfont device's `articulations` maps a note's `artic` to the
 * program in the same bank that records it apart (`{ staccato: 101, pizzicato: 102 }`); any other
 * note plays on the device's `program`. The preview and the export both ask here, and both select
 * the note's patch on its channel just before the note sounds (a patch change leaves notes already
 * sounding on the patch they started with).
 */

import type { Piece } from '@volter/dawproject/piece';

/** For each track whose device maps articulations: the program a note with `artic` plays. */
export function articulationPrograms(piece: Piece): Map<string, (artic: string | null) => number> {
  const out = new Map<string, (artic: string | null) => number>();
  for (const track of piece.tracks) {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    const map = device?.params['articulations'];
    if (!device || !map || typeof map !== 'object' || Array.isArray(map)) continue;
    const base = typeof device.params['program'] === 'number' ? device.params['program'] : 0;
    const programs = map as Readonly<Record<string, number>>;
    out.set(track.id, (artic) => (artic !== null && typeof programs[artic] === 'number' ? programs[artic]! : base));
  }
  return out;
}
