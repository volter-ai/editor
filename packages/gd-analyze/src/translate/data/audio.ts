/**
 * translate/data/audio.ts — an `AudioStreamPlayer` / `AudioStreamPlayer3D` / Area reverb send as a
 * spec. `emit/` prints the spec; the runtime's `AudioStreamPlayer` modules play it.
 *
 * Known-keys for the two player classes live here so the node-class table and `emitAudio`'s closed
 * classifier share one set. {@link AUDIO_DEVIATION_MECHANISMS} is the rest of that closed surface.
 */
import { asNumber, asString, type GodotValue } from '../../read/godot-value';
import type { GodotProject } from '../../read/godot-types';
import { TranslateError } from './model';

function asBool(value: GodotValue | undefined): boolean | undefined {
  return value?.kind === 'bool' ? value.value : undefined;
}

export interface ImportedAudioStreamSpec {
  readonly format: 'ogg-vorbis' | 'wav' | 'mp3';
  readonly loop: boolean;
  readonly loopOffset: number;
}

/** Resolve one statically loaded audio file to the Resource identity its Godot importer creates. */
export function importedAudioStreamSpec(
  project: GodotProject,
  resPath: string,
  at: string,
): ImportedAudioStreamSpec {
  const extension = resPath.slice(resPath.lastIndexOf('.') + 1).toLowerCase();
  const format = extension === 'ogg' ? 'ogg-vorbis' : extension === 'wav' ? 'wav' : extension === 'mp3' ? 'mp3' : undefined;
  if (format === undefined) throw new TranslateError(at, `${resPath} is not an imported AudioStream source.`);
  const sidecar = project.imports.find((entry) => entry.sourceFile === resPath);
  const expectedImporter = extension === 'ogg' ? 'ogg_vorbis' : extension;
  if (sidecar === undefined || sidecar.importer !== expectedImporter) {
    throw new TranslateError(
      at,
      `preloaded AudioStream ${resPath} requires its ${resPath}.import sidecar with importer=${expectedImporter}.`,
    );
  }
  const loop = format === 'wav' ? false : sidecar.audioLoop;
  const loopOffset = format === 'wav' ? 0 : sidecar.audioLoopOffset;
  if (loop === undefined || loopOffset === undefined || !Number.isFinite(loopOffset)) {
    throw new TranslateError(at, `${sidecar.resPath} must retain finite AudioStream loop and loop_offset import settings.`);
  }
  return { format, loop, loopOffset };
}

/**
 * The `AudioStreamPlayer` / `AudioStreamPlayer3D` properties `emitAudio` READS.
 *
 * Together with {@link AUDIO_DEVIATION_MECHANISMS} this is a CLOSED classification of the two
 * classes' whole authored surface. `autoplay` is the one entry that ALSO lives in the global
 * carried set, because `AnimationPlayer.autoplay` is a different property of the same spelling.
 */
export const AUDIO_CARRIED_PROPERTIES: ReadonlySet<string> = new Set([
  'stream',
  'autoplay',
  'max_polyphony',
  // AudioStreamPlayer3D only — read into `createAudioStreamPlayer3D`'s options.
  'attenuation_model',
  'unit_db',
  'unit_size',
  'max_db',
  'max_distance',
  'panning_strength',
  'area_mask',
  'attenuation_filter_cutoff_hz',
  'attenuation_filter_db',
  // AudioStreamPlayer2D only.
  'max_distance',
  'attenuation',
]);

/** Godot 3.6 `AudioStreamPlayer3D.attenuation_model` → the name `createAudioStreamPlayer3D` takes. */
export const AUDIO_ATTENUATION = ['inverse', 'inverse-square', 'logarithmic', 'disabled'] as const;
export type AudioAttenuation = (typeof AUDIO_ATTENUATION)[number];

/** Positional player parameters, Godot 3.6 defaults when a property is omitted. */
export interface AudioStreamPlayer3DSpec {
  readonly attenuation: AudioAttenuation;
  readonly unitDb: number;
  readonly unitSize: number;
  readonly maxDb: number;
  readonly maxDistance: number;
  readonly panningStrength: number;
  readonly areaMask: number;
  readonly attenuationFilterCutoffHz: number;
  readonly attenuationFilterDb: number;
  readonly maxPolyphony: number;
}

/** Authored 2D distance/panning values carried unchanged into the retained Web Audio player. */
export interface AudioStreamPlayer2DSpec {
  readonly maxDistance: number;
  readonly attenuation: number;
  readonly panningStrength: number;
  readonly areaMask: number;
  readonly maxPolyphony: number;
}

/** Godot 4's shared AudioStreamPlayer maximum-polyphony property. */
export function readAudioMaxPolyphony(
  props: Readonly<Record<string, GodotValue>>,
  at: string,
): number {
  const value = asNumber(props['max_polyphony']) ?? 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > 128) {
    throw new TranslateError(at, 'AudioStreamPlayer.max_polyphony must be an integer in [1, 128].');
  }
  return value;
}

export function readAudioStreamPlayer2DSpec(
  props: Readonly<Record<string, GodotValue>>,
  at = 'AudioStreamPlayer2D',
): AudioStreamPlayer2DSpec {
  return {
    maxDistance: asNumber(props['max_distance']) ?? 2_000,
    attenuation: asNumber(props['attenuation']) ?? 1,
    panningStrength: asNumber(props['panning_strength']) ?? 1,
    areaMask: asNumber(props['area_mask']) ?? 1,
    maxPolyphony: readAudioMaxPolyphony(props, at),
  };
}

export function readAudioAutoplay(
  props: Readonly<Record<string, GodotValue>>,
  at: string,
): boolean {
  const authored = props['autoplay'];
  if (authored === undefined) return false;
  const value = asBool(authored);
  if (value === undefined) throw new TranslateError(at, 'AudioStreamPlayer autoplay must be bool.');
  return value;
}

/**
 * `AudioStreamPlayer3D` distance / panning fields. Refuses an `attenuation_model` that is not one
 * of Godot 3.6's four values — the same sentence emit used to throw inline.
 */
export function readAudioStreamPlayer3DSpec(
  props: Readonly<Record<string, GodotValue>>,
  at: string,
): AudioStreamPlayer3DSpec {
  const attenuationIndex = asNumber(props['attenuation_model']) ?? 0;
  const attenuation = AUDIO_ATTENUATION[attenuationIndex];
  if (attenuation === undefined) {
    throw new TranslateError(
      at,
      `AudioStreamPlayer3D attenuation_model ${attenuationIndex} is not a Godot 3.6 value.`,
    );
  }
  return {
    attenuation,
    unitDb: asNumber(props['unit_db']) ?? 0,
    unitSize: asNumber(props['unit_size']) ?? 1,
    maxDb: asNumber(props['max_db']) ?? 3,
    maxDistance: asNumber(props['max_distance']) ?? 0,
    panningStrength: asNumber(props['panning_strength']) ?? 1,
    areaMask: asNumber(props['area_mask']) ?? 1,
    attenuationFilterCutoffHz: asNumber(props['attenuation_filter_cutoff_hz']) ?? 5_000,
    attenuationFilterDb: asNumber(props['attenuation_filter_db']) ?? -24,
    maxPolyphony: readAudioMaxPolyphony(props, at),
  };
}

/** Godot's default when an `AudioStreamRandomPitch` omits `random_pitch`. */
export const DEFAULT_AUDIO_STREAM_RANDOM_PITCH = 1.1;

export function audioStreamRandomPitch(props: Readonly<Record<string, GodotValue>>): number {
  return asNumber(props['random_pitch']) ?? DEFAULT_AUDIO_STREAM_RANDOM_PITCH;
}

/** An `Area` whose `reverb_bus_enable` is on, as the send `godot-compat` registers. */
export interface AreaReverbSpec {
  readonly busName: string;
  readonly amount: number;
  readonly uniformity: number;
  readonly priority: number;
}

export function readAreaReverbSpec(props: Readonly<Record<string, GodotValue>>): AreaReverbSpec {
  return {
    busName: asString(props['reverb_bus_name']) ?? 'Master',
    amount: asNumber(props['reverb_bus_amount']) ?? 0,
    uniformity: asNumber(props['reverb_bus_uniformity']) ?? 0,
    priority: asNumber(props['priority']) ?? 0,
  };
}

/**
 * An `AudioStreamPlayer.stream` as a decoded ext-resource, legacy random-pitch wrapper, or the
 * complete Godot 4 weighted AudioStreamRandomizer pool.
 */
export function unwrapAudioStream(
  at: string,
  absent: boolean,
  extPath: string | undefined,
  sub: { readonly type: string; readonly properties: Readonly<Record<string, GodotValue>> } | undefined,
  innerExtPath: string | undefined,
  randomizerExtPath?: string,
  randomizerExtPaths?: readonly (string | undefined)[],
): AudioStreamResolve {
  if (extPath !== undefined) return { stream: extPath, randomPitch: undefined };
  if (sub !== undefined) {
    if (sub.type === 'AudioStreamGenerator') {
      return {
        generator: {
          mixRateMode: asNumber(sub.properties['mix_rate_mode']) ?? 2,
          mixRate: asNumber(sub.properties['mix_rate']) ?? 44_100,
          bufferLength: asNumber(sub.properties['buffer_length']) ?? 0.5,
        },
      };
    }
    if (sub.type === 'AudioStreamPolyphonic') {
      const polyphony = asNumber(sub.properties['polyphony']) ?? 32;
      if (!Number.isSafeInteger(polyphony) || polyphony < 1 || polyphony > 128) {
        throw new TranslateError(
          at,
          'AudioStreamPolyphonic.polyphony must be an integer in [1, 128].',
        );
      }
      return { polyphonic: { polyphony } };
    }
    if (sub.type === 'AudioStreamRandomizer') {
      const count = asNumber(sub.properties['streams_count']) ?? 0;
      const paths = randomizerExtPaths ?? (randomizerExtPath === undefined ? [] : [randomizerExtPath]);
      if (!Number.isSafeInteger(count) || count < 0) throw new TranslateError(at, 'AudioStreamRandomizer.streams_count must be a nonnegative integer.');
      const streams: AudioStreamRandomizerEntry[] = [];
      for (let index = 0; index < count; index += 1) {
        const stream = paths[index];
        if (stream === undefined) continue;
        streams.push({ stream, weight: asNumber(sub.properties[`stream_${index}/weight`]) ?? 1 });
      }
      return {
        randomizer: {
          streams,
          playbackMode: asNumber(sub.properties['playback_mode']) ?? 0,
          randomPitch: asNumber(sub.properties['random_pitch']) ?? 2 ** ((asNumber(sub.properties['random_pitch_semitones']) ?? 0) / 12),
          randomVolumeOffsetDb: asNumber(sub.properties['random_volume_offset_db']) ?? 0,
        },
      };
    }
    if (sub.type === 'AudioStreamPlaylist') {
      const count = asNumber(sub.properties['stream_count']) ?? 0;
      const paths = randomizerExtPaths ?? [];
      return { playlist: {
        streams: Array.from({ length: Math.max(0, count) }, (_, index) => paths[index] ?? null),
        shuffle: asBool(sub.properties['shuffle']) ?? false,
        loop: asBool(sub.properties['loop']) ?? true,
        fadeTime: asNumber(sub.properties['fade_time']) ?? 0.3,
      } };
    }
    if (sub.type === 'AudioStreamSynchronized') {
      const count = asNumber(sub.properties['stream_count']) ?? 0;
      const paths = randomizerExtPaths ?? [];
      return { synchronized: { streams: Array.from({ length: Math.max(0, count) }, (_, index) => ({ stream: paths[index] ?? null, volumeDb: asNumber(sub.properties[`stream_${index}/volume`]) ?? 0 })) } };
    }
    if (sub.type === 'AudioStreamInteractive') {
      const count = asNumber(sub.properties['clip_count']) ?? 0;
      const paths = randomizerExtPaths ?? [];
      const transitions: AudioStreamInteractiveTransitionSpec[] = [];
      const authoredTransitions = sub.properties['_transitions'];
      if (authoredTransitions?.kind === 'dict') {
        for (const entry of authoredTransitions.entries) {
          const pair = [...entry.key.matchAll(/-?\d+/g)].map((match) => Number(match[0]));
          if (pair.length < 2 || entry.value.kind !== 'dict') continue;
          const field = (name: string): GodotValue | undefined => entry.value.entries.find((item) => item.key === name)?.value;
          transitions.push({ from: pair[0]!, to: pair[1]!, fromTime: asNumber(field('from_time')) ?? 1, toTime: asNumber(field('to_time')) ?? 1, fadeMode: asNumber(field('fade_mode')) ?? 4, fadeBeats: asNumber(field('fade_beats')) ?? 1, useFillerClip: asBool(field('use_filler_clip')) ?? false, fillerClip: asNumber(field('filler_clip')) ?? -1, holdPrevious: asBool(field('hold_previous')) ?? false });
        }
      }
      return { interactive: {
        initialClip: asNumber(sub.properties['initial_clip']) ?? 0,
        clips: Array.from({ length: Math.max(0, count) }, (_, index) => ({ stream: paths[index] ?? null, name: asString(sub.properties[`clip_${index}/name`]) ?? '', autoAdvance: asNumber(sub.properties[`clip_${index}/auto_advance`]) ?? 0, nextClip: asNumber(sub.properties[`clip_${index}/next_clip`]) ?? 0 })),
        transitions,
      } };
    }
    if (sub.type !== 'AudioStreamRandomPitch') {
      if (sub.type === 'AudioStreamMicrophone') {
        if (Object.keys(sub.properties).some((key) => !key.startsWith('resource_'))) {
          throw new TranslateError(at, 'AudioStreamMicrophone has authored properties outside Resource metadata.');
        }
        return { microphone: true };
      }
      throw new TranslateError(
        at,
        `an AudioStreamPlayer whose \`stream\` is an inline \`${sub.type}\` sub-resource — only ` +
          'an ext-resource stream, or an `AudioStreamRandomPitch` wrapper around one, is carried.',
      );
    }
    if (innerExtPath === undefined) {
      throw new TranslateError(
        at,
        'an AudioStreamRandomPitch whose `audio_stream` is not an ext-resource — there is no ' +
          'stream to decode.',
      );
    }
    return { stream: innerExtPath, randomPitch: audioStreamRandomPitch(sub.properties) };
  }
  if (absent) return { absent: true };
  throw new TranslateError(
    at,
    'AudioStreamPlayer.stream is authored, but is neither null nor a supported stream Resource.',
  );
}

export interface AudioStreamRandomizerEntry { readonly stream: string; readonly weight: number }
export interface AudioStreamGeneratorSpec {
  readonly mixRateMode: number;
  readonly mixRate: number;
  readonly bufferLength: number;
}
export interface AudioStreamPolyphonicSpec { readonly polyphony: number }
export interface AudioStreamRandomizerSpec {
  readonly streams: readonly AudioStreamRandomizerEntry[];
  readonly playbackMode: number;
  readonly randomPitch: number;
  readonly randomVolumeOffsetDb: number;
}
export interface AudioStreamPlaylistSpec { readonly streams: readonly (string | null)[]; readonly shuffle: boolean; readonly loop: boolean; readonly fadeTime: number }
export interface AudioStreamSynchronizedSpec { readonly streams: readonly { readonly stream: string | null; readonly volumeDb: number }[] }
export interface AudioStreamInteractiveTransitionSpec { readonly from: number; readonly to: number; readonly fromTime: number; readonly toTime: number; readonly fadeMode: number; readonly fadeBeats: number; readonly useFillerClip: boolean; readonly fillerClip: number; readonly holdPrevious: boolean }
export interface AudioStreamInteractiveSpec { readonly initialClip: number; readonly clips: readonly { readonly stream: string | null; readonly name: string; readonly autoAdvance: number; readonly nextClip: number }[]; readonly transitions: readonly AudioStreamInteractiveTransitionSpec[] }
export type AudioStreamResolve =
  | { readonly absent: true }
  | { readonly stream: string; readonly randomPitch: number | undefined }
  | { readonly generator: AudioStreamGeneratorSpec }
  | { readonly polyphonic: AudioStreamPolyphonicSpec }
  | { readonly microphone: true }
  | { readonly randomizer: AudioStreamRandomizerSpec }
  | { readonly playlist: AudioStreamPlaylistSpec }
  | { readonly synchronized: AudioStreamSynchronizedSpec }
  | { readonly interactive: AudioStreamInteractiveSpec };

export function requireAreaReverbVolume<T>(
  at: string,
  colliders: readonly T[] | undefined,
): readonly T[] {
  if (colliders !== undefined && colliders.length > 0) return colliders;
  throw new TranslateError(
    at,
    'reverb_bus_enable is true but the Area owns no carried CollisionShape volume.',
  );
}

export function refuseUnknownAudioProperty(at: string, key: string, godotClass: string | undefined): never {
  throw new TranslateError(
    at,
    `authors \`${key}\`, which is not a property of Godot 3.6's ${godotClass}. This ` +
      "emitter classifies that class's whole authored surface — every property is either " +
      'carried or named against the mechanism it costs — so an unrecognized one is an ' +
      'unmeasured shape and refuses rather than being silently dropped into the same list.',
  );
}

/**
 * The REST of the two audio classes' authored surface: each property this emitter does not carry,
 * against the MECHANISM its absence costs the emitted graph. One map for BOTH classes: every
 * mechanism is a statement about the emitted audio graph rather than the node type.
 */
export const AUDIO_DEVIATION_MECHANISMS: ReadonlyMap<string, string> = new Map([
  [
    'bus',
    'Godot routes this player to the named audio bus; every emitted player plays into the ONE ' +
      "world-owned destination (`ctx.audio.destination`), so that bus's own volume and effects " +
      'do not apply',
  ],
  [
    'volume_db',
    "the player's own output gain in dB; the emitted Web Audio source plays at unity, so the " +
      'clip is off by exactly this many dB',
  ],
  [
    'pitch_scale',
    'a constant resampling factor over playback; the emitted source sets `playbackRate` only for ' +
      'an `AudioStreamRandomPitch` wrapper, so a constant scale plays at rate 1',
  ],
  [
    'playing',
    'an authored `playing = true` starts the stream as the node loads; only `autoplay` starts an ' +
      'emitted player, so this one stays silent until a script calls play()',
  ],
  [
    'stream_paused',
    'Godot holds the playhead where it is; the emitted player has play/stop only, so a paused ' +
      'stream would restart from the beginning rather than resume',
  ],
  [
    'mix_target',
    'which speakers of a surround bus a non-positional stream feeds; the emitted graph is stereo, ' +
      'so a Surround/Center target folds into it',
  ],
  [
    'out_of_range_mode',
    'PAUSE stops the player beyond `max_distance` and resumes it on return; the emitted player is ' +
      'attenuated to silence there but keeps running, so its playhead does not hold',
  ],
  [
    'doppler_tracking',
    'Godot shifts pitch by the relative velocity of source and listener on the idle or physics ' +
      'step; the emitted player applies no Doppler shift',
  ],
  [
    'emission_angle_enabled',
    'Godot attenuates a source the listener is outside the emission cone of; the emitted player ' +
      'is omnidirectional',
  ],
  ['emission_angle_degrees', 'the width of that same emission cone, which is not modelled'],
  [
    'emission_angle_filter_attenuation_db',
    'the dB cut applied outside that same emission cone, which is not modelled',
  ],
]);
