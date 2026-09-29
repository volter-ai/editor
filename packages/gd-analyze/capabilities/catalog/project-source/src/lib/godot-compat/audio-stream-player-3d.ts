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
 * distance gain. Past `max_distance` (when set) the player is silent, as Godot skips it. Where the
 * panner differs: within `unit_size` Godot's gain rises above 1 up to `max_db`, the panner's stays
 * at 1; Godot pans by its speaker mix and `panning_strength`, the
 * panner by `equalpower`. The attenuation filter is Godot's: a high-shelf `BiquadFilterNode` at
 * `attenuation_filter_cutoff_hz` whose gain is the share of the distance attenuation
 * `attenuation_filter_db` gives, lowered by `emission_angle_filter_attenuation_db` when the camera
 * is outside the emission angle (`_update_panning`, `:477`). Doppler and area reverb (buses are not
 * bound) are not.
 */

import { godot_audio_listener_3d_current } from './audio-listener-3d';
import type { Object3D } from 'three';
import { godot_audio_bus_output, godot_audio_context } from './audio-stream';
import * as P from './audio-stream-player';
import type { GodotSignal } from './signal';
import { godot_camera_3d_of_viewport } from './camera-3d';
import { godot_node_entity, godot_node_set_internal_physics } from './node';
import { get_global_transform } from './node-3d';
import { godot_tree_root } from './scene-tree';
import type { ReactElement } from 'react';
import { Group } from 'three';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

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
  areaMask: number;
  emissionAngleEnabled: boolean;
  emissionAngle: number;
  emissionAngleFilterAttenuationDb: number;
  attenuationFilterCutoffHz: number;
  attenuationFilterDb: number;
  panner: PannerNode | null;
  filter: BiquadFilterNode | null;
  cut: GainNode | null;
}

/** `CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = 0.00001;

/** `_get_attenuation_db` (`audio_stream_player_3d.cpp:233`): the model's attenuation plus the volume, capped at `max_db`. */
function attenuationDb(entity: Object3D, spatial: Spatial, distance: number): number {
  let att = 0;
  const d = distance / spatial.unitSize;
  if (spatial.attenuationModel === ATTENUATION_INVERSE_DISTANCE) att = 20 * Math.log10(1 / (d + CMP_EPSILON));
  else if (spatial.attenuationModel === ATTENUATION_INVERSE_SQUARE_DISTANCE) att = 20 * Math.log10(1 / (d * d + CMP_EPSILON));
  else if (spatial.attenuationModel === ATTENUATION_LOGARITHMIC) att = -20 * Math.log(d + CMP_EPSILON);
  att += P.get_volume_db(entity);
  return f32(Math.min(att, spatial.maxDb));
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
  // The viewport's current AudioListener3D, else its camera (`audio_stream_player_3d.cpp:400`).
  const camera = godot_audio_listener_3d_current() ?? (root === undefined ? null : godot_camera_3d_of_viewport(root as Object3D));
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
  if (spatial.filter !== null) {
    let multiplier = Math.pow(10, attenuationDb(entity, spatial, distance) / 20);
    if (spatial.maxDistance > 0) multiplier *= Math.max(0, 1 - distance / spatial.maxDistance);
    let dbAtt = (1 - Math.min(1, multiplier)) * spatial.attenuationFilterDb;
    if (spatial.emissionAngleEnabled && camera !== null) {
      // The angle between the node's +Z and the camera-to-node direction (`:481`).
      const eye = get_global_transform(camera).origin;
      const z = get_global_transform(entity).basis.z;
      const to = [at.x - eye.x, at.y - eye.y, at.z - eye.z] as const;
      const lengths = Math.hypot(...to) * Math.hypot(z.x, z.y, z.z);
      const c = lengths === 0 ? 1 : (to[0] * z.x + to[1] * z.y + to[2] * z.z) / lengths;
      if ((Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI > spatial.emissionAngle) dbAtt += spatial.emissionAngleFilterAttenuationDb;
    }
    spatial.filter.frequency.value = spatial.attenuationFilterCutoffHz;
    spatial.filter.gain.value = dbAtt;
  }
}

/**
 * Makes `entity` an AudioStreamPlayer3D: its playbacks sound through its panner.
 *
 * @godot AudioStreamPlayer3D (protocol)
 * @source scene/3d/audio_stream_player_3d.cpp:974
 */
export function godot_audio_stream_player_3d_mount(entity: Object3D): void {
  const spatial: Spatial = {
    unitSize: 10,
    maxDb: 3,
    maxDistance: 0,
    attenuationModel: ATTENUATION_INVERSE_DISTANCE,
    dopplerTracking: 0,
    panningStrength: 1,
    areaMask: 0,
    emissionAngleEnabled: false,
    emissionAngle: 45,
    emissionAngleFilterAttenuationDb: -12,
    attenuationFilterCutoffHz: 5000,
    attenuationFilterDb: -24,
    panner: null,
    filter: null,
    cut: null,
  };
  SPATIAL.set(entity, spatial);
  P.godot_audio_player_mount(entity, (audio, bus) => {
    if (spatial.panner === null || spatial.cut === null) {
      spatial.panner = audio.createPanner();
      spatial.panner.panningModel = 'equalpower';
      spatial.filter = audio.createBiquadFilter();
      spatial.filter.type = 'highshelf';
      spatial.cut = audio.createGain();
      spatial.panner.connect(spatial.filter).connect(spatial.cut).connect(godot_audio_bus_output(audio, bus));
    }
    pan(entity, spatial);
    return spatial.panner;
  });
  // Panned in the node's own internal physics processing (`NOTIFICATION_INTERNAL_PHYSICS_PROCESS`,
  // audio_stream_player_3d.cpp:281), which its component runs (`advances`).
  godot_node_set_internal_physics(entity, () => pan(entity, spatial));
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

/**
 * `set_volume_db(linear_to_db(volume))`.
 *
 * @godot AudioStreamPlayer3D.set_volume_linear
 * @source scene/3d/audio_stream_player_3d.cpp:616
 */
export function set_volume_linear(self: object, volume_linear: number): void {
  P.set_volume_linear(self, volume_linear);
}

/**
 * @godot AudioStreamPlayer3D.get_volume_linear
 * @source scene/3d/audio_stream_player_3d.cpp:620
 */
export function get_volume_linear(self: object): number {
  return P.get_volume_linear(self);
}

/**
 * While playing, the playbacks stop and one plays again from `to_position`.
 *
 * @godot AudioStreamPlayer3D.seek
 * @source scene/3d/audio_stream_player_3d.cpp:667
 */
export function seek(self: object, to_position: number): void {
  P.seek(self, to_position);
}

/**
 * @godot AudioStreamPlayer3D.set_stream_paused
 * @source scene/3d/audio_stream_player_3d.cpp:807
 */
export function set_stream_paused(self: object, pause: boolean): void {
  P.set_stream_paused(self, pause);
}

/**
 * @godot AudioStreamPlayer3D.get_stream_paused
 * @source scene/3d/audio_stream_player_3d.cpp:811
 */
export function get_stream_paused(self: object): boolean {
  return P.get_stream_paused(self);
}

/**
 * @godot AudioStreamPlayer3D.has_stream_playback
 * @source scene/3d/audio_stream_player_3d.cpp:815
 */
export function has_stream_playback(self: object): boolean {
  return P.has_stream_playback(self);
}

/**
 * Kept and read back, as on the plain player.
 *
 * @godot AudioStreamPlayer3D.set_playback_type
 * @source scene/3d/audio_stream_player_3d.cpp:844
 */
export function set_playback_type(self: object, playback_type: number): void {
  P.set_playback_type(self, playback_type);
}

/**
 * @godot AudioStreamPlayer3D.get_playback_type
 * @source scene/3d/audio_stream_player_3d.cpp:840
 */
export function get_playback_type(self: object): number {
  return P.get_playback_type(self);
}

/**
 * The physics layers of the Area3Ds that may divert the sound to their reverb bus; kept and read
 * back (buses are not bound).
 *
 * @godot AudioStreamPlayer3D.set_area_mask
 * @source scene/3d/audio_stream_player_3d.cpp:724
 */
export function set_area_mask(self: object, mask: number): void {
  spatialOf(self, 'set_area_mask').areaMask = mask >>> 0;
}

/**
 * @godot AudioStreamPlayer3D.get_area_mask
 * @source scene/3d/audio_stream_player_3d.cpp:728
 */
export function get_area_mask(self: object): number {
  return spatialOf(self, 'get_area_mask').areaMask;
}

/**
 * @godot AudioStreamPlayer3D.set_emission_angle_enabled
 * @source scene/3d/audio_stream_player_3d.cpp:732
 */
export function set_emission_angle_enabled(self: object, enabled: boolean): void {
  spatialOf(self, 'set_emission_angle_enabled').emissionAngleEnabled = Boolean(enabled);
}

/**
 * @godot AudioStreamPlayer3D.is_emission_angle_enabled
 * @source scene/3d/audio_stream_player_3d.cpp:737
 */
export function is_emission_angle_enabled(self: object): boolean {
  return spatialOf(self, 'is_emission_angle_enabled').emissionAngleEnabled;
}

/**
 * An angle outside `0..90` degrees fails.
 *
 * @godot AudioStreamPlayer3D.set_emission_angle
 * @source scene/3d/audio_stream_player_3d.cpp:741
 */
export function set_emission_angle(self: object, degrees: number): void {
  if (degrees < 0 || degrees > 90) return;
  spatialOf(self, 'set_emission_angle').emissionAngle = f32(degrees);
}

/**
 * @godot AudioStreamPlayer3D.get_emission_angle
 * @source scene/3d/audio_stream_player_3d.cpp:747
 */
export function get_emission_angle(self: object): number {
  return spatialOf(self, 'get_emission_angle').emissionAngle;
}

/**
 * @godot AudioStreamPlayer3D.set_emission_angle_filter_attenuation_db
 * @source scene/3d/audio_stream_player_3d.cpp:751
 */
export function set_emission_angle_filter_attenuation_db(self: object, db: number): void {
  spatialOf(self, 'set_emission_angle_filter_attenuation_db').emissionAngleFilterAttenuationDb = f32(db);
}

/**
 * @godot AudioStreamPlayer3D.get_emission_angle_filter_attenuation_db
 * @source scene/3d/audio_stream_player_3d.cpp:755
 */
export function get_emission_angle_filter_attenuation_db(self: object): number {
  return spatialOf(self, 'get_emission_angle_filter_attenuation_db').emissionAngleFilterAttenuationDb;
}

/**
 * @godot AudioStreamPlayer3D.set_attenuation_filter_cutoff_hz
 * @source scene/3d/audio_stream_player_3d.cpp:759
 */
export function set_attenuation_filter_cutoff_hz(self: object, hz: number): void {
  spatialOf(self, 'set_attenuation_filter_cutoff_hz').attenuationFilterCutoffHz = f32(hz);
}

/**
 * @godot AudioStreamPlayer3D.get_attenuation_filter_cutoff_hz
 * @source scene/3d/audio_stream_player_3d.cpp:763
 */
export function get_attenuation_filter_cutoff_hz(self: object): number {
  return spatialOf(self, 'get_attenuation_filter_cutoff_hz').attenuationFilterCutoffHz;
}

/**
 * @godot AudioStreamPlayer3D.set_attenuation_filter_db
 * @source scene/3d/audio_stream_player_3d.cpp:767
 */
export function set_attenuation_filter_db(self: object, db: number): void {
  spatialOf(self, 'set_attenuation_filter_db').attenuationFilterDb = f32(db);
}

/**
 * @godot AudioStreamPlayer3D.get_attenuation_filter_db
 * @source scene/3d/audio_stream_player_3d.cpp:771
 */
export function get_attenuation_filter_db(self: object): number {
  return spatialOf(self, 'get_attenuation_filter_db').attenuationFilterDb;
}

const AUDIO_STREAM_PLAYER_3D = {
  create: () => new Group(),
  classes: ['AudioStreamPlayer3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: godot_audio_stream_player_3d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...P.godot_audio_player_props({
      stream: (entity, value: object | null) => set_stream(entity, value),
      volumeDb: (entity, value: number) => set_volume_db(entity, value),
      pitchScale: (entity, value: number) => set_pitch_scale(entity, value),
      autoplay: (entity, value: boolean) => set_autoplay(entity, value),
      maxPolyphony: (entity, value: number) => set_max_polyphony(entity, value),
      bus: (entity, value: string) => set_bus(entity, value),
    }),
    ['attenuationModel', (entity, value: number) => set_attenuation_model(entity, value)],
    ['unitSize', (entity, value: number) => set_unit_size(entity, value)],
    ['maxDb', (entity, value: number) => set_max_db(entity, value)],
    ['maxDistance', (entity, value: number) => set_max_distance(entity, value)],
    ['panningStrength', (entity, value: number) => set_panning_strength(entity, value)],
    ['dopplerTracking', (entity, value: number) => set_doppler_tracking(entity, value)],
  ]),
};

/**
 * An AudioStreamPlayer3D as a scene writes it: `<GodotAudioStreamPlayer3D stream={jump} unitSize={4} />`,
 * its transform three's.
 *
 * @godot AudioStreamPlayer3D (protocol)
 * @source scene/3d/audio_stream_player_3d.cpp:936
 */
export function GodotAudioStreamPlayer3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(AUDIO_STREAM_PLAYER_3D, props);
}

/**
 * The player's `finished` signal, emitted when a playback ends (`audio-stream-player.ts`).
 *
 * @godot AudioStreamPlayer3D.finished
 * @source scene/3d/audio_stream_player_3d.cpp:916
 */
export function finished(self: object): GodotSignal<[]> {
  return P.finished(self);
}
