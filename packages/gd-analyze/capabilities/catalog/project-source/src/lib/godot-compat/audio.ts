/**
 * `AudioStreamPlayer` — Web Audio directly, routed through the game's own bus.
 *
 * The pilot has two of these: `$Music` (the loop, started at `Main.gd:26` and
 * stopped at `:15`) and `$DeathSound` (a one-shot at `:16`). Godot's
 * `AudioStreamPlayer` is the NON-positional player — no panning, no distance
 * attenuation, no listener — which is precisely an `AudioBufferSourceNode`
 * connected to a gain node.
 *
 * ## The rung this file does NOT ride, and the real reason
 *
 * The candidate is `THREE.Audio`, and it is a close one: three 0.180's
 * `src/audio/Audio.js` is this transport almost line for line — a fresh
 * `AudioBufferSourceNode` per `play()`, a `_progress` rebase for pause/resume,
 * `onended`, `playbackRate`, an internal gain, `loop`. Nothing below out-thinks
 * it, so "there is nothing to wrap" is NOT the rejection, and neither is the
 * bus: `@vgai/engine/setup/setup-audio` rewires `listener.gain` into its
 * `masterGain`, so a `THREE.Audio` in a first-party three world is already
 * bus-routed. Both of those arguments are true of `THREE.Audio` too, which
 * means neither one distinguishes it.
 *
 * The reason is the SURFACE, and it is Godot's own ontology speaking:
 * `AudioStreamPlayer` is a `Node`, not a `Node3D` — a 2D game plays sound with
 * exactly the class a 3D game does. The lane's ports reproduce that. Six
 * committed ports build a player with {@link createAudioStreamPlayer}, and TWO
 * of them are `adapter: "canvas"` PixiJS worlds with no three scene graph
 * anywhere in them: `dodge-port` (`src/scenes/Main.tsx`) and
 * `starter-kit-match-3-port` (`src/components/Audio.ts`). `THREE.Audio` extends
 * `Object3D` and its constructor REQUIRES a `THREE.AudioListener`, itself an
 * `Object3D` whose `context` is three's module-global
 * `AudioContext.getContext()` singleton. Riding it in a canvas port would pull
 * three into a Pixi bundle for a non-positional sound, construct a listener
 * with no tree to sit in and no camera to follow, and bind the player to
 * three's singleton context while the port's own graph
 * ({@link ./audio-graph.ts}) is a separate `AudioContext` — and Web Audio
 * refuses to connect nodes across two contexts at all.
 *
 * So the transport stays surface-neutral and imports only `./signal`; that is
 * the load-bearing property, not a stylistic one. `audio-3d.ts` is the file
 * allowed to import three, because Godot's positional player really is a
 * `Node3D` — and it rejects `THREE.PositionalAudio` for its own, different
 * reason (Godot's distance curves and SPCAP panning are not `PannerNode`'s).
 *
 * ## Where the sound goes
 *
 * What a bare `AudioContext.destination` would lose is the **bus**, so the
 * caller passes the one it wants. On a first-party world that is
 * `ctx.audio.buses.music`/`.sfx`; in a translated port it is the master node
 * of the port's own graph (`audio-graph.ts`), because
 * `setupAudio(camera: THREE.Camera)` is a CAMERA door a canvas world cannot
 * open. Either way it is the honest translation of Godot's own `bus` property.
 *
 * ## A player built at RUNTIME, and what Godot gives it
 *
 * `starter-kit-3d-platformer`'s `scripts/audio.gd` is a 12-player POOL: `:14`
 * mints each member with `AudioStreamPlayer.new()`, `:16` adds it to the tree,
 * `:21` assigns its `bus`, and `:32` assigns its `stream` only when a sound is
 * actually dispatched. So a player must be constructible with NO stream, which
 * is what Godot's `new()` gives (`stream` is a null `Ref<AudioStream>`), and
 * the `buffer` option is optional for exactly that reason. Every rule below is
 * Godot's own, cited to the `4.7-stable` tag of the engine source — the same
 * line this lane's vendored `extension-api` dump pins:
 *
 *  - **A null stream is silent, not an error.** `play_basic()` returns an empty
 *    playback when `stream.is_null()`
 *    (`scene/audio/audio_stream_player_internal.cpp:141-144`), so `play()` on a
 *    fresh `new()` player does nothing and `playing` stays false.
 *  - **Assigning a stream STOPS the player first.** `set_stream` calls the
 *    node's own stop before swapping the ref (same file, `:257-268`).
 *  - **`bus` is a NAME, resolved against the buses the PROJECT declares.**
 *    `AudioServer::init` builds exactly one and names it `Master`
 *    (`servers/audio/audio_server.cpp:1536-1537`); `load_default_bus_layout()`
 *    replaces that set only when the project's `default_bus_layout` resource
 *    EXISTS (`:1642-1651`). A name the server does not have resolves to bus 0
 *    (`thread_find_bus_index`, `:776-782`) and bus 0 is always `Master`
 *    (`:961-962`), while a READ answers `Master` for an unmatched name
 *    (`audio_stream_player_internal.cpp:348-356`). Writing `bus` while a sound
 *    is playing re-routes it in place (`audio_stream_player.cpp:144-149`), which
 *    here is a reconnect of the player's own gain.
 *
 * `audio.gd:6` assigns the lowercase `"master"`, which matches nothing — so in
 * real Godot that write routes to bus 0 and reads back as `"Master"`, and that
 * is exactly what this file does.
 *
 * The bus SET is a real input, not a stand-in: `gd-analyze`'s
 * `translate/project.ts` already decodes `res://default_bus_layout.tres` and a
 * translated world configures the one {@link GodotAudioGraph} from it. The player's `graph`
 * option resolves names against those real bus inputs, so runtime AudioServer volume/mute writes
 * and authored sends apply to the same signal path. Solo/bypass and unknown effects still refuse
 * at translation because no exact native mixer stage is installed for them.
 *
 * Godot also gates playback on tree membership — `play_basic()` fails with
 * "Playback can only happen when a node is inside the scene tree"
 * (`audio_stream_player_internal.cpp:145`). There is no `insideTree` flag here
 * and there must not be one: a non-display Godot node has no counterpart in
 * this lane's tree at all (`node.ts`'s header — `$Music` and `$MobTimer`
 * resolve at EMISSION time to fields of the emitted class), so a compat player
 * exists exactly as long as the object that created it, which IS Godot's
 * in-tree state. The measured pool adds each player to the tree in the
 * statement after it constructs one (`audio.gd:14` then `:16`), so no measured
 * program reaches the out-of-tree state; a flag would be a shadow tree built to
 * model a case nothing can produce.
 *
 * ## The one Web Audio rule this file exists to get right
 *
 * **An `AudioBufferSourceNode` is single-use.** It cannot be restarted after
 * `stop()`, and calling `start()` twice throws. Godot's `AudioStreamPlayer` is
 * a long-lived node you `play()` and `stop()` as often as you like — the pilot
 * plays `$Music` at the start of every round. So a player here holds the BUFFER
 * and mints a fresh source per `play()`, disconnecting the previous one. That
 * is the entire reason this is a factory rather than four free functions.
 *
 * ## Resource ownership
 *
 * **Owns:** at most one live `AudioBufferSourceNode` at a time — created on
 * `play`, disconnected on `stop`, on the next `play`, and by its own `ended`
 * event so a finished one-shot does not linger. **Shares:** the `AudioBuffer`
 * and the destination `AudioNode`, both the game's. **Teardown:** `stop()`, and
 * the player holds nothing else; there is no global registry of players to
 * leak into.
 */

import { dbToLinear } from '@volter/game-runtime/audio/bus-mixer';
import type { GodotAudioGraph } from './audio-graph';
import { createSignal, type GodotSignal } from './signal';
import { createGodotAudioVoicePool } from './audio-player-polyphony';
import {
  audioStreamBuffer,
  audioStreamLoopOffset,
  audioStreamLoopEnd,
  audioStreamLoops,
  cancelGodotEncodedAudioPlayback,
  createGodotAudioStreamMicrophonePlayback,
  deferGodotEncodedAudioPlayback,
  isGodotAudioStreamMicrophone,
  type GodotAudioStream,
  type GodotAudioStreamMicrophonePlayback,
  type GodotMicrophoneInputRequest,
} from './audio-stream';
import { createGodotAudioStreamGeneratorPlayback, type GodotAudioStreamGenerator, type GodotAudioStreamGeneratorPlayback } from './audio-stream-generator';
import {
  createGodotAudioStreamPlaybackPolyphonic,
  selectGodotPlayableAudioStream,
  type GodotAudioStreamPlaybackPolyphonic,
  type GodotAudioStreamPolyphonic,
  type GodotAudioStreamRandomizer,
} from './audio-stream-composition';
import {
  createGodotAudioStreamPlaybackInteractive,
  createGodotAudioStreamPlaybackPlaylist,
  createGodotAudioStreamPlaybackSynchronized,
  type GodotAudioStreamInteractive,
  type GodotAudioStreamPlayback as GodotMusicPlayback,
  type GodotAudioStreamPlaylist,
  type GodotAudioStreamSynchronized,
} from './audio-stream-music';

export type GodotRuntimeAudioStream = AudioBuffer | GodotAudioStream | GodotAudioStreamGenerator | GodotAudioStreamRandomizer | GodotAudioStreamPolyphonic | GodotAudioStreamPlaylist | GodotAudioStreamSynchronized | GodotAudioStreamInteractive;

/** Godot's virtual `AudioStream::is_monophonic`, including extension-backed stream resources. */
export function godotAudioStreamIsMonophonic(stream: GodotRuntimeAudioStream | undefined): boolean {
  if (stream === undefined || stream instanceof AudioBuffer) return false;
  const method = (stream as GodotRuntimeAudioStream & { is_monophonic?: () => boolean }).is_monophonic;
  return typeof method === 'function' && method.call(stream);
}

/**
 * The three members BOTH of Godot's stream players carry — the transport.
 *
 * Godot's `AudioStreamPlayer` (a `Node`) and `AudioStreamPlayer3D` (a `Node3D`) are SIBLINGS, not
 * a subtype pair, and this is where that shows: the positional player in `audio-3d.ts` answers the
 * transport and nothing else, while the non-positional one below carries the mixer surface a
 * fixture measured on it. Modelling 3D as a subtype of 2D would have obliged the positional player
 * to grow a `volume_db` no fixture has ever asked it for.
 */
export interface AudioStreamPlayback {
  /** `player.playing`. */
  readonly playing: boolean;
  /** Engine plumbing, not a Godot API: one sim tick of the game-visible lifecycle — see
   *  {@link tickAudioStreamPlayers}, which drives it from the world's frame. Optional so a
   *  bespoke playback shape can satisfy this interface without one, at the cost of a
   *  wall-timed lifecycle; both shipped players (this module's and `audio-3d.ts`'s) implement
   *  it. */
  tickSim?(dt: number): void;
  /** Internal ownership hook used when a polyphonic voice leaves its player's playback list. */
  disposeVoice?(): void;
  /** Canvas-world plumbing for positional 2D players. */
  updateListener2D?(listener: { readonly x: number; readonly y: number }): void;
  /**
   * `player.play()` — `Main.gd:16`, `:26`.
   *
   * Restarts from the beginning if already playing, which is Godot's
   * behaviour (its optional `from_position` argument defaults to 0).
   */
  play(fromPosition?: number): void;
  /** `player.stop()` — `Main.gd:15`. Silent if nothing is playing. */
  stop(): void;
}

/** Godot's `AudioStreamPlayer`, narrowed to the measured surface. */
export interface AudioStreamPlayer extends AudioStreamPlayback {
  readonly __godotClass: 'AudioStreamPlayer';
  /**
   * `player.finished` — emitted when the stream reaches its END.
   *
   * `starter-kit-3d-platformer` `audio.gd:20` returns a player to a free pool with it, which is
   * the whole of that game's sound dispatch. Godot emits `finished` on natural end ONLY: an
   * explicit `stop()` is silent, and a LOOPING stream never ends, so it never emits. Both are
   * reproduced here — the Web Audio `ended` event fires for a stop too, so {@link stop} clears the
   * player's handle before stopping the node and the listener recognizes that as its own teardown.
   */
  readonly finished: GodotSignal<[]>;
  /**
   * `player.volume_db` — the player's own volume in DECIBELS, `0` meaning unity.
   *
   * `audio.gd:19` sets every pooled player to `-10`. Godot's `db_to_linear` is
   * `exp(db * 0.115129…)`, i.e. `10^(db/20)`, and that linear value is what a gain node takes —
   * so this is a per-player `GainNode` between the source and the bus. Godot's own `volume_db` is
   * per PLAYER and the bus volume multiplies it, which is exactly this chain.
   */
  volumeDb: number;
  /**
   * `player.pitch_scale` — resamples playback, changing speed and pitch together.
   *
   * `player.gd:89` drives a footstep loop's pitch from the walk speed. Godot's `pitch_scale`
   * multiplies the playback rate, which is what `AudioBufferSourceNode.playbackRate` does; an
   * `AudioStreamRandomPitch` wrapper's per-play draw MULTIPLIES with it, as Godot's does (the
   * random pitch is a property of the STREAM and `pitch_scale` a property of the PLAYER).
   *
   * Godot clamps to `[0.01, 32]` (`audio_stream_player.cpp` `set_pitch_scale`'s range) and so does
   * this — a zero or negative rate is not a slower sound, it is a stalled or reversed source that
   * never fires `ended`, so the pool in `audio.gd` would leak a player per play.
   */
  pitchScale: number;
  /** Godot 4 `max_polyphony`; defaults to one simultaneous playback. */
  maxPolyphony: number;
  autoplay: boolean;
  /**
   * `player.stream_paused` — pause playback IN PLACE and resume from the same offset.
   *
   * `player.gd:78`/`:88` toggle it every physics frame to gate a footstep loop, so the two things
   * that matter are that a redundant write is free and that resuming does not restart the sound.
   * An `AudioBufferSourceNode` cannot be paused, so a pause records the played-through offset and
   * stops the node, and a resume mints a fresh source starting at that offset — the same
   * single-use rule this file's header is about, one level up. Setting it to the value it already
   * has does nothing at all, and pausing a player that is not playing is a no-op, as Godot's is.
   */
  streamPaused: boolean;
  /**
   * `player.stream` — the decoded buffer this player plays, `undefined` for Godot's null `Ref`.
   *
   * `audio.gd:32` writes it per dispatch (`available[0].stream = load(...)`). Assigning STOPS the
   * player first, as Godot's `set_stream` does; the value is a decoded `AudioBuffer` because
   * loading and decoding `res://…` stays the PORT's job (this file's header), and compat never
   * fetches — which is why that exact line is still the one the translator refuses at.
   */
  stream: GodotRuntimeAudioStream | undefined;
  hasStreamPlayback(): boolean;
  getStreamPlayback(): GodotAudioStreamGeneratorPlayback | GodotAudioStreamPlaybackPolyphonic | GodotMusicPlayback | undefined;
  /** Move the live playback to an absolute stream position in seconds. */
  seek(position: number): void;
  /** Current stream position in seconds, including pitch-scaled elapsed time. */
  getPlaybackPosition(): number;
  /**
   * `player.bus` — the Godot bus NAME this player routes through (`audio.gd:21`).
   *
   * Resolved against {@link CreateAudioStreamPlayerOptions.buses}, with Godot's own two rules: a
   * name the project does not declare routes to bus 0 (`Master`, which is
   * {@link CreateAudioStreamPlayerOptions.destination}), and a READ answers `Master` for such a
   * name rather than echoing it back. Writing it re-routes a sound already playing.
   */
  bus: string;
}

/** What {@link createAudioStreamPlayer} needs from the game. */
export interface CreateAudioStreamPlayerOptions {
  /**
   * The decoded stream. The port loads and decodes it; compat never fetches.
   *
   * OPTIONAL because Godot's `AudioStreamPlayer.new()` gives a player whose `stream` is null
   * (`audio.gd:14` mints twelve of them and fills each one's stream later). A player with no
   * buffer is silent rather than broken, which is Godot's own `play_basic()` rule.
   */
  readonly buffer?: AudioBuffer;
  /** A Godot-shaped stream resource. Takes precedence over `buffer`. */
  readonly stream?: GodotRuntimeAudioStream;
  /** Optional host permission boundary. Omit in browsers to use getUserMedia({ audio: true }). */
  readonly microphoneInput?: GodotMicrophoneInputRequest;
  /**
   * Where the sound goes — one of `ctx.audio.buses` (`music` / `sfx` /
   * `voice`), so the game's own mute and volume apply. This is Godot's bus 0,
   * `Master`, with the engine's bus hierarchy behind it.
   */
  readonly destination: AudioNode;
  /** The port's real AudioServer graph. When present, bus lookup stays live across script writes. */
  readonly graph?: Pick<GodotAudioGraph, 'busIndex' | 'busInput'>;
  /** Authored initial bus name. Absent is Godot's `Master` default. */
  readonly bus?: string;
  /** Starts once when the authored node enters the retained scene, then remains ordinary state. */
  readonly autoplay?: boolean;
  /** Godot 4 `max_polyphony`; the runtime setter accepts every positive integer. */
  readonly maxPolyphony?: number;
  /**
   * The OTHER Godot buses this project declares, name → the engine node each routes into.
   *
   * ABSENT is not "unknown", it is Godot's own bus set: with no `default_bus_layout.tres` the
   * server has exactly ONE bus, `Master` (`audio_server.cpp:1536-1537`, `:1642-1651`), and that
   * bus is {@link destination} — which is the state of the fixture that measured `bus`. A project
   * that DOES author a layout has its buses decoded already (`gd-analyze
   * translate/project.ts`) and built on `ctx.audio.graph`; the legacy record form remains for
   * callers that supply native bus inputs directly. `Master` is
   * always {@link destination}, the way Godot's bus 0 is always named `Master` (`:961-962`).
   */
  readonly buses?: Readonly<Record<string, AudioNode>>;
  /** Godot's `AudioStreamOggVorbis.loop` (the pilot's music loops; its death
   *  sound does not). Default false. */
  readonly loop?: boolean;
  /**
   * Godot's `AudioStreamRandomPitch.random_pitch` (default 1.1), present when the
   * node's stream is that wrapper (`enemy.tscn#SoundWalkLoop`). Each `play()`
   * resamples the buffer at a pitch scale drawn uniformly from
   * `[1/randomPitch, randomPitch]`, set on the source's `playbackRate` — which,
   * like Godot's `pitch_scale`, changes both speed and pitch by resampling.
   * Absent (the common case) means flat playback at rate 1.
   */
  readonly randomPitch?: number;
  /**
   * The uniform `[0, 1)` source for the per-play pitch draw. Godot's own audio
   * pitch jitter uses the global Godot RNG, so a translated game injects its seeded
   * `ctx.random` draw. There is deliberately no ambient-random fallback.
   */
  readonly random?: () => number;
}

/**
 * The playback rate one `play()` draws from an `AudioStreamRandomPitch` stream — uniform in
 * `[1/randomPitch, randomPitch]`, Godot's `AudioStreamPlaybackRandomPitch` draw — or 1 where the
 * node's stream is not that wrapper.
 *
 * Exported for `audio-3d.ts`. Godot's random pitch is a property of the STREAM, and a `.tscn` may
 * hang an `AudioStreamRandomPitch` under either player class, so both players draw it and there is
 * exactly one place the draw is spelled.
 */
export function drawRandomRate(
  options: Pick<CreateAudioStreamPlayerOptions, 'randomPitch' | 'random'>,
): number {
  const { randomPitch } = options;
  if (randomPitch === undefined) return 1;
  if (options.random === undefined) {
    throw new Error('AudioStreamRandomPitch requires the translated project seeded random callback.');
  }
  const from = 1 / randomPitch;
  return Math.exp(Math.log(from) + options.random() * (Math.log(randomPitch) - Math.log(from)));
}

/** Godot 4's shared AudioStreamPlayer maximum-polyphony property contract. */
export function requireAudioStreamPlayerMaxPolyphony(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('AudioStreamPlayer.max_polyphony must be a positive integer.');
  }
  return value;
}

/**
 * Godot's `db_to_linear` (`core/math/math_funcs.h`): `exp(db * 0.11512925…)`, i.e. `10^(db/20)`.
 *
 * That IS `@vgai/engine/audio/bus-mixer`'s `dbToLinear`, exactly — the engine's mixer owns the
 * conversion for every lane, and Godot's own function is the unclamped form it ships, so this
 * re-export is the whole of the binding rather than a second copy of the math. Godot deliberately
 * does not clamp `volume_db` (Unity's mixer does; that stop lives in Unity's lane), so nothing is
 * lost by naming it once. Re-exported for `audio-3d.ts`, whose `volume_db` is the same conversion.
 */
export { dbToLinear };

/**
 * Godot's `set_pitch_scale` range (`audio_stream_player.cpp`'s `PROPERTY_HINT_RANGE`). Zero or
 * negative is not a slower sound — it is a source that never reaches its end, so `finished` never
 * fires and a pool keyed on it leaks a player per play.
 *
 * Exported for `audio-3d.ts`: the range is Godot's `AudioStreamPlayer3D` range too, and a bound
 * spelled twice is a bound that drifts once.
 */
export function clampPitchScale(value: number): number {
  return Math.min(32, Math.max(0.01, value));
}

/** Godot's bus 0. `AudioServer::init` creates it (`audio_server.cpp:1536-1537`), `set_bus_name`
 *  refuses to rename it (`:961-962`), and every unmatched bus name resolves to it (`:776-782`). */
const MASTER_BUS = 'Master';

/** Build a player. One per `AudioStreamPlayer` node in the translated tree. */
/** Every live player, weakly — so {@link tickAudioStreamPlayers} reaches them all without any
 *  scene threading a walk, and a player a remount dropped is pruned the moment GC collects it.
 *  Module-level is per-PROJECT state here (the capability is vendored per project, the same rule
 *  `godot-runtime`'s `liveWorld` rides), and a translated port mounts one world. */
const liveAudioStreamPlayers = new Set<WeakRef<AudioStreamPlayback>>();

/** Exported for `audio-3d.ts`, whose positional player joins the same tick walk. */
export function registerLiveAudioStreamPlayer(player: AudioStreamPlayback): void {
  liveAudioStreamPlayers.add(new WeakRef(player));
}

/**
 * One sim tick for every live player's game-visible lifecycle — the world calls this once per
 * frame beside `tree.tick(dt)`. Why it exists: Godot ends a stream on its deterministic mix
 * clock, Web Audio on the hardware's `ended` event, and every game-visible fact derived from
 * "has the stream finished" (`playing`, the `stream_paused` no-op rule, `finished`) was
 * therefore wall-timed — measured as run-to-run census divergence on a byte-identical driven
 * script. Ticked here, those facts ride the same clock as everything else in the sim; the
 * hardware keeps only the audible signal.
 */
export function tickAudioStreamPlayers(
  dt: number,
  listener2D?: { readonly x: number; readonly y: number },
): void {
  for (const ref of liveAudioStreamPlayers) {
    const player = ref.deref();
    if (player === undefined) {
      liveAudioStreamPlayers.delete(ref);
      continue;
    }
    if (listener2D !== undefined) player.updateListener2D?.(listener2D);
    player.tickSim?.(dt);
  }
}

function createAudioStreamPlayerVoice(
  options: CreateAudioStreamPlayerOptions,
): AudioStreamPlayer {
  const { destination } = options;
  const context = destination.context as AudioContext;
  // The buses this player can name. Master is PINNED to `destination` — Godot's bus 0 is always
  // "Master" and a project that declares no layout has no other bus at all.
  const buses: Readonly<Record<string, AudioNode>> = {
    ...(options.buses ?? {}),
    [MASTER_BUS]: destination,
  };
  /**
   * Godot's `AudioServer::thread_find_bus_index`: the named bus, or bus 0 for a name it has not.
   *
   * This is deliberately NOT `@vgai/engine/audio/bus-mixer`, whose whole contract is that naming a
   * bus MINTS it. Godot's bus set is closed — `AudioServer::init` builds exactly `Master`, a
   * `default_bus_layout.tres` replaces that set wholesale, and a name outside it is not an error
   * and not a new bus: it routes to bus 0 AND READS BACK `"Master"`
   * (`audio_stream_player_internal.cpp:348-356`). Minting `"SFX"` on demand would give the port a
   * bus real Godot does not have and make `player.bus` read back a name Godot would not report, so
   * the engine's mixer supplies this lane's dB conversion only. A Godot bus is also not a gain node
   * this lane owns: `audio-reverb.ts` builds each one as an exact `AudioEffectReverb` worklet, and
   * `gd-analyze`'s `translate/data/project-plan.ts` REFUSES a layout that authors `volume_db`,
   * `send`, solo/mute/bypass or any other effect rather than carrying a mixer stage it cannot
   * reproduce — so there is no per-bus dB in this lane to push down.
   */
  const busNode = (name: string): AudioNode => options.graph?.busInput(name) ?? buses[name] ?? destination;
  const hasBus = (name: string): boolean =>
    options.graph === undefined ? name in buses : options.graph.busIndex(name) >= 0;

  // The player's OWN volume, between the source and the game's bus — which is the chain Godot has
  // (`volume_db` per player, the bus volume over it). Built once and never rebuilt, so a volume
  // written while nothing plays survives to the next play.
  const gain = context.createGain();
  // Godot's own constructor default (`audio_stream_player_internal.cpp:363`).
  if (options.bus !== undefined && typeof options.bus !== 'string') {
    throw new Error(`AudioStreamPlayer bus must be a StringName; received ${String(options.bus)}.`);
  }
  let busName = options.bus ?? MASTER_BUS;
  gain.connect(busNode(busName));

  /** Godot's `stream`, a null `Ref` on a `.new()` player and a decoded buffer once the port fills
   *  it. Mutable for the same reason Godot's is: `audio.gd:32` assigns it per dispatch. */
  let stream: GodotRuntimeAudioStream | undefined = options.stream ?? options.buffer;
  let resolvedStream: AudioBuffer | GodotAudioStream | undefined;
  let generatorPlayback: GodotAudioStreamGeneratorPlayback | undefined;
  let polyphonicPlayback: GodotAudioStreamPlaybackPolyphonic | undefined;
  let musicPlayback: GodotMusicPlayback | undefined;
  let randomVolumeDb = 0;
  let playerVolumeDb = 0;
  let source: AudioBufferSourceNode | undefined;
  let microphonePlayback: GodotAudioStreamMicrophonePlayback | undefined;
  /** The `AudioStreamRandomPitch` draw for the CURRENT playback — drawn per `play()`, never per
   *  resume, because a resume continues one Godot playback rather than starting a second. */
  let randomRate = 1;
  let pitchScale = 1;
  let maxPolyphony = requireAudioStreamPlayerMaxPolyphony(options.maxPolyphony ?? 1);
  let autoplay = options.autoplay ?? false;
  let paused = false;
  // ── The SIM-CLOCK half of the player's lifecycle ─────────────────────────
  // Godot ends a stream on ITS deterministic mix clock; Web Audio ends one on the HARDWARE
  // clock's `ended` event. Every game-visible fact derived from "has the stream finished" —
  // `playing`, whether a `stream_paused` write is the Godot no-op, the `finished` signal — was
  // therefore wall-timed, and two byte-identical driven runs diverged on exactly those bits
  // (measured: the starter-kit census's `sound_footsteps.playing`/`streamPaused` flipped run to
  // run at the samples near the buffer's end). Once the world ticks
  // {@link tickAudioStreamPlayers}, the lifecycle advances HERE, on sim time, and the wall
  // `ended` event keeps only the audible cleanup. Until the first tick (an older emitted world
  // with a newer capability copy) the legacy wall behavior stands, so `finished`-pooled players
  // (`audio.gd`) never leak.
  let simDriven = false;
  /** `play()` ran and neither `stop()` nor the sim end has ended the playback. A PAUSED player
   *  keeps it — `stream_paused` suspends a playback, it does not end one. */
  let simStarted = false;
  /** Seconds into the buffer, advanced at the live rate by {@link tickAudioStreamPlayers}. */
  let simPlayhead = 0;
  /** Seconds of the buffer already played at the last rebase, and the context time that rebase
   *  happened — together, the playhead. */
  let playedOffset = 0;
  let playedFrom = 0;
  let pendingEncodedStream: GodotAudioStream | undefined;
  const resumeEncodedPlayback = (): void => {
    if (pendingEncodedStream === undefined) return;
    pendingEncodedStream = undefined;
    simStarted = false;
    player.play(simPlayhead);
  };
  const cancelEncodedPlayback = (): void => {
    if (pendingEncodedStream === undefined) return;
    cancelGodotEncodedAudioPlayback(pendingEncodedStream, resumeEncodedPlayback);
    pendingEncodedStream = undefined;
  };

  const rate = (): number => randomRate * pitchScale;
  /** Fold the time played since the last rebase into {@link playedOffset}, at the rate that was in
   *  force for it — so a `pitch_scale` write mid-play does not retroactively move the playhead. */
  const rebase = (): void => {
    if (source !== undefined) playedOffset += (context.currentTime - playedFrom) * rate();
    playedFrom = context.currentTime;
  };

  const finished = createSignal<[]>();

  const release = (node: AudioBufferSourceNode): void => {
    if (source !== node) return;
    source = undefined;
    node.disconnect();
    // Reached ONLY on a natural end: `stop()` and a pause clear `source` first, so this listener
    // recognizes those as their own teardown and returns above. That is precisely Godot's rule —
    // `finished` fires when the stream ends, never when something stopped it. Once the sim clock
    // drives the lifecycle, the SIM end owns the emission (see the sim block above) and this
    // wall-timed event keeps only the node cleanup.
    if (!simDriven) finished.emit();
  };

  /** One sim tick of the game-visible lifecycle — see the sim block above. Engine plumbing
   *  (driven by {@link tickAudioStreamPlayers} from the world's frame), not a Godot API. */
  const tickSim = (dt: number): void => {
    simDriven = true;
    if (musicPlayback !== undefined) {
      if (paused) return;
      const wasPlaying = musicPlayback.is_playing();
      musicPlayback.tick(dt);
      simPlayhead = musicPlayback.get_playback_position();
      if (wasPlaying && !musicPlayback.is_playing()) { simStarted = false; finished.emit(); }
      return;
    }
    if (!simStarted || paused) return;
    if (microphonePlayback !== undefined) {
      if (!microphonePlayback.playing) simStarted = false;
      simPlayhead = 0;
      playedOffset = 0;
      return;
    }
    if (pendingEncodedStream !== undefined) {
      simPlayhead += dt * rate();
      playedOffset = simPlayhead;
      return;
    }
    if (resolvedStream === undefined) return;
    simPlayhead += dt * rate();
    const duration = Math.max(
      audioStreamLoops(resolvedStream, options.loop ?? false)
        ? audioStreamLoopEnd(resolvedStream)
        : audioStreamBuffer(resolvedStream).duration,
      Number.EPSILON,
    );
    if (audioStreamLoops(resolvedStream, options.loop ?? false)) {
      const loopStart = audioStreamLoopOffset(resolvedStream);
      simPlayhead = loopStart + ((simPlayhead - loopStart) % Math.max(Number.EPSILON, duration - loopStart));
      return;
    }
    if (simPlayhead < duration) return;
    // The stream's natural end, on the sim clock — under a fast-forward the sim deliberately
    // leads the hardware, so the audible source is cut with it rather than left to trail.
    simStarted = false;
    simPlayhead = 0;
    tearDown();
    paused = false;
    finished.emit();
  };

  /** Mint a source at the current playhead and start it. The single-use rule this file's header is
   *  about: every start is a fresh node, whether it came from `play()` or from a resume. */
  const startSource = (): void => {
    // Godot's `play_basic()` returns an empty playback when the stream is null
    // (`audio_stream_player_internal.cpp:141-144`) — a player with no stream is SILENT, not an
    // error, and `is_playing()` stays false. That is the whole state a `.new()` player is in until
    // the port assigns one.
    if (stream === undefined) return;
    if (
      !(stream instanceof AudioBuffer) &&
      stream.kind === 'AudioStream' &&
      isGodotAudioStreamMicrophone(stream)
    ) {
      if (pitchScale !== 1) {
        throw new Error(
          'AudioStreamMicrophone pitch_scale other than 1 requires Godot input-buffer resampling, which native MediaStreamAudioSourceNode cannot reproduce.',
        );
      }
      microphonePlayback = createGodotAudioStreamMicrophonePlayback(context, gain, {
        ...(options.microphoneInput === undefined ? {} : { requestInput: options.microphoneInput }),
        onFailure: (error) => {
          if (microphonePlayback?.failure !== error) return;
          simStarted = false;
          console.error(error);
        },
        onEnded: () => { simStarted = false; },
      });
      return;
    }
    if (!(stream instanceof AudioBuffer) && stream.kind === 'AudioStreamGenerator') {
      if (generatorPlayback !== undefined) {
        generatorPlayback.set_pitch_scale(rate());
        generatorPlayback.start();
        return;
      }
      const playback = createGodotAudioStreamGeneratorPlayback(context, stream);
      generatorPlayback = playback;
      playback.connect(gain);
      playback.set_pitch_scale(rate());
      playback.start();
      return;
    }
    if (!(stream instanceof AudioBuffer) && stream.kind === 'AudioStreamPolyphonic') {
      if (options.random === undefined) throw new Error('AudioStreamPolyphonic requires the translated project seeded random callback.');
      polyphonicPlayback ??= createGodotAudioStreamPlaybackPolyphonic(context, gain, stream, options.random);
      return;
    }
    if (!(stream instanceof AudioBuffer) && (stream.kind === 'AudioStreamPlaylist' || stream.kind === 'AudioStreamSynchronized' || stream.kind === 'AudioStreamInteractive')) {
      if (options.random === undefined) throw new Error(`${stream.kind} requires the translated project seeded random callback.`);
      musicPlayback?.dispose();
      musicPlayback = stream.kind === 'AudioStreamPlaylist'
        ? createGodotAudioStreamPlaybackPlaylist(context, gain, stream, options.random)
        : stream.kind === 'AudioStreamSynchronized'
          ? createGodotAudioStreamPlaybackSynchronized(context, gain, stream, options.random)
          : createGodotAudioStreamPlaybackInteractive(context, gain, stream, options.random);
      musicPlayback.set_pitch_scale(rate());
      musicPlayback.start(playedOffset);
      return;
    }
    if (!(stream instanceof AudioBuffer) && stream.kind === 'AudioStreamRandomizer') {
      if (options.random === undefined) throw new Error('AudioStreamRandomizer requires the translated project seeded random callback.');
      const selected = selectGodotPlayableAudioStream(stream, options.random);
      if (selected === undefined) { simStarted = false; return; }
      resolvedStream = selected.stream;
      randomRate = selected.pitchScale;
      randomVolumeDb = selected.volumeDb;
      gain.gain.value = dbToLinear(playerVolumeDb + randomVolumeDb);
    } else resolvedStream = stream;
    const buffer = audioStreamBuffer(resolvedStream);
    if (context.state === 'suspended') void context.resume();
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.loop = audioStreamLoops(resolvedStream, options.loop ?? false);
    if (node.loop) {
      node.loopStart = audioStreamLoopOffset(resolvedStream);
      node.loopEnd = audioStreamLoopEnd(resolvedStream);
    }
    node.playbackRate.value = rate();
    node.connect(gain);
    node.addEventListener('ended', () => release(node), { once: true });
    playedFrom = context.currentTime;
    node.start(0, playedOffset % Math.max(buffer.duration, Number.EPSILON));
    source = node;
  };

  /** Stop the live source without letting it report a natural end. */
  const tearDown = (): void => {
    const node = source;
    if (node === undefined) return;
    // Order matters: `stop()` fires `ended`, whose listener would otherwise race the disconnect
    // below AND emit `finished`. Clearing `source` first makes both paths idempotent.
    source = undefined;
    node.stop();
    node.disconnect();
  };

  const player = {
    __godotClass: 'AudioStreamPlayer' as const,
    finished: finished.signal,
    tickSim,
    get playing(): boolean {
      // A PAUSED player is still playing in Godot — `stream_paused` suspends the playback, it does
      // not end it — so the paused case reports true with no live source behind it. Sim-driven,
      // the answer is the sim lifecycle's (which a pause keeps), never the hardware's.
      if (simDriven) return simStarted;
      return pendingEncodedStream !== undefined || microphonePlayback?.playing === true || source !== undefined || paused || generatorPlayback?.is_playing() === true || polyphonicPlayback !== undefined || musicPlayback?.is_playing() === true;
    },
    get volumeDb(): number {
      // Read back through the same conversion, so a write followed by a read is the decibel value
      // Godot would report rather than the linear gain.
      return playerVolumeDb;
    },
    set volumeDb(db: number) {
      playerVolumeDb = db;
      gain.gain.value = dbToLinear(db + randomVolumeDb);
    },
    get stream(): GodotRuntimeAudioStream | undefined {
      return stream;
    },
    set stream(value: GodotRuntimeAudioStream | undefined) {
      if (value === stream) return;
      cancelEncodedPlayback();
      // Godot's `set_stream` calls the player's own stop before swapping the ref
      // (`audio_stream_player_internal.cpp:257-268`), so a pooled player that is handed a new
      // sound never layers it over the last one.
      tearDown();
      paused = false;
      playedOffset = 0;
      simStarted = false;
      simPlayhead = 0;
      generatorPlayback?.stop(); generatorPlayback?.dispose(); generatorPlayback = undefined;
      microphonePlayback?.stop(); microphonePlayback = undefined;
      polyphonicPlayback?.dispose(); polyphonicPlayback = undefined;
      musicPlayback?.dispose(); musicPlayback = undefined;
      resolvedStream = undefined;
      stream = value;
    },
    get bus(): string {
      // Godot's `get_bus()` answers the stored name only while it names a LIVE bus and falls back
      // to Master otherwise (`audio_stream_player_internal.cpp:348-356`). `audio.gd:6`'s lowercase
      // "master" names no bus, so this reads back "Master" — as it does in Godot.
      return hasBus(busName) ? busName : MASTER_BUS;
    },
    set bus(name: string) {
      if (name === busName) return;
      busName = name;
      // Godot re-routes a sound already playing rather than waiting for the next `play()`
      // (`audio_stream_player.cpp:144-149`, one `set_playback_bus_exclusive` per live playback).
      // One gain node carries every source this player mints, so one reconnect is that.
      gain.disconnect();
      gain.connect(busNode(name));
    },
    get pitchScale(): number {
      return pitchScale;
    },
    set pitchScale(value: number) {
      const clamped = clampPitchScale(value);
      const microphoneStream =
        !(stream instanceof AudioBuffer) &&
        stream?.kind === 'AudioStream' &&
        isGodotAudioStreamMicrophone(stream);
      if (clamped !== 1 && (microphonePlayback !== undefined || microphoneStream)) {
        throw new Error(
          'AudioStreamMicrophone pitch_scale other than 1 requires Godot input-buffer resampling, which native MediaStreamAudioSourceNode cannot reproduce.',
        );
      }
      if (clamped === pitchScale) return;
      rebase();
      pitchScale = clamped;
      if (source !== undefined) source.playbackRate.value = rate();
      generatorPlayback?.set_pitch_scale(rate());
      musicPlayback?.set_pitch_scale(rate());
    },
    get maxPolyphony(): number {
      return maxPolyphony;
    },
    set maxPolyphony(value: number) {
      maxPolyphony = requireAudioStreamPlayerMaxPolyphony(value);
    },
    get autoplay(): boolean {
      return autoplay;
    },
    set autoplay(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer.autoplay must be bool.');
      autoplay = value;
    },
    get streamPaused(): boolean {
      return paused;
    },
    set streamPaused(value: boolean) {
      if (value === paused) return;
      paused = value;
      if (value) {
        if (microphonePlayback !== undefined) {
          microphonePlayback.setPaused(true);
          return;
        }
        if (musicPlayback?.is_playing() === true) {
          playedOffset = musicPlayback.get_playback_position();
          musicPlayback.pause();
          return;
        }
        if (generatorPlayback?.is_playing() === true) {
          generatorPlayback.pause();
          return;
        }
        // Nothing playing: record the flag and stop there, as Godot does — a later `play()` on a
        // paused player is what unpauses it there and here. "Nothing playing" is the SIM
        // lifecycle's verdict once it drives — the wall `ended` racing this write was measured
        // as run-to-run census divergence (the sim block above).
        if (simDriven ? !simStarted : source === undefined) {
          paused = false;
          return;
        }
        rebase();
        tearDown();
        return;
      }
      if (microphonePlayback !== undefined) {
        microphonePlayback.setPaused(false);
        return;
      }
      if (generatorPlayback !== undefined) { generatorPlayback.resume(); return; }
      if (musicPlayback !== undefined) { musicPlayback.resume(); return; }
      startSource();
    },
    play(fromPosition = 0): void {
      cancelEncodedPlayback();
      // Godot restarts a playing stream rather than layering a second copy.
      tearDown();
      microphonePlayback?.stop(); microphonePlayback = undefined;
      generatorPlayback?.stop();
      polyphonicPlayback?.dispose(); polyphonicPlayback = undefined;
      musicPlayback?.dispose(); musicPlayback = undefined;
      paused = false;
      const requestedStream = stream;
      if (
        requestedStream !== undefined &&
        !(requestedStream instanceof AudioBuffer) &&
        requestedStream.kind === 'AudioStream' &&
        deferGodotEncodedAudioPlayback(requestedStream, resumeEncodedPlayback)
      ) {
        pendingEncodedStream = requestedStream;
        simStarted = true;
        simPlayhead = Math.max(0, fromPosition);
        return;
      }
      const ordinaryStream = stream instanceof AudioBuffer || stream?.kind === 'AudioStream' ? stream : undefined;
      const microphoneStream =
        !(ordinaryStream instanceof AudioBuffer) &&
        ordinaryStream !== undefined &&
        isGodotAudioStreamMicrophone(ordinaryStream);
      const duration = ordinaryStream === undefined || microphoneStream
        ? 0
        : audioStreamBuffer(ordinaryStream).duration;
      playedOffset = ordinaryStream === undefined ? Math.max(0, fromPosition) : Math.min(duration, Math.max(0, fromPosition));
      simStarted = stream !== undefined;
      simPlayhead = playedOffset;
      // An `AudioStreamRandomPitch` stream plays at a fresh random pitch scale each time — Godot
      // resamples, and so does `playbackRate`. Rate 1 without the wrapper, and `pitch_scale`
      // multiplies whichever it is, exactly as Godot's player multiplies the stream's draw.
      randomRate = drawRandomRate(options);
      randomVolumeDb = 0;
      gain.gain.value = dbToLinear(playerVolumeDb);
      startSource();
    },
    stop(): void {
      cancelEncodedPlayback();
      tearDown();
      microphonePlayback?.stop(); microphonePlayback = undefined;
      paused = false;
      playedOffset = 0;
      simStarted = false;
      simPlayhead = 0;
      generatorPlayback?.stop();
      polyphonicPlayback?.dispose(); polyphonicPlayback = undefined;
      musicPlayback?.stop();
    },
    disposeVoice(): void {
      player.stop();
      generatorPlayback?.dispose(); generatorPlayback = undefined;
      polyphonicPlayback?.dispose(); polyphonicPlayback = undefined;
      musicPlayback?.dispose(); musicPlayback = undefined;
      gain.disconnect();
    },
    seek(position: number): void {
      if (
        microphonePlayback !== undefined ||
        (!(stream instanceof AudioBuffer) &&
          stream?.kind === 'AudioStream' &&
          isGodotAudioStreamMicrophone(stream))
      ) return;
      if (generatorPlayback !== undefined) {
        generatorPlayback.seek(position);
        simPlayhead = generatorPlayback.get_playback_position();
        return;
      }
      if (musicPlayback !== undefined) { musicPlayback.seek(position); return; }
      const duration = resolvedStream === undefined ? 0 : audioStreamBuffer(resolvedStream).duration;
      const next = Math.min(duration, Math.max(0, Number.isFinite(position) ? position : 0));
      const restart = simStarted && !paused;
      tearDown();
      playedOffset = next;
      simPlayhead = next;
      if (restart) startSource();
    },
    getPlaybackPosition(): number {
      if (
        microphonePlayback !== undefined ||
        (!(stream instanceof AudioBuffer) &&
          stream?.kind === 'AudioStream' &&
          isGodotAudioStreamMicrophone(stream))
      ) return 0;
      if (generatorPlayback !== undefined) return generatorPlayback.get_playback_position();
      if (musicPlayback !== undefined) return musicPlayback.get_playback_position();
      if (simDriven) return simPlayhead;
      if (source === undefined || paused) return playedOffset;
      const duration = resolvedStream === undefined ? 0 : audioStreamBuffer(resolvedStream).duration;
      return Math.min(duration, playedOffset + (context.currentTime - playedFrom) * rate());
    },
    hasStreamPlayback(): boolean {
      return generatorPlayback !== undefined || polyphonicPlayback !== undefined || musicPlayback !== undefined;
    },
    getStreamPlayback(): GodotAudioStreamGeneratorPlayback | GodotAudioStreamPlaybackPolyphonic | GodotMusicPlayback | undefined {
      return generatorPlayback ?? polyphonicPlayback ?? musicPlayback;
    },
  };
  return player;
}

/** One Godot node owning an ordered list of independently playing stream voices. */
export function createAudioStreamPlayer(options: CreateAudioStreamPlayerOptions): AudioStreamPlayer {
  const buses: Readonly<Record<string, AudioNode>> = {
    ...(options.buses ?? {}),
    [MASTER_BUS]: options.destination,
  };
  const hasBus = (name: string): boolean =>
    options.graph === undefined ? name in buses : options.graph.busIndex(name) >= 0;
  let stream: GodotRuntimeAudioStream | undefined = options.stream ?? options.buffer;
  let volumeDb = 0;
  let pitchScale = 1;
  let busName = options.bus ?? MASTER_BUS;
  let autoplay = options.autoplay ?? false;
  let maxPolyphony = requireAudioStreamPlayerMaxPolyphony(options.maxPolyphony ?? 1);

  const createVoice = (): AudioStreamPlayer => {
    const voice = createAudioStreamPlayerVoice({
      destination: options.destination,
      ...(options.graph === undefined ? {} : { graph: options.graph }),
      ...(options.buses === undefined ? {} : { buses: options.buses }),
      ...(options.loop === undefined ? {} : { loop: options.loop }),
      ...(options.randomPitch === undefined ? {} : { randomPitch: options.randomPitch }),
      ...(options.random === undefined ? {} : { random: options.random }),
      ...(options.microphoneInput === undefined ? {} : { microphoneInput: options.microphoneInput }),
      ...(stream === undefined ? {} : { stream }),
      bus: busName,
      autoplay: false,
      maxPolyphony: 1,
    });
    voice.volumeDb = volumeDb;
    voice.pitchScale = pitchScale;
    return voice;
  };
  const pool = createGodotAudioVoicePool(createVoice, maxPolyphony);
  const player: AudioStreamPlayer = {
    __godotClass: 'AudioStreamPlayer',
    finished: pool.finished,
    get playing(): boolean { return pool.playing; },
    tickSim(dt: number): void { pool.tickSim(dt); },
    play(fromPosition = 0): void { pool.play(fromPosition, godotAudioStreamIsMonophonic(stream)); },
    stop(): void { pool.stop(); },
    seek(position: number): void { pool.seek(position); },
    getPlaybackPosition(): number { return pool.latest?.getPlaybackPosition() ?? 0; },
    get volumeDb(): number { return volumeDb; },
    set volumeDb(value: number) {
      volumeDb = value;
      pool.forEach((voice) => { voice.volumeDb = value; });
    },
    get pitchScale(): number { return pitchScale; },
    set pitchScale(value: number) {
      pitchScale = clampPitchScale(value);
      pool.forEach((voice) => { voice.pitchScale = pitchScale; });
    },
    get maxPolyphony(): number { return maxPolyphony; },
    set maxPolyphony(value: number) {
      maxPolyphony = requireAudioStreamPlayerMaxPolyphony(value);
      pool.setMaxPolyphony(maxPolyphony);
    },
    get autoplay(): boolean { return autoplay; },
    set autoplay(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer.autoplay must be bool.');
      autoplay = value;
    },
    get streamPaused(): boolean { return pool.streamPaused; },
    set streamPaused(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlayer.stream_paused must be bool.');
      pool.setStreamPaused(value);
    },
    get stream(): GodotRuntimeAudioStream | undefined { return stream; },
    set stream(value: GodotRuntimeAudioStream | undefined) {
      if (value === stream) return;
      pool.stop();
      stream = value;
    },
    get bus(): string { return hasBus(busName) ? busName : MASTER_BUS; },
    set bus(value: string) {
      if (typeof value !== 'string') throw new TypeError('AudioStreamPlayer.bus must be a StringName.');
      busName = value;
      pool.forEach((voice) => { voice.bus = value; });
    },
    hasStreamPlayback(): boolean { return pool.hasVoices; },
    getStreamPlayback(): GodotAudioStreamGeneratorPlayback | GodotAudioStreamPlaybackPolyphonic | GodotMusicPlayback | undefined {
      return pool.latest?.getStreamPlayback();
    },
  };
  registerLiveAudioStreamPlayer(player);
  if (autoplay) player.play();
  return player;
}
