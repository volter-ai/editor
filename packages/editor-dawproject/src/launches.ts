/**
 * THE CLIP LAUNCHER, as a timeline: what the launched slots play, written out as the arrangement
 * the engine and the export already know how to play.
 *
 * A launch is a stretch of a track's time, in beats of the launcher's own timeline (it starts at 0
 * when the first slot is launched from a stopped transport): from its `from` to its `to` (or on
 * without end), the track loops the clip in one scene's slot. {@link launchedPiece} lays those
 * loops out as ordinary clips, so `perform`, the live mix and the offline mix play a launched scene
 * exactly as they play an arrangement: nothing downstream knows a launcher exists.
 *
 * In the launched piece a track plays only its launches: the arrangement, its track lanes and its
 * tempo lane stay out (a scene is a state of the music; what the timeline did around it is not).
 */
import type { Piece, PieceClip, PieceScene, PieceTrack } from '@volter/dawproject/piece';

/** One stretch of a track's launcher time: the scene whose slot it loops, from `from` until `to` beats. */
export interface Launch {
  readonly scene: string;
  readonly from: number;
  readonly to: number | null;
}

/** Each track's launches, by track id, in time order; the last may run on (`to` null). */
export type Launches = ReadonlyMap<string, readonly Launch[]>;

/** The clip in `scene`'s slot for `track`, or `null` when the scene has none (or an empty slot). */
export function slotClip(scene: PieceScene | undefined, track: PieceTrack): PieceClip | null {
  return scene?.slots.find((slot) => slot.track === track.name)?.clip ?? null;
}

/** Every clip a track may play: its arrangement's and its launcher slots'. */
export function everyClip(piece: Piece, track: PieceTrack): PieceClip[] {
  const slots = piece.scenes.map((scene) => slotClip(scene, track)).filter((clip): clip is PieceClip => clip !== null);
  return [...track.clips, ...slots];
}

/** The clip moved to start at `start` beats, cut at `end`: its notes and lane points move with it. */
function placed(clip: PieceClip, start: number, end: number, copy: number): PieceClip {
  const duration = Math.min(clip.duration, end - start);
  return {
    ...clip,
    id: `${clip.id}@${copy}`,
    time: start,
    duration,
    notes: clip.notes.filter((note) => note.time < duration).map((note) => ({ ...note, id: `${note.id}@${copy}`, start: start + note.time })),
    lanes: clip.lanes.map((lane) => ({ ...lane, points: lane.points.map((point) => ({ ...point, time: start + point.time })) })),
    comps: clip.comps.map((comp) => ({ ...comp, time: start + comp.time })),
  };
}

/**
 * The piece as the launcher plays it up to beat `horizon`: each track's launches laid out as its
 * slot clip, repeated end to end from each launch's `from` and cut at its `to`. A slot edited while
 * it plays is heard at once, since each call reads the latest piece.
 */
export function launchedPiece(piece: Piece, launches: Launches, horizon: number): Piece {
  const scenes = new Map(piece.scenes.map((scene) => [scene.id, scene]));
  return {
    ...piece,
    transport: { ...piece.transport, tempoPoints: null },
    markers: [],
    length: horizon,
    tracks: piece.tracks.map((track) => {
      const clips: PieceClip[] = [];
      for (const launch of launches.get(track.id) ?? []) {
        const clip = slotClip(scenes.get(launch.scene), track);
        if (!clip || clip.duration <= 0) continue;
        const end = Math.min(launch.to ?? horizon, horizon);
        for (let start = launch.from; start < end - 1e-9; start += clip.duration) {
          clips.push(placed(clip, start, end, clips.length));
        }
      }
      return { ...track, clips, lanes: [] };
    }),
  };
}

/** What a track's launcher is doing at `beat`: the scene it loops, and the change queued after. */
export function launchAt(launches: readonly Launch[] | undefined, beat: number): { readonly playing: string | null; readonly queued: string | 'stop' | null } {
  let playing: string | null = null;
  let queued: string | 'stop' | null = null;
  for (const launch of launches ?? []) {
    if (launch.from <= beat + 1e-9 && (launch.to === null || launch.to > beat + 1e-9)) playing = launch.scene;
    else if (launch.from > beat + 1e-9) queued = launch.scene;
  }
  const last = launches?.[launches.length - 1];
  if (!queued && playing && last && last.scene === playing && last.to !== null && last.to > beat + 1e-9) queued = 'stop';
  return { playing, queued };
}
