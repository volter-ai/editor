/**
 * The game's own SFX voice: a small Web Audio graph this project owns.
 *
 * This world is an R3F root, and its audio is the game's, built with Web Audio
 * directly: the host supplies no mixer. The editor still hears it the way it
 * hears any game's Web Audio — its observer routes the context's output through
 * an editor-owned gain — so the mute button, the Audio panel's graph and
 * silence-on-pause reach this graph with nothing here that knows the editor.
 *
 * The graph is deliberately tiny: one gain node (the game's whole "sfx bus")
 * into the destination, with each one-shot voice's envelope feeding it.
 */

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

/** What {@link createGameSfx} hands back: the voice and the teardown the
 *  mounting component owns. */
export interface GameSfx {
  readonly tone: PlayTone;
  /** Close the context. Nothing else owns it. */
  dispose(): void;
}

/** The silent stand-in for an environment with no Web Audio (jsdom, a headless
 *  bot run): nothing to play, nothing to close. */
const SILENT: GameSfx = {
  tone: () => {},
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
// AudioContexts, and an Edit→Play remount reuses the same graph.

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
