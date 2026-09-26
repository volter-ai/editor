/**
 * @godot-class AudioStreamPlayer3D
 * @role BINDING
 *
 * Godot 4.7's `AudioStreamPlayer3D` (`scene/3d/audio_stream_player_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto Web Audio: its playbacks are the
 * `AudioStreamPlayer` machinery's (`audio-stream-player.ts`), sounding through a `PannerNode` at
 * the node's global position, heard from the viewport's current camera, both updated each physics
 * step (`_update_panning`, `NOTIFICATION_INTERNAL_PHYSICS_PROCESS`). Godot's distance attenuation
 * (`_get_attenuation_db`, `:233`) maps onto the panner's model beyond `unit_size`, where the two
 * agree: inverse distance is `inverse` with `refDistance` the unit size, inverse square is
 * `exponential` with rolloff 2, logarithmic is `exponential` with rolloff `ln 10`; disabled is no
 * distance gain. Past `max_distance` (when set) the player is silent, as Godot skips it. Named
 * deviations (`web-audio-attenuation`): within `unit_size` Godot's gain rises above 1 up to
 * `max_db`, the panner's stays at 1; Godot pans by its speaker mix and `panning_strength`, the
 * panner by `equalpower`; doppler, emission angles, area reverb and the attenuation filter are not
 * bound.
 */

import type { Object3D } from 'three';
import { godot_audio_context } from './audio-stream';
import * as P from './audio-stream-player';
import { godot_camera_3d_of_viewport } from './camera-3d';
import { godot_node_entity } from './node';
import { get_global_transform } from './node-3d';
import { godot_tree, godot_tree_root } from './scene-tree';

const f32 = Math.fround;

/** `AttenuationModel` (`audio_stream_player_3d.h:46`). */
const ATTENUATION_INVERSE_DISTANCE = 0;
const ATTENUATION_INVERSE_SQUARE_DISTANCE = 1;
const ATTENUATION_LOGARITHMIC = 2;

interface Spatial {
  unitSize: number;
  maxDb: number;
  maxDistance: number;
  attenuationModel: number;
  dopplerTracking: number;
  panningStrength: number;
  panner: PannerNode | null;
  cut: GainNode | null;
}

const SPATIAL = new WeakMap<object, Spatial>();

function spatialOf(self: object, member: string): Spatial {
  const spatial = SPATIAL.get(godot_node_entity(self));
  if (spatial === undefined) throw new Error(`godot-compat: ${member} on an object that is not an AudioStreamPlayer3D`);
  return spatial;
}

/**
 * The panner parameters an attenuation model maps to (`_get_attenuation_db`, `:233`), as Web Audio
 * spells them; null for `ATTENUATION_DISABLED`.
 *
 * @godot AudioStreamPlayer3D (protocol)
 * @source scene/3d/audio_stream_player_3d.cpp:233
 */
export function godot_audio_stream_player_3d_panner(model: number, unitSize: number): { readonly distanceModel: DistanceModelType; readonly refDistance: number; readonly rolloffFactor: number } | null {
  if (model === ATTENUATION_INVERSE_DISTANCE) return { distanceModel: 'inverse', refDistance: unitSize, rolloffFactor: 1 };
  if (model === ATTENUATION_INVERSE_SQUARE_DISTANCE) return { distanceModel: 'exponential', refDistance: unitSize, rolloffFactor: 2 };
  if (model === ATTENUATION_LOGARITHMIC) return { distanceModel: 'exponential', refDistance: unitSize, rolloffFactor: Math.LN10 };
  return null;
}

/** `_update_panning`: the panner and listener at the node and camera, the cut past `max_distance`. */
function pan(entity: Object3D, spatial: Spatial): void {
  const audio = godot_audio_context();
  if (audio === null || spatial.panner === null || spatial.cut === null) return;
  const at = get_global_transform(entity).origin;
  spatial.panner.positionX.value = at.x;
  spatial.panner.positionY.value = at.y;
  spatial.panner.positionZ.value = at.z;
  const params = godot_audio_stream_player_3d_panner(spatial.attenuationModel, spatial.unitSize);
  spatial.panner.distanceModel = params?.distanceModel ?? 'inverse';
  spatial.panner.refDistance = params?.refDistance ?? 1;
  spatial.panner.rolloffFactor = params?.rolloffFactor ?? 0;
  const root = godot_tree_root();
  const camera = root === undefined ? null : godot_camera_3d_of_viewport(root as Object3D);
  let distance = 0;
  if (camera !== null) {
    const eye = get_global_transform(camera);
    const listener = audio.listener;
    listener.positionX.value = eye.origin.x;
    listener.positionY.value = eye.origin.y;
    listener.positionZ.value = eye.origin.z;
    listener.forwardX.value = -eye.basis.z.x;
    listener.forwardY.value = -eye.basis.z.y;
    listener.forwardZ.value = -eye.basis.z.z;
    listener.upX.value = eye.basis.y.x;
    listener.upY.value = eye.basis.y.y;
    listener.upZ.value = eye.basis.y.z;
    distance = Math.hypot(at.x - eye.origin.x, at.y - eye.origin.y, at.z - eye.origin.z);
  }
  spatial.cut.gain.value = spatial.maxDistance > 0 && distance > spatial.maxDistance ? 0 : 1;
}

/**
 * Makes `entity` an AudioStreamPlayer3D: its playbacks sound through its panner.
 *
 * @godot AudioStreamPlayer3D (protocol)
 * @source scene/3d/audio_stream_player_3d.cpp:974
 */
export function godot_audio_stream_player_3d_mount(entity: Object3D): void {
  const spatial: Spatial = { unitSize: 10, maxDb: 3, maxDistance: 0, attenuationModel: ATTENUATION_INVERSE_DISTANCE, dopplerTracking: 0, panningStrength: 1, panner: null, cut: null };
  SPATIAL.set(entity, spatial);
  P.godot_audio_player_mount(entity, (audio) => {
    if (spatial.panner === null || spatial.cut === null) {
      spatial.panner = audio.createPanner();
      spatial.panner.panningModel = 'equalpower';
      spatial.cut = audio.createGain();
      spatial.panner.connect(spatial.cut).connect(audio.destination);
    }
    pan(entity, spatial);
    return spatial.panner;
  });
  godot_tree().physics_frame.connect(() => pan(entity, spatial));
}

/**
 * @godot AudioStreamPlayer3D.play
 * @source scene/3d/audio_stream_player_3d.cpp:649
 */
export function play(self: object, from_position = 0.0): void {
  P.play(self, from_position);
}

/**
 * @godot AudioStreamPlayer3D.stop
 * @source scene/3d/audio_stream_player_3d.cpp:671
 */
export function stop(self: object): void {
  P.stop(self);
}

/**
 * @godot AudioStreamPlayer3D.is_playing
 * @source scene/3d/audio_stream_player_3d.cpp:676
 */
export function is_playing(self: object): boolean {
  return P.is_playing(self);
}

/**
 * @godot AudioStreamPlayer3D.get_playback_position
 * @source scene/3d/audio_stream_player_3d.cpp:683
 */
export function get_playback_position(self: object): number {
  return P.get_playback_position(self);
}

/**
 * @godot AudioStreamPlayer3D.set_stream
 * @source scene/3d/audio_stream_player_3d.cpp:599
 */
export function set_stream(self: object, stream: object | null): void {
  P.set_stream(self, stream);
}

/**
 * @godot AudioStreamPlayer3D.get_stream
 * @source scene/3d/audio_stream_player_3d.cpp:603
 */
export function get_stream(self: object): object | null {
  return P.get_stream(self);
}

/**
 * @godot AudioStreamPlayer3D.set_volume_db
 * @source scene/3d/audio_stream_player_3d.cpp:607
 */
export function set_volume_db(self: object, volume_db: number): void {
  P.set_volume_db(self, volume_db);
}

/**
 * @godot AudioStreamPlayer3D.get_volume_db
 * @source scene/3d/audio_stream_player_3d.cpp:612
 */
export function get_volume_db(self: object): number {
  return P.get_volume_db(self);
}

/**
 * @godot AudioStreamPlayer3D.set_pitch_scale
 * @source scene/3d/audio_stream_player_3d.cpp:641
 */
export function set_pitch_scale(self: object, pitch_scale: number): void {
  P.set_pitch_scale(self, pitch_scale);
}

/**
 * @godot AudioStreamPlayer3D.get_pitch_scale
 * @source scene/3d/audio_stream_player_3d.cpp:645
 */
export function get_pitch_scale(self: object): number {
  return P.get_pitch_scale(self);
}

/**
 * @godot AudioStreamPlayer3D.set_bus
 * @source scene/3d/audio_stream_player_3d.cpp:690
 */
export function set_bus(self: object, bus: string): void {
  P.set_bus(self, bus);
}

/**
 * @godot AudioStreamPlayer3D.get_bus
 * @source scene/3d/audio_stream_player_3d.cpp:694
 */
export function get_bus(self: object): string {
  return P.get_bus(self);
}

/**
 * @godot AudioStreamPlayer3D.set_autoplay
 * @source scene/3d/audio_stream_player_3d.cpp:698
 */
export function set_autoplay(self: object, enable: boolean): void {
  P.set_autoplay(self, enable);
}

/**
 * @godot AudioStreamPlayer3D.is_autoplay_enabled
 * @source scene/3d/audio_stream_player_3d.cpp:702
 */
export function is_autoplay_enabled(self: object): boolean {
  return P.is_autoplay_enabled(self);
}

/**
 * @godot AudioStreamPlayer3D.set_playing
 * @source scene/3d/audio_stream_player_3d.cpp:706
 */
export function set_playing(self: object, enable: boolean): void {
  P.set_playing(self, enable);
}

/**
 * @godot AudioStreamPlayer3D.set_max_polyphony
 * @source scene/3d/audio_stream_player_3d.cpp:823
 */
export function set_max_polyphony(self: object, max_polyphony: number): void {
  P.set_max_polyphony(self, max_polyphony);
}

/**
 * @godot AudioStreamPlayer3D.get_max_polyphony
 * @source scene/3d/audio_stream_player_3d.cpp:827
 */
export function get_max_polyphony(self: object): number {
  return P.get_max_polyphony(self);
}

/**
 * @godot AudioStreamPlayer3D.set_unit_size
 * @source scene/3d/audio_stream_player_3d.cpp:624
 */
export function set_unit_size(self: object, unit_size: number): void {
  spatialOf(self, 'set_unit_size').unitSize = f32(unit_size);
}

/**
 * @godot AudioStreamPlayer3D.get_unit_size
 * @source scene/3d/audio_stream_player_3d.cpp:629
 */
export function get_unit_size(self: object): number {
  return spatialOf(self, 'get_unit_size').unitSize;
}

/**
 * @godot AudioStreamPlayer3D.set_max_db
 * @source scene/3d/audio_stream_player_3d.cpp:633
 */
export function set_max_db(self: object, max_db: number): void {
  spatialOf(self, 'set_max_db').maxDb = f32(max_db);
}

/**
 * @godot AudioStreamPlayer3D.get_max_db
 * @source scene/3d/audio_stream_player_3d.cpp:637
 */
export function get_max_db(self: object): number {
  return spatialOf(self, 'get_max_db').maxDb;
}

/**
 * A negative distance fails.
 *
 * @godot AudioStreamPlayer3D.set_max_distance
 * @source scene/3d/audio_stream_player_3d.cpp:714
 */
export function set_max_distance(self: object, metres: number): void {
  if (metres < 0) return;
  spatialOf(self, 'set_max_distance').maxDistance = f32(metres);
}

/**
 * @godot AudioStreamPlayer3D.get_max_distance
 * @source scene/3d/audio_stream_player_3d.cpp:720
 */
export function get_max_distance(self: object): number {
  return spatialOf(self, 'get_max_distance').maxDistance;
}

/**
 * A model outside `0..3` fails.
 *
 * @godot AudioStreamPlayer3D.set_attenuation_model
 * @source scene/3d/audio_stream_player_3d.cpp:775
 */
export function set_attenuation_model(self: object, model: number): void {
  if (model < 0 || model >= 4) return;
  spatialOf(self, 'set_attenuation_model').attenuationModel = model;
}

/**
 * @godot AudioStreamPlayer3D.get_attenuation_model
 * @source scene/3d/audio_stream_player_3d.cpp:781
 */
export function get_attenuation_model(self: object): number {
  return spatialOf(self, 'get_attenuation_model').attenuationModel;
}

/**
 * Stored; doppler is not bound.
 *
 * @godot AudioStreamPlayer3D.set_doppler_tracking
 * @source scene/3d/audio_stream_player_3d.cpp:785
 */
export function set_doppler_tracking(self: object, tracking: number): void {
  spatialOf(self, 'set_doppler_tracking').dopplerTracking = tracking;
}

/**
 * @godot AudioStreamPlayer3D.get_doppler_tracking
 * @source scene/3d/audio_stream_player_3d.cpp:803
 */
export function get_doppler_tracking(self: object): number {
  return spatialOf(self, 'get_doppler_tracking').dopplerTracking;
}

/**
 * A negative strength fails; stored, not applied (the panner pans by `equalpower`).
 *
 * @godot AudioStreamPlayer3D.set_panning_strength
 * @source scene/3d/audio_stream_player_3d.cpp:831
 */
export function set_panning_strength(self: object, strength: number): void {
  if (strength < 0) return;
  spatialOf(self, 'set_panning_strength').panningStrength = f32(strength);
}

/**
 * @godot AudioStreamPlayer3D.get_panning_strength
 * @source scene/3d/audio_stream_player_3d.cpp:836
 */
export function get_panning_strength(self: object): number {
  return spatialOf(self, 'get_panning_strength').panningStrength;
}
