/**
 * The game's own SFX voice: a small Web Audio graph this project owns, and the
 * `SystemAdapters.audio` registration that lets the host silence it.
 *
 * ## Why the game owns the context
 *
 * This world is an R3F root. An R3F root renders through react-three-fiber
 * against the HOST's renderer, and the host supplies no mixer of its own —
 * audio is the game's, built with Web Audio directly inside the tree. That is
 * the seam doctrine working as designed: an absent capability is absent, not
 * faked by the host.
 *
 * ## Why it is still mutable from the editor
 *
 * A game-owned context is only orphaned if nothing can see it. `SystemAdapters`
 * is the seam for exactly this: the game DECLARES what it implements through
 * its entry's `systems` export (`export const systems = { audio:
 * sfxAudioSystem() }` in `src/systems.ts`), and from the moment the host
 * installs it the editor's mute button, the Audio debugger tab and
 * `Game.play.pause()`'s silence-on-pause all reach this graph — without the
 * host fabricating a mixer it does not have, and without a component calling
 * a host registration.
 *
 * The graph is deliberately tiny: one gain node (the game's whole "sfx bus")
 * into the destination. Mute rides that node, so muting composes with the
 * per-voice envelopes below instead of fighting them.
 */

import type { AudioAdapter, AudioGraphNode } from '@volter/editor-project/adapter';

/** A one-shot blip: a falling/rising saw with an exponential decay. Frequencies
 *  in Hz, `duration` in seconds, `volume` linear (0–1), `end` the frequency to
 *  glide to (defaults to a steady tone). A no-op when this environment has no
 *  Web Audio at all — headless CI, an SSR pass — which is why callers never
 *  guard. */
export type PlayTone = (frequency: number, duration: number, volume: number, end?: number) => void;

export interface GainDuckOptions {
  /** Gain while ducked, in linear amplitude. */
  duckGain?: number;
  /** Seconds to reach the ducked level. */
  attack?: number;
  /** Seconds to remain ducked before restoring. */
  hold?: number;
  /** Seconds to restore the resting gain. */
  release?: number;
}

/**
 * Coordinate ducking on an ordinary Web Audio gain parameter. The project
 * keeps the native AudioParam — this helper only owns the easy-to-get-wrong
 * cancel/hold/restore automation for repeated triggers.
 */
export function createGainDucker(
  context: BaseAudioContext,
  gain: AudioParam,
  options: GainDuckOptions = {},
): { trigger(): void; dispose(): void } {
  const restingGain = gain.value;
  const duckGain = Math.max(0, options.duckGain ?? 0.35);
  const attack = Math.max(0, options.attack ?? 0.02);
  const hold = Math.max(0, options.hold ?? 0.12);
  const release = Math.max(0, options.release ?? 0.25);

  return {
    trigger(): void {
      const now = context.currentTime;
      gain.cancelAndHoldAtTime(now);
      gain.linearRampToValueAtTime(duckGain, now + attack);
      gain.setValueAtTime(duckGain, now + attack + hold);
      gain.linearRampToValueAtTime(restingGain, now + attack + hold + release);
    },
    dispose(): void {
      const now = context.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(restingGain, now);
    },
  };
}

/** What {@link createGameSfx} hands back: the voice, the adapter to register,
 *  and the teardown the mounting component owns. */
export interface GameSfx {
  readonly tone: PlayTone;
  /** Expose this through the root entry's `systems.audio` so
   *  host mute/pause reach the graph. `null` when there is no real context to
   *  silence — registering a no-op adapter would tell the host this world's
   *  audio is under control when there is no audio at all. */
  readonly adapter: AudioAdapter | null;
  /** Close the context. Nothing else owns it. */
  dispose(): void;
}

/** The silent stand-in for an environment with no Web Audio (jsdom, a headless
 *  bot run). It reports no adapter, so `Game.play.pause()` says out loud that
 *  this world has no audio seam rather than pretending it silenced one. */
const SILENT: GameSfx = {
  tone: () => {},
  adapter: null,
  dispose: () => {},
};

export function createGameSfx({ maxVoices = 24 }: { maxVoices?: number } = {}): GameSfx {
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== 'undefined' ? AudioContext : undefined;
  if (!Ctor) return SILENT;

  const context = new Ctor();
  const bus = context.createGain();
  bus.gain.value = 1;
  bus.connect(context.destination);

  let muted = false;
  let priorGain = bus.gain.value;
  let voiceSequence = 0;
  const voiceLimit = Math.max(1, Math.floor(maxVoices));
  const voices: Array<{
    id: number;
    oscillator: OscillatorNode;
    gain: GainNode;
  }> = [];

  const releaseVoice = (voice: (typeof voices)[number]): void => {
    const index = voices.indexOf(voice);
    if (index >= 0) voices.splice(index, 1);
    voice.oscillator.disconnect();
    voice.gain.disconnect();
  };

  const stopVoice = (voice: (typeof voices)[number]): void => {
    voice.oscillator.onended = null;
    try {
      voice.oscillator.stop();
    } catch {
      // It ended between the pool check and the stop call.
    }
    releaseVoice(voice);
  };

  const adapter: AudioAdapter = {
    resume: () => {
      if (context.state === 'suspended') void context.resume();
    },
    setMuted(next: boolean): void {
      if (next === muted) return;
      muted = next;
      // Restore to whatever the bus held before muting, never a hardcoded 1 —
      // so a pause taken while already user-muted resumes muted.
      if (next) {
        priorGain = bus.gain.value;
        bus.gain.value = 0;
      } else {
        bus.gain.value = priorGain;
      }
    },
    isMuted: () => muted,
    graphSnapshot(): AudioGraphNode[] {
      return [
        {
          id: 'destination',
          type: 'AudioDestinationNode',
          label: 'Output',
          outputs: [],
          state: context.state,
        },
        { id: 'sfx', type: 'GainNode', label: 'Game SFX', outputs: ['destination'] },
        ...voices.map((voice) => ({
          id: `voice-${voice.id}`,
          type: 'OscillatorNode',
          label: `One-shot voice ${voice.id} (${voices.length}/${voiceLimit})`,
          outputs: ['sfx'],
          state: 'started',
        })),
      ];
    },
  };

  return {
    tone(frequency, duration, volume, end = frequency): void {
      // Autoplay policy starts every context suspended; the page has had user
      // activation long before a shot is fired, so this is the cheap unlock.
      if (context.state === 'suspended') void context.resume();
      while (voices.length >= voiceLimit) stopVoice(voices[0]!);
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const voice = { id: ++voiceSequence, oscillator, gain };
      voices.push(voice);
      oscillator.onended = () => releaseVoice(voice);
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(bus);
      oscillator.start(now);
      oscillator.stop(now + duration);
    },
    adapter,
    dispose(): void {
      for (const voice of [...voices]) stopVoice(voice);
      bus.disconnect();
      void context.close();
    },
  };
}

// --- The one voice, module-owned ---------------------------------------------
//
// Created on first use, kept for the page's lifetime: browsers cap live
// AudioContexts, an Edit→Play remount reuses the same graph, and the entry's
// `systems` export needs the adapter to exist when the host installs it —
// which is right after mount, long before the first gunshot.

let active: GameSfx | null = null;

/** The game's one voice. */
export function gameSfx(): GameSfx {
  active ??= createGameSfx();
  return active;
}

/** Play one tone through the game's voice — the call every mechanic makes. */
export const gameTone: PlayTone = (frequency, duration, volume, end) => {
  gameSfx().tone(frequency, duration, volume, end);
};

/**
 * The entry `systems` export's audio slot: a LAZY forwarding adapter over the
 * voice (constructed on first actual call, so importing the entry in Edit
 * mode builds no AudioContext), or the positive absence for an environment
 * with no Web Audio at all (jsdom, a headless bot run) — decided without
 * constructing anything, stated, never simulated.
 */
export function sfxAudioSystem(): AudioAdapter | { present: false; evidence: string } {
  if (typeof AudioContext === 'undefined') {
    return {
      present: false,
      evidence:
        'no Web Audio in this environment — `typeof AudioContext === "undefined"` ' +
        '(src/lib/audio/sfx.ts)',
    };
  }
  const live = (): AudioAdapter => {
    const adapter = gameSfx().adapter;
    if (!adapter) throw new Error('sfx: the Web Audio voice failed to construct.');
    return adapter;
  };
  return {
    resume: () => live().resume?.(),
    setMuted: (next) => live().setMuted(next),
    isMuted: () => live().isMuted(),
    graphSnapshot: () => live().graphSnapshot?.() ?? [],
  };
}
