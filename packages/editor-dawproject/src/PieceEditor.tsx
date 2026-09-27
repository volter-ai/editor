/**
 * THE PIECE DOCUMENT's surface, laid out the way Bitwig Studio lays out its Arrange view:
 *
 *   transport bar      play / stop, tempo, meter, the playhead's bar.beat
 *   arranger           track headers (name, mute, solo, volume) beside the timeline:
 *                      bar ruler, markers, one lane of clips per track; or, on the Launch tab,
 *                      the clip launcher (a column per scene, a slot per track)
 *   detail editor      the selected clip's notes on a piano roll
 *
 * Everything drawn is the LIVE piece (`live-piece.ts`): the module mounted and re-mounted on
 * every save, so the agent writing the piece is watched section by section as it lands. Every
 * gesture writes the element it touched in the piece's own source (`source-index.ts`); a note
 * whose prop is computed, or which one source element renders many times, is drawn as a ghost
 * and refuses with the reason and the line that makes it.
 */

import type { Piece } from '@volter/dawproject/piece';
import type { ToolNotice } from '@volter/editor-sdk/contributions';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Arranger, TransportBar, trackColor } from './Arranger';
import { useLivePiece } from './live-piece';
import { Devices } from './Devices';
import { Mixer } from './Mixer';
import { AudioClip } from './AudioClip';
import { Launcher, useLauncherReading } from './Launcher';
import type { Launches } from './launches';
import { PianoRoll } from './PianoRoll';
import { type EngineState, PreviewEngine, trackVoices } from './preview-engine';
import { applySource, readSource, readSourceIndex, recordStructWrite, type SourceIndex } from './source-index';
import { KEY_SEMITONES, type TakeNote, writeTake } from './recorder';
import { type AudioCapture, captureInput, takesPerPass, takeWav, writeAudioTake } from './audio-take';
import { perform } from '@volter/dawproject/perform';
import { editorHost } from '@volter/editor-sdk/host';

const small: CSSProperties = { fontSize: 11, color: themeVars.content.muted };
const button: CSSProperties = {
  background: themeVars.surface.raised,
  color: themeVars.content.primary,
  border: `1px solid ${themeVars.boundary.default}`,
  borderRadius: 3,
  padding: '2px 8px',
  fontSize: 12,
  cursor: 'pointer',
};

/**
 * What this document publishes for the agent's REPL (`volter eval` → `editor.document.run`): the
 * piece as it currently renders and the transport. Getters, so a step always reads the live value.
 */
export interface PieceDocumentContext {
  readonly file: string;
  readonly piece: Piece | null;
  readonly error: string | null;
  readonly engine: EngineState;
  readonly playhead: number | null;
  /** Where Play starts, in beats: the ruler's last click. */
  readonly start: number;
  /** The region the engine repeats, in beats, or `null` for the whole piece (Loop off). */
  readonly loop: { readonly from: number; readonly to: number } | null;
  /** Whether the engine clicks the beat while playing. */
  readonly metronome: boolean;
  /** Each strip's peak level now, left and right, dBFS, by track name: what the Mix meters show. */
  readonly levels: Readonly<Record<string, readonly [number, number]>>;
  /** The clip launcher while it is what plays: each track's launches and its timeline's beat now. */
  readonly launcher: { readonly launches: Launches; readonly beat: number } | null;
  play(fromBeat?: number): Promise<void>;
  stop(): void;
}

export function PieceEditor({
  file,
  active,
  notify,
  publishContext,
  documentId = null,
}: {
  readonly file: string;
  readonly active: boolean;
  readonly documentId?: string | null;
  readonly notify?: (notice: ToolNotice) => () => void;
  readonly publishContext?: (context: unknown) => () => void;
}) {
  const live = useLivePiece(file);
  const piece = live.piece;
  const [index, setIndex] = useState<SourceIndex>(new Map());
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  // The selected track (a header clicked, or the track of the clip clicked): what Devices shows.
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  // The track a take records into: the selected one, else the selected clip's (set each render).
  const selectedTrackRef = useRef<string | null>(null);
  // The lower pane, as Bitwig's: the selected clip's editor, its track's devices, or the mixer.
  const [lower, setLower] = useState<'clip' | 'devices' | 'mix'>('clip');
  // The upper pane: the arranger's timeline, or the clip launcher.
  const [upper, setUpper] = useState<'arrange' | 'launch'>('arrange');
  // Refusals and failed writes are events: they go to the host's notification cards, never into
  // this document's own chrome (ARCHITECTURE-CORE §Editor chrome, "Notices take VS Code's shape").
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const setMessage = useCallback((text: string | null, tone: ToolNotice['tone'] = 'warning') => {
    if (text) notifyRef.current?.({ tone, title: text });
  }, []);
  const [engineState, setEngineState] = useState<EngineState>({ kind: 'idle' });
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [pxPerBeat, setPxPerBeat] = useState(28);
  const engine = useMemo(() => new PreviewEngine(), []);
  const liveRef = useRef({ live });
  // Where Play starts (a click on the ruler sets it), as a DAW's play-start marker: view state.
  const [start, setStart] = useState(0);
  const startRef = useRef(start);
  startRef.current = start;
  // The loop region (drawn on the loop strip, whole bars) and whether Loop is on: view state the
  // engine is handed, never written into the piece.
  const [loopRegion, setLoopRegion] = useState<{ readonly from: number; readonly to: number } | null>(null);
  const [looping, setLooping] = useState(false);
  const [metronome, setMetronome] = useState(false);
  // RECORDING: the take being played in (its track, the notes finished and the ones held down),
  // and whether the transport has started playing it.
  const [recording, setRecording] = useState(false);
  const take = useRef<{ trackId: string; notes: TakeNote[]; held: Map<number, { start: number; vel: number }>; octave: number; started: boolean; lastBeat: number } | null>(null);
  // An audio take: the input being captured for a track that has no instrument.
  const audioTake = useRef<{ trackId: string; capture: Promise<AudioCapture | null>; started: boolean } | null>(null);
  useEffect(() => engine.setMetronome(metronome), [engine, metronome]);

  useEffect(() => {
    if (!publishContext) return;
    const context: PieceDocumentContext = {
      file,
      get piece() {
        return liveRef.current.live.piece;
      },
      get error() {
        return liveRef.current.live.error;
      },
      get engine() {
        return engine.current;
      },
      get playhead() {
        return engine.playhead();
      },
      get start() {
        return startRef.current;
      },
      get loop() {
        return engine.loop;
      },
      get metronome() {
        return engine.metronome;
      },
      get launcher() {
        return engine.launcher;
      },
      get levels() {
        const names = new Map(liveRef.current.live.piece?.tracks.map((track) => [track.id, track.name]) ?? []);
        return Object.fromEntries([...engine.levels()].map(([id, level]) => [names.get(id) ?? id, level]));
      },
      play: (fromBeat = startRef.current) => engine.play(fromBeat),
      stop: () => engine.stop(),
    };
    return publishContext(context);
  }, [publishContext, engine, file]);

  liveRef.current = { live };
  useEffect(() => engine.subscribe(setEngineState), [engine]);
  useEffect(() => () => engine.dispose(), [engine]);
  useEffect(() => {
    if (piece) engine.update(piece);
  }, [engine, piece]);
  useEffect(() => {
    if (!active) engine.stop();
  }, [active, engine]);

  const loopRange = loopRegion ?? (piece ? { from: 0, to: 4 * piece.transport.beatsPerBar } : null);
  useEffect(() => {
    engine.setLoop(looping ? loopRange : null);
  }, [engine, looping, loopRange?.from, loopRange?.to]);

  // The source index follows the piece: every re-mount is a source change it must reflect.
  useEffect(() => {
    let cancelled = false;
    readSourceIndex().then(
      (next) => !cancelled && setIndex(next),
      (error: unknown) => !cancelled && setMessage(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      cancelled = true;
    };
  }, [live.revision]);

  useEffect(() => {
    if (engineState.kind !== 'playing') {
      setPlayhead(null);
      return;
    }
    let frame = 0;
    const loop = (): void => {
      setPlayhead(engine.playhead());
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine, engineState.kind]);

  const readLauncher = useCallback(() => engine.launcher, [engine]);
  const readLevels = useCallback(() => engine.levels(), [engine]);
  const launcher = useLauncherReading(readLauncher, engineState.kind === 'playing');
  // While the launcher plays, its timeline is not the arrangement's: the arranger shows no playhead.
  const arrangePlayhead = launcher ? null : playhead;

  // A note played in: sounded at once on the take's track, and kept against the playhead.
  const noteIn = useCallback(
    (pitch: number, velocity: number) => {
      const current = take.current;
      if (!current) return;
      engine.monitor(current.trackId, pitch, velocity);
      const beat = engine.playhead();
      if (beat === null) return;
      current.lastBeat = beat;
      if (velocity > 0) current.held.set(pitch, { start: beat, vel: velocity });
      else {
        const held = current.held.get(pitch);
        current.held.delete(pitch);
        if (held) current.notes.push({ pitch, vel: held.vel, start: held.start, end: beat > held.start ? beat : held.start + 0.25 });
      }
    },
    [engine],
  );

  const finishTake = useCallback(() => {
    const current = take.current;
    take.current = null;
    setRecording(false);
    if (!current) return;
    for (const [pitch, held] of current.held) {
      engine.monitor(current.trackId, pitch, 0);
      current.notes.push({ pitch, vel: held.vel, start: held.start, end: Math.max(current.lastBeat, held.start + 0.25) });
    }
    const latest = liveRef.current.live.piece;
    const track = latest?.tracks.find((candidate) => candidate.id === current.trackId);
    if (!latest || !track) return;
    if (current.notes.length === 0) {
      setMessage('Nothing was played, so nothing was recorded.', 'info');
      return;
    }
    const notes = current.notes;
    void (async () => {
      const prevSource = await readSource(file);
      const newSource = writeTake(prevSource, file, latest, track, index, notes);
      if (!(await applySource(file, newSource, prevSource))) throw new Error(`${file} changed while the take was written; play it again.`);
      recordStructWrite('Record Take', { file, prevSource, newSource }, { index, pieceFile: file, documentId }, setMessage);
    })().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [engine, file, index, documentId, setMessage]);

  const finishAudioTake = useCallback(() => {
    const current = audioTake.current;
    audioTake.current = null;
    setRecording(false);
    if (!current) return;
    void (async () => {
      const heard = (await current.capture)?.stop() ?? null;
      const latest = liveRef.current.live.piece;
      const track = latest?.tracks.find((candidate) => candidate.id === current.trackId);
      if (!latest || !track) return;
      if (!heard) {
        setMessage('No audio came in from the input, so nothing was recorded.', 'info');
        return;
      }
      // Placed where it began: from the bar line before it, the file padded back to that line; a
      // take over several passes of the loop is one take per pass, in a clip over the loop's bars.
      const beatsPerBar = latest.transport.beatsPerBar;
      const performance = perform(latest);
      const played = engine.playedAt(heard.startTime);
      const passes = played ? takesPerPass(heard, played.elapsed, played.region) : null;
      const startBeat = passes && played ? performance.beatAt(played.region.start) : (engine.beatAtTime(heard.startTime) ?? 0);
      const firstBar = Math.floor(startBeat / beatsPerBar + 1e-9);
      const endBeat = passes && played ? performance.beatAt(played.region.end) : performance.beatAt(performance.secondsAt(startBeat) + heard.left.length / heard.sampleRate);
      const bars = Math.max(1, Math.ceil(endBeat / beatsPerBar - 1e-9) - firstBar);
      const barPad = performance.secondsAt(startBeat) - performance.secondsAt(firstBar * beatsPerBar);
      const recordings = passes ?? [{ ...heard, pad: 0 }];
      const files = editorHost().files;
      const paths: string[] = [];
      let number = 1;
      for (const recording of recordings) {
        while (await files.exists(`audio/take-${number}.wav`)) number++;
        const path = `audio/take-${number}.wav`;
        await files.write(path, takeWav(recording, barPad + recording.pad));
        paths.push(path);
      }
      const prevSource = await readSource(file);
      const newSource = writeAudioTake(prevSource, file, latest, track, index, paths, firstBar, bars);
      if (!(await applySource(file, newSource, prevSource))) throw new Error(`${file} changed while the take was written; ${paths.join(', ')} hold the recording.`);
      recordStructWrite('Record Audio Take', { file, prevSource, newSource }, { index, pieceFile: file, documentId }, setMessage);
    })().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [engine, file, index, documentId, setMessage]);

  // A take starts with the transport and ends when it stops, however it is stopped.
  useEffect(() => {
    const current = take.current ?? audioTake.current;
    if (!current) return;
    if (engineState.kind === 'playing') current.started = true;
    else if (current.started || engineState.kind === 'error') {
      if (take.current) finishTake();
      else finishAudioTake();
    }
  }, [engineState.kind, finishTake, finishAudioTake]);

  // Keep the last beat the playhead reached, where held notes end if the transport stops first.
  useEffect(() => {
    if (take.current && playhead !== null) take.current.lastBeat = playhead;
  }, [playhead]);

  const toggleRecord = useCallback(() => {
    if (take.current || audioTake.current) {
      engine.stop();
      return;
    }
    const current = liveRef.current.live.piece;
    const trackId = selectedTrackRef.current;
    const track = current?.tracks.find((candidate) => candidate.id === trackId);
    if (!current || !track || (track.channel?.role ?? 'regular') !== 'regular') {
      setMessage('Select a track (a clip on it, or its header) to record into: an instrument track records notes, one without an instrument records audio.');
      return;
    }
    if (!trackVoices(current).get(track.id)) {
      // No instrument: the track records the audio input.
      setRecording(true);
      const capture = engine.play(startRef.current).then(async () => {
        const context = engine.audioContext;
        if (!context || engine.current.kind !== 'playing') return null;
        return captureInput(context);
      });
      audioTake.current = { trackId: track.id, capture, started: false };
      capture.catch((error: unknown) => {
        setMessage(`The audio input could not be opened: ${error instanceof Error ? error.message : String(error)}`);
        engine.stop();
      });
      return;
    }
    take.current = { trackId: track.id, notes: [], held: new Map(), octave: 0, started: false, lastBeat: startRef.current };
    setRecording(true);
    void engine.play(startRef.current);
  }, [engine, setMessage]);

  // What is played in while recording: the computer keyboard (while this document is active) and
  // every MIDI input the browser offers.
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (!active || event.metaKey || event.ctrlKey || event.altKey || (target && (target.tagName === 'INPUT' || target.isContentEditable))) return;
      const current = take.current;
      if (!current) return;
      if (event.code === 'KeyZ' || event.code === 'KeyX') {
        if (event.type === 'keydown') current.octave = Math.max(-4, Math.min(4, current.octave + (event.code === 'KeyX' ? 1 : -1)));
      } else {
        const semitone = KEY_SEMITONES[event.code];
        if (semitone === undefined) return;
        if (!event.repeat) noteIn(60 + current.octave * 12 + semitone, event.type === 'keydown' ? 0.8 : 0);
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    let inputs: MIDIInput[] = [];
    const onMidi = (event: MIDIMessageEvent): void => {
      const [status = 0, pitch = 0, velocity = 0] = event.data ?? [];
      const kind = status & 0xf0;
      if (kind === 0x90 && velocity > 0) noteIn(pitch, velocity / 127);
      else if (kind === 0x80 || kind === 0x90) noteIn(pitch, 0);
    };
    let cancelled = false;
    navigator.requestMIDIAccess?.().then(
      (access) => {
        if (cancelled) return;
        inputs = [...access.inputs.values()];
        for (const input of inputs) input.addEventListener('midimessage', onMidi);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      for (const input of inputs) input.removeEventListener('midimessage', onMidi);
    };
  }, [recording, active, noteIn]);

  const togglePlay = useCallback(() => {
    if (engineState.kind === 'playing') engine.stop();
    else void engine.play(start);
  }, [engine, engineState.kind, start]);

  // A click on the ruler: Play starts there from now on, and a playing piece jumps there.
  const seek = useCallback(
    (beat: number) => {
      setStart(beat);
      if (engine.current.kind === 'playing') void engine.play(beat);
    },
    [engine],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, togglePlay]);

  const clip = useMemo(() => {
    if (!piece) return null;
    for (const [trackIndex, track] of piece.tracks.entries()) {
      for (const candidate of track.clips) {
        if (candidate.id === selectedClip) return { clip: candidate, track, trackIndex, scene: null };
      }
    }
    for (const scene of piece.scenes) {
      for (const slot of scene.slots) {
        if (slot.clip?.id !== selectedClip) continue;
        const trackIndex = piece.tracks.findIndex((track) => track.name === slot.track);
        const track = piece.tracks[trackIndex];
        if (track) return { clip: slot.clip, track, trackIndex, scene: scene.name };
      }
    }
    const firstTrack = piece.tracks.findIndex((track) => track.clips.length > 0);
    const track = piece.tracks[firstTrack];
    const first = track?.clips[0];
    return track && first ? { clip: first, track, trackIndex: firstTrack, scene: null } : null;
  }, [piece, selectedClip]);

  selectedTrackRef.current = selectedTrack ?? clip?.track.id ?? null;

  if (!piece) {
    return (
      <div style={{ padding: 16, ...small }}>
        {live.error ? <span style={{ color: themeVars.semantic.danger }}>{live.error}</span> : `Mounting ${file}…`}
      </div>
    );
  }

  const beatsPerBar = piece.transport.beatsPerBar;
  const totalBeats = Math.max(piece.length, beatsPerBar * 8) + beatsPerBar * 2;
  const voices = trackVoices(piece);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: themeVars.surface.panel, color: themeVars.content.primary, fontSize: 12 }}>
      <TransportBar
        piece={piece}
        playing={engineState.kind === 'playing'}
        engineState={engineState}
        playhead={arrangePlayhead}
        start={start}
        onToggle={togglePlay}
        pxPerBeat={pxPerBeat}
        onZoom={setPxPerBeat}
        looping={looping}
        onLoop={() => setLooping((on) => !on)}
        metronome={metronome}
        onMetronome={() => setMetronome((on) => !on)}
        recording={recording}
        onRecord={toggleRecord}
        writes={{ index, file, documentId, onMessage: setMessage }}
      />
      {live.error ? (
        <div style={{ padding: '4px 10px', color: themeVars.semantic.danger, borderBottom: `1px solid ${themeVars.boundary.default}` }}>
          {live.error} — showing the last piece that rendered.
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 2, padding: '2px 6px', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        {(['arrange', 'launch'] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            data-pane={pane}
            onClick={() => setUpper(pane)}
            style={{ ...button, padding: '0 10px', fontSize: 11, background: upper === pane ? themeVars.surface.inset : themeVars.surface.raised }}
          >
            {pane === 'arrange' ? 'Arrange' : `Launch${piece.scenes.length ? ` (${piece.scenes.length})` : ''}`}
          </button>
        ))}
      </div>
      <div style={{ flex: '1 1 50%', minHeight: 120, overflow: 'auto', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        {upper === 'launch' ? (
          <Launcher
            piece={piece}
            launcher={launcher}
            selectedClip={clip?.clip.id ?? null}
            onSelectClip={(id, trackId) => {
              setSelectedClip(id);
              setSelectedTrack(trackId);
            }}
            onLaunchScene={(sceneId) => void engine.launchScene(sceneId)}
            onLaunchSlot={(trackId, sceneId) => void engine.launchSlot(trackId, sceneId)}
            active={active}
            writes={{ index, file, documentId, onMessage: setMessage }}
          />
        ) : (
        <Arranger
          piece={piece}
          totalBeats={totalBeats}
          pxPerBeat={pxPerBeat}
          playhead={arrangePlayhead}
          start={start}
          onSeek={seek}
          loop={loopRange ?? { from: 0, to: 4 * beatsPerBar }}
          looping={looping}
          onLoopRegion={setLoopRegion}
          selectedClip={clip?.clip.id ?? null}
          onSelectClip={(id) => {
            setSelectedClip(id);
            setSelectedTrack(piece.tracks.find((track) => track.clips.some((candidate) => candidate.id === id))?.id ?? null);
          }}
          selectedTrack={selectedTrack ?? clip?.track.id ?? null}
          onSelectTrack={setSelectedTrack}
          voiceless={new Set([...voices].filter(([, voice]) => voice === null).map(([id]) => id))}
          active={active}
          writes={{ index, file, documentId, onMessage: setMessage }}
        />
        )}
      </div>
      <div style={{ display: 'flex', gap: 2, padding: '2px 6px', borderBottom: `1px solid ${themeVars.boundary.default}` }}>
        {(['clip', 'devices', 'mix'] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            data-pane={pane}
            onClick={() => setLower(pane)}
            style={{ ...button, padding: '0 10px', fontSize: 11, background: lower === pane ? themeVars.surface.inset : themeVars.surface.raised }}
          >
            {pane === 'clip' ? 'Clip' : pane === 'devices' ? 'Devices' : 'Mix'}
          </button>
        ))}
      </div>
      <div style={{ flex: '1 1 50%', minHeight: 160, overflow: 'auto' }}>
        {lower === 'devices' ? (
          <Devices
            piece={piece}
            index={index}
            track={piece.tracks.find((track) => track.id === selectedTrack) ?? clip?.track ?? null}
            resource={{ file, documentId }}
            onMessage={setMessage}
          />
        ) : lower === 'mix' ? (
          <Mixer
            piece={piece}
            index={index}
            colorOf={(track) => trackColor(track, piece.tracks.indexOf(track))}
            resource={{ file, documentId }}
            onMessage={setMessage}
            levels={readLevels}
            playing={engineState.kind === 'playing'}
          />
        ) : clip?.clip.audio ? (
          <AudioClip key={clip.clip.id} clip={clip.clip} piece={piece} index={index} file={file} documentId={documentId} onMessage={setMessage} />
        ) : clip ? (
          <PianoRoll
            key={clip.clip.id}
            clip={clip.clip}
            color={trackColor(clip.track, clip.trackIndex)}
            trackName={clip.track.name}
            freezeTarget={clip.scene === null ? { track: clip.track.name, clip: clip.track.clips.indexOf(clip.clip) + 1 } : { track: clip.track.name, scene: clip.scene }}
            graph={live.graph}
            piece={piece}
            index={index}
            pxPerBeat={pxPerBeat * 2}
            playhead={clip.scene === null ? arrangePlayhead : null}
            onMessage={setMessage}
            file={file}
            documentId={documentId}
            active={active}
          />
        ) : (
          <div style={{ padding: 16, ...small }}>No clips yet. Clips appear here as the piece gains them.</div>
        )}
      </div>
      <div style={{ padding: '3px 10px', borderTop: `1px solid ${themeVars.boundary.default}`, ...small, minHeight: 18 }}>
        {`${file} — ${piece.tracks.length} tracks, ${piece.tracks.reduce((n, t) => n + t.clips.reduce((m, c) => m + c.notes.length, 0), 0)} notes`}
      </div>
    </div>
  );
}
