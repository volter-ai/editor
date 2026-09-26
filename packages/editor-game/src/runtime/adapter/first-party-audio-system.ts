/**
 * The first-party `AudioAdapter` over the game runtime's master-gain bus
 * (`setup/setup-audio.ts`'s `AudioContext.masterGain`) — the seam
 * `Game.play.pause()` calls to silence a first-party world's audio, plus the
 * graph snapshot and the native analyser taps the editor's Audio panel and
 * gameplay recorder read.
 *
 * Its NAVIGATION sibling (`createNavigationAdapter`) is the three.js twin's —
 * `@volter/threejs-runtime/adapter/first-party-navigation-system` — for the same
 * reason this one is here: each lives with the subsystem it wraps.
 *
 * Restoring after a mute puts the gain back at whatever value it held right
 * before muting (not a hardcoded `1`), which composes correctly with an
 * independent manual mute: pausing while already user-muted resumes muted,
 * exactly as a user would expect.
 */

import type {
  AudioAdapter,
  AudioGraphNode,
  AudioMeterFrame,
  AudioMeterHandle,
  AudioRecordingHandle,
} from '@volter/editor-project/adapter/system-adapter';
import type { AudioContext as GameAudio } from '@volter/game-runtime/setup/setup-audio';

/**
 * First-party `AudioAdapter` over the engine's master-gain bus
 * (`setup-audio.ts`'s `AudioContext.masterGain`) — the seam `Game.play.pause()`
 * (D10, T7.6) calls to silence a first-party world's audio. Restoring after a
 * mute puts the gain back at whatever value it held right before muting (not
 * a hardcoded `1`) — this composes correctly with an independent manual mute
 * (the editor's `MuteButton`, `PlayBar.tsx`): pausing while already
 * user-muted resumes muted, exactly as a user would expect.
 */
function audioNodeTypeName(value: object): string {
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  return name && name !== 'Object' ? name : 'AudioNode';
}

/** This world's real native context, when it has one (headless worlds do not). */
function nativeAudioContext(audio: GameAudio): (BaseAudioContext & Partial<AudioContext>) | null {
  const context = (audio.listener as { context?: BaseAudioContext } | undefined)?.context;
  return context && typeof context.state === 'string'
    ? (context as BaseAudioContext & Partial<AudioContext>)
    : null;
}

/**
 * Live meter handles per adapter, so a world teardown can release analyser
 * taps a consumer forgot to dispose.
 *
 * This registry follows `acquireMeters` out of `audio-introspection.ts`: the
 * safety net has to live wherever the taps are created, and they are created
 * here now. Keyed weakly so an adapter that is simply dropped takes its entry
 * with it.
 */
const meterHandlesByAdapter = new WeakMap<AudioAdapter, Set<AudioMeterHandle>>();

/** Release every meter tap still open on `adapter` (world stop / teardown). */
export function releaseAudioMeters(adapter: AudioAdapter): void {
  const handles = meterHandlesByAdapter.get(adapter);
  if (!handles) return;
  for (const handle of [...handles]) handle.dispose();
}

export function createAudioSystemAdapter(audio: GameAudio): AudioAdapter {
  let muted = false;
  let priorGain = audio.masterGain.gain.value;
  const liveMeterHandles = new Set<AudioMeterHandle>();
  const adapter: AudioAdapter = {
    resume: () => audio.resume(),
    setMuted(next: boolean) {
      if (next === muted) return;
      muted = next;
      if (next) {
        priorGain = audio.masterGain.gain.value;
        audio.masterGain.gain.value = 0;
      } else {
        audio.masterGain.gain.value = priorGain;
      }
    },
    isMuted: () => muted,

    /**
     * The engine's own bus hierarchy.
     *
     * This lived in `audio-introspection.ts` — the Tone-backed module — which
     * meant the editor could only ever show an audio graph for a game that had
     * loaded Tone. Nothing here needs Tone: it is the destination, the master
     * gain, the three engine buses and the THREE listener. The Tone half (nodes
     * a game routed through `connectToneBusToMasterGain`) is APPENDED by that
     * module when it attaches, which is the honest split — Tone routes are
     * Tone's to report.
     */
    graphSnapshot(): AudioGraphNode[] {
      const contextState = nativeAudioContext(audio)?.state;
      const destination: AudioGraphNode = {
        id: 'destination',
        type: 'AudioDestinationNode',
        label: 'Output',
        outputs: [],
      };
      if (contextState !== undefined) destination.state = contextState;
      const nodes: AudioGraphNode[] = [
        destination,
        {
          id: 'master',
          type: audioNodeTypeName(audio.masterGain),
          label: 'Master',
          outputs: ['destination'],
        },
        {
          id: 'bus-music',
          type: audioNodeTypeName(audio.buses.music),
          label: 'Music bus',
          outputs: ['master'],
        },
        {
          id: 'bus-sfx',
          type: audioNodeTypeName(audio.buses.sfx),
          label: 'SFX bus',
          outputs: ['master'],
        },
        {
          id: 'bus-voice',
          type: audioNodeTypeName(audio.buses.voice),
          label: 'Voice bus',
          outputs: ['master'],
        },
      ];
      if (audio.listener) {
        nodes.push({
          id: 'listener',
          type: audioNodeTypeName(audio.listener),
          label: '3D listener (THREE)',
          outputs: ['master'],
        });
      }
      return nodes;
    },

    /**
     * Per-bus linear-RMS levels, via native `AnalyserNode` taps.
     *
     * Zero Tone — analysers work identically whether or not Tone is bridged,
     * and disposal is a plain disconnect. It was in the Tone module purely by
     * where it was written, so a game that never touches Tone had no meters.
     */
    acquireMeters(): AudioMeterHandle | null {
      const meterContext = nativeAudioContext(audio);
      if (!meterContext || typeof meterContext.createAnalyser !== 'function') {
        return null; // headless world — metering is impossible, and says so
      }
      const taps = (
        [
          ['master', 'Master', audio.masterGain],
          ['bus-music', 'Music', audio.buses.music],
          ['bus-sfx', 'SFX', audio.buses.sfx],
          ['bus-voice', 'Voice', audio.buses.voice],
        ] as const
      ).map(([id, label, gain]) => {
        const analyser = meterContext.createAnalyser();
        analyser.fftSize = 1024;
        gain.connect(analyser); // a TAP (analyser is a sink), not an insert
        return { id, label, gain, analyser, buffer: new Float32Array(analyser.fftSize) };
      });
      let disposed = false;
      const handle: AudioMeterHandle = {
        read: (): AudioMeterFrame[] =>
          taps.map(({ id, label, analyser, buffer }) => {
            analyser.getFloatTimeDomainData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i++) {
              const sample = buffer[i] as number;
              sum += sample * sample;
            }
            return { id, label, level: Math.sqrt(sum / buffer.length) };
          }),
        dispose: (): void => {
          if (disposed) return;
          disposed = true;
          for (const tap of taps) {
            try {
              tap.gain.disconnect(tap.analyser);
            } catch {
              // already torn down with the context — nothing to release
            }
          }
          liveMeterHandles.delete(handle);
        },
      };
      liveMeterHandles.add(handle);
      return handle;
    },

    /** Native Web Audio tap used by the editor's gameplay recorder. It is a
     * sink beside the speakers, never an insert, so recording cannot change
     * what the player hears. A suspended context produces no audio frames and
     * stalls MediaRecorder muxing, so it cannot supply a recording track. */
    acquireRecordingStream(): AudioRecordingHandle | null {
      const recordingContext = nativeAudioContext(audio);
      if (
        !recordingContext ||
        recordingContext.state !== 'running' ||
        typeof recordingContext.createMediaStreamDestination !== 'function'
      ) {
        return null;
      }
      const destination = recordingContext.createMediaStreamDestination();
      audio.masterGain.connect(destination);
      let disposed = false;
      return {
        stream: destination.stream,
        dispose(): void {
          if (disposed) return;
          disposed = true;
          try {
            audio.masterGain.disconnect(destination);
          } catch {
            // The world/context may already have been torn down.
          }
          for (const track of destination.stream.getTracks()) track.stop();
        },
      };
    },
  };
  meterHandlesByAdapter.set(adapter, liveMeterHandles);
  return adapter;
}
