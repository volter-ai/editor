/** Shared Godot 4 AudioStreamPlayerInternal voice ownership. */

import type { AudioStreamPlayback } from './audio';
import { createSignal, type GodotConnection, type GodotSignal } from './signal';

export interface GodotManagedAudioVoice extends AudioStreamPlayback {
  readonly finished: GodotSignal<[]>;
  streamPaused: boolean;
  seek(position: number): void;
  getPlaybackPosition(): number;
  hasStreamPlayback(): boolean;
  getStreamPlayback(): unknown;
}

interface VoiceEntry<V extends GodotManagedAudioVoice> {
  readonly voice: V;
  connection: GodotConnection;
}

export interface GodotAudioVoicePool<V extends GodotManagedAudioVoice> {
  readonly finished: GodotSignal<[]>;
  readonly playing: boolean;
  readonly streamPaused: boolean;
  readonly hasVoices: boolean;
  readonly latest: V | undefined;
  play(fromPosition?: number, monophonic?: boolean): void;
  stop(): void;
  seek(position: number): void;
  setStreamPaused(paused: boolean): void;
  setMaxPolyphony(maxPolyphony: number): void;
  forEach(callback: (voice: V) => void): void;
  tickSim(dt: number): void;
}

/**
 * Godot's `AudioStreamPlayerInternal::play_basic` appends one playback and
 * `ensure_playback_limit` removes index zero until the limit is met. This pool owns that exact
 * ordered list while each surface-specific voice keeps its existing native graph and sim clock.
 */
export function createGodotAudioVoicePool<V extends GodotManagedAudioVoice>(
  createVoice: () => V,
  initialMaxPolyphony: number,
): GodotAudioVoicePool<V> {
  let maxPolyphony = initialMaxPolyphony;
  let entries: VoiceEntry<V>[] = [];
  let ticking = false;
  let finishedDuringTick = false;
  const finished = createSignal<[]>();

  const retire = (voice: V): void => {
    if (voice.disposeVoice !== undefined) voice.disposeVoice();
    else voice.stop();
  };

  const remove = (entry: VoiceEntry<V>, natural: boolean): void => {
    const index = entries.indexOf(entry);
    if (index < 0) return;
    entries.splice(index, 1);
    entry.connection.disconnect();
    if (!natural) return;
    // A surface voice may have retained generator/music routing after its transport naturally
    // completes. The internal playback list owns that voice, so removal also owns its complete
    // graph teardown.
    retire(entry.voice);
    if (ticking) finishedDuringTick = true;
    else finished.emit();
  };

  const stopOldest = (): void => {
    const oldest = entries[0];
    if (oldest === undefined) return;
    entries.shift();
    oldest.connection.disconnect();
    retire(oldest.voice);
  };

  const enforceLimit = (): void => {
    while (entries.length > maxPolyphony) stopOldest();
  };

  const stopAll = (): void => {
    const current = entries;
    entries = [];
    for (const entry of current) {
      entry.connection.disconnect();
      retire(entry.voice);
    }
  };

  return {
    finished: finished.signal,
    get playing(): boolean {
      return entries.some(({ voice }) => voice.playing);
    },
    get streamPaused(): boolean {
      return entries[0]?.voice.streamPaused ?? false;
    },
    get hasVoices(): boolean {
      return entries.length > 0;
    },
    get latest(): V | undefined {
      return entries.at(-1)?.voice;
    },
    play(fromPosition = 0, monophonic = false): void {
      if (monophonic) stopAll();
      const voice = createVoice();
      let entry!: VoiceEntry<V>;
      const connection = voice.finished.connect(() => remove(entry, true));
      entry = { voice, connection };
      voice.play(fromPosition);
      if (!voice.playing) {
        entry.connection.disconnect();
        retire(voice);
        return;
      }
      entries.push(entry);
      enforceLimit();
    },
    stop(): void {
      stopAll();
    },
    seek(position: number): void {
      if (!this.playing) return;
      this.stop();
      this.play(position);
    },
    setStreamPaused(paused: boolean): void {
      for (const { voice } of [...entries]) voice.streamPaused = paused;
    },
    setMaxPolyphony(value: number): void {
      maxPolyphony = value;
      // Godot's setter only records the new limit. `ensure_playback_limit()` runs after the next
      // `play()`, so lowering this property does not retroactively stop an already-playing voice.
    },
    forEach(callback: (voice: V) => void): void {
      for (const { voice } of [...entries]) callback(voice);
    },
    tickSim(dt: number): void {
      ticking = true;
      finishedDuringTick = false;
      for (const { voice } of [...entries]) voice.tickSim?.(dt);
      ticking = false;
      if (finishedDuringTick) finished.emit();
    },
  };
}
