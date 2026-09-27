/**
 * THE CLIP LAUNCHER, as Bitwig Studio lays it out beside its arranger: a row per instrument
 * track, a column per `<Scene>`, and in each cell the `<ClipSlot>` that track has in that scene.
 *
 *   ▶ on a scene            launches it: every track loops its clip in that scene from the next
 *                           bar, and tracks the scene has no clip for stop
 *   ▶ on a slot             launches that one clip on its track, from the next bar
 *   ■ on a track            stops that track at the next bar
 *   click a slot            selects its clip: the clip editor below edits it
 *   double-click a cell     a new one-bar clip in that scene for that track
 *   double-click a scene    renames it in place (Enter writes, Escape leaves it)
 *   + Scene                 a new empty scene after the last one
 *   Delete / Backspace      the selected slot, with its clip
 *
 * What plays and what is queued is the engine's (`PreviewEngine.launcher`): view state, never
 * written into the piece. Every edit writes the piece's own source, one undo entry each.
 */

import type { Piece, PieceScene, PieceSlot, PieceTrack } from '@volter/dawproject/piece';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { type ArrangerWrites, trackColor } from './Arranger';
import { type Launches, launchAt } from './launches';
import { createElement, recordStructWrite, setProps, writeStruct } from './source-index';

const HEADER_W = 190;
const CELL_W = 120;
const ROW_H = 34;

const small: CSSProperties = { fontSize: 11, color: themeVars.content.muted };
const button: CSSProperties = {
  background: themeVars.surface.raised,
  color: themeVars.content.primary,
  border: `1px solid ${themeVars.boundary.default}`,
  borderRadius: 3,
  padding: '0 6px',
  fontSize: 11,
  cursor: 'pointer',
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The tracks that have launcher slots: instrument and audio tracks, not buses, groups or the master. */
export function launcherTracks(piece: Piece): PieceTrack[] {
  return piece.tracks.filter((track) => (track.channel?.role ?? 'regular') === 'regular');
}

export function Launcher(props: {
  readonly piece: Piece;
  /** The engine's launcher reading now, or `null` while it is not what plays. */
  readonly launcher: { readonly launches: Launches; readonly beat: number } | null;
  readonly selectedClip: string | null;
  readonly onSelectClip: (clipId: string, trackId: string) => void;
  readonly onLaunchScene: (sceneId: string) => void;
  readonly onLaunchSlot: (trackId: string, sceneId: string | null) => void;
  readonly active: boolean;
  readonly writes: ArrangerWrites;
}) {
  const { piece, writes } = props;
  const tracks = launcherTracks(piece);
  const [renaming, setRenaming] = useState<string | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const where = { index: writes.index, pieceFile: writes.file, documentId: writes.documentId };
  const say = (error: unknown): void => writes.onMessage(messageOf(error));
  const own = (oid: string | null): oid is string => oid !== null && (piece.oidCounts.get(oid) ?? 0) === 1;

  const addScene = (): void => {
    container.current?.focus({ preventScroll: true });
    const names = new Set(piece.scenes.map((scene) => scene.name));
    let number = piece.scenes.length + 1;
    while (names.has(`Scene ${number}`)) number++;
    const snippet = `<Scene name="Scene ${number}" />`;
    // After the last scene; the piece's first goes after its last top-level track.
    const after = piece.scenes.at(-1)?.oid ?? piece.tracks.filter((track) => track.parent === null).at(-1)?.oid ?? piece.transport.oid;
    if (!own(after)) {
      writes.onMessage('The element a new scene would follow is generated, so the scene has no single place to go.');
      return;
    }
    writes.onMessage(null);
    createElement('Add Scene', after, 'after', snippet, where, writes.onMessage).catch(say);
  };

  const addSlot = (scene: PieceScene, track: PieceTrack): void => {
    if (!own(scene.oid)) {
      writes.onMessage(`${scene.name} is generated: one <Scene> in the source renders it more than once, so a clip has no single place to go.`);
      return;
    }
    const empty = scene.slots.find((slot) => slot.track === track.name);
    if (empty) {
      // A slot written without a clip: the clip goes inside it.
      if (!own(empty.oid)) return;
      writes.onMessage(null);
      createElement('Add Clip', empty.oid, 'child', '<Clip bars={1} />', where, writes.onMessage).catch(say);
      return;
    }
    writes.onMessage(null);
    createElement('Add Clip', scene.oid, 'child', `<ClipSlot track=${JSON.stringify(track.name)}><Clip bars={1} /></ClipSlot>`, where, writes.onMessage).catch(say);
  };

  const renameScene = (scene: PieceScene, name: string): void => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === scene.name) return;
    if (!own(scene.oid)) {
      writes.onMessage(`${scene.name} is generated, so its name is not written in one place.`);
      return;
    }
    setProps('Rename Scene', writes.index, scene.oid, { name: trimmed }, { file: writes.file, documentId: writes.documentId }).catch(say);
  };

  const selectedSlot = piece.scenes.flatMap((scene) => scene.slots).find((slot) => slot.clip && slot.clip.id === props.selectedClip) ?? null;

  const deleteSlot = (slot: PieceSlot): void => {
    if (!own(slot.oid)) {
      writes.onMessage('This slot is generated: one <ClipSlot> in the source renders it more than once, so it has no element of its own to delete.');
      return;
    }
    writes.onMessage(null);
    writeStruct(slot.oid, 'delete').then((write) => {
      if (write) recordStructWrite('Delete Clip', write, where, writes.onMessage);
    }, say);
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (!props.active) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedSlot) {
      event.preventDefault();
      event.stopPropagation();
      deleteSlot(selectedSlot);
    }
  };

  return (
    <div
      ref={container}
      tabIndex={-1}
      data-launcher=""
      onKeyDown={onKeyDown}
      onPointerDownCapture={() => container.current?.focus({ preventScroll: true })}
      style={{ display: 'flex', flexDirection: 'column', minWidth: HEADER_W + CELL_W * (piece.scenes.length + 1), outline: 'none' }}
    >
      <div style={{ display: 'flex', height: ROW_H, borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        <div style={{ width: HEADER_W, flex: 'none', display: 'flex', alignItems: 'center', padding: '0 8px', ...small, borderRight: `1px solid ${themeVars.boundary.default}` }}>
          Scenes
        </div>
        {piece.scenes.map((scene) => (
          <div key={scene.id} data-scene={scene.name} style={{ width: CELL_W, flex: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', borderRight: `1px solid ${themeVars.boundary.default}` }}>
            <button type="button" data-launch-scene={scene.name} title={`Launch ${scene.name}`} onClick={() => props.onLaunchScene(scene.id)} style={button}>
              ▶
            </button>
            {renaming === scene.id ? (
              <input
                data-scene-name-input=""
                defaultValue={scene.name}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key !== 'Enter' && event.key !== 'Escape') return;
                  const text = event.currentTarget.value;
                  container.current?.focus({ preventScroll: true });
                  setRenaming(null);
                  if (event.key === 'Enter') renameScene(scene, text);
                }}
                onBlur={() => setRenaming(null)}
                style={{ width: 80, fontSize: 11 }}
              />
            ) : (
              <span data-scene-name="" onDoubleClick={() => setRenaming(scene.id)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}>
                {scene.name}
              </span>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px' }}>
          <button type="button" data-control="add-scene" onClick={addScene} style={button}>
            + Scene
          </button>
        </div>
      </div>
      {tracks.map((track) => {
        const color = trackColor(track, piece.tracks.indexOf(track));
        const state = props.launcher ? launchAt(props.launcher.launches.get(track.id), props.launcher.beat) : { playing: null, queued: null };
        return (
          <div key={track.id} data-launcher-track={track.name} style={{ display: 'flex', height: ROW_H, borderBottom: `1px solid ${themeVars.boundary.default}` }}>
            <div style={{ width: HEADER_W, flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderRight: `1px solid ${themeVars.boundary.default}` }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: 'none' }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</span>
              <button
                type="button"
                data-stop-track={track.name}
                title={`Stop ${track.name} at the next bar`}
                onClick={() => props.onLaunchSlot(track.id, null)}
                style={{ ...button, color: state.queued === 'stop' ? themeVars.semantic.danger : themeVars.content.muted }}
              >
                ■
              </button>
            </div>
            {piece.scenes.map((scene) => {
              const slot = scene.slots.find((candidate) => candidate.track === track.name);
              const clip = slot?.clip ?? null;
              const playing = state.playing === scene.id;
              const queued = state.queued === scene.id;
              return (
                <div
                  key={scene.id}
                  data-slot-cell={`${scene.name}/${track.name}`}
                  onDoubleClick={(event) => {
                    if (!clip && event.target === event.currentTarget) addSlot(scene, track);
                  }}
                  style={{ width: CELL_W, flex: 'none', padding: 3, borderRight: `1px solid ${themeVars.boundary.default}`, boxSizing: 'border-box' }}
                >
                  {clip ? (
                    <div
                      data-slot={`${scene.name}/${track.name}`}
                      data-slot-state={playing ? 'playing' : queued ? 'queued' : 'stopped'}
                      onClick={() => props.onSelectClip(clip.id, track.id)}
                      style={{
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '0 4px',
                        borderRadius: 3,
                        cursor: 'pointer',
                        background: `${color}${playing ? 'aa' : '44'}`,
                        outline: props.selectedClip === clip.id ? `1px solid ${themeVars.content.primary}` : queued ? `1px dashed ${color}` : 'none',
                      }}
                    >
                      <button
                        type="button"
                        data-launch-slot={`${scene.name}/${track.name}`}
                        title={`Launch this clip on ${track.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onLaunchSlot(track.id, scene.id);
                        }}
                        style={{ ...button, padding: '0 4px', background: 'transparent', border: 'none' }}
                      >
                        {playing ? '▷' : '▶'}
                      </button>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                        {clip.name ?? (clip.audio ? clip.audio.file.replace(/^.*\//, '') : `${clip.notes.length} notes`)} · {clip.duration / piece.transport.beatsPerBar} bar
                        {clip.duration === piece.transport.beatsPerBar ? '' : 's'}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      {piece.scenes.length === 0 ? (
        <div style={{ padding: 12, ...small }}>
          No scenes yet. A scene is a row of clips launched together: one state of the music (explore, combat, calm). + Scene adds one.
        </div>
      ) : null}
    </div>
  );
}

/** The engine's launcher reading, polled each frame while the transport plays. */
export function useLauncherReading(read: () => { readonly launches: Launches; readonly beat: number } | null, playing: boolean) {
  const [reading, setReading] = useState<ReturnType<typeof read>>(null);
  useEffect(() => {
    if (!playing) {
      setReading(null);
      return;
    }
    let frame = 0;
    const loop = (): void => {
      setReading(read());
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, read]);
  return reading;
}
