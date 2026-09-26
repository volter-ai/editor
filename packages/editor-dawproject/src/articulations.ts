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

/** The bank select and program a note sounds on. */
export interface NotePatch {
  readonly bankSelect: number;
  readonly program: number;
}

/**
 * Each note's patch, for the tracks whose patch changes note by note: a track whose device maps
 * articulations, or whose patch has round-robin members (`roundRobins`), where successive notes
 * of one pitch on one program step through the members. Every note of such a track is listed, so
 * a player sets bank and program before each and carries nothing from the note before.
 *
 * `bankBase(track)` is the bank select a track's device plays at (its bank's offset plus
 * `bankNumber`), or `null` for a track with no soundfont or on the drum channel; `members(track,
 * bankSelect, program)` is how many round-robin members that patch has.
 */
export function notePatches(
  piece: Piece,
  notes: readonly { readonly track: string; readonly pitch: number; readonly artic: string | null }[],
  bankBase: (track: string) => number | null,
  members: (track: string, bankSelect: number, program: number) => number,
): Map<object, NotePatch> {
  const mapped = articulationPrograms(piece);
  const baseProgram = new Map<string, number>();
  for (const track of piece.tracks) {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    baseProgram.set(track.id, typeof device?.params['program'] === 'number' ? device.params['program'] : 0);
  }
  const planned: { note: (typeof notes)[number]; base: number; program: number; count: number }[] = [];
  const varies = new Set<string>(mapped.keys());
  for (const note of notes) {
    const base = bankBase(note.track);
    if (base === null) continue;
    const program = mapped.get(note.track)?.(note.artic) ?? baseProgram.get(note.track) ?? 0;
    const count = members(note.track, base, program);
    if (count > 1) varies.add(note.track);
    planned.push({ note, base, program, count });
  }
  const turn = new Map<string, number>();
  const out = new Map<object, NotePatch>();
  for (const { note, base, program, count } of planned) {
    if (!varies.has(note.track)) continue;
    const key = `${note.track}:${program}:${note.pitch}`;
    const member = turn.get(key) ?? 0;
    turn.set(key, member + 1);
    out.set(note, { bankSelect: base + (member % Math.max(1, count)), program });
  }
  return out;
}
