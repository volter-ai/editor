import * as THREE from 'three';
import { type AudioBusMixer, createAudioBusMixer } from '../audio/bus-mixer';
import { installAudioPoseGuard } from '../audio/pose-guard';

export interface AudioContext {
  listener: THREE.AudioListener;
  masterGain: GainNode;
  buses: {
    music: GainNode;
    sfx: GainNode;
    voice: GainNode;
  };
  /**
   * The named-bus mixer the three below are buses OF (`../audio/bus-mixer.ts`).
   *
   * `buses` is a fixed struct because those three names are the ones the engine
   * itself routes; a game with an `ambience`, a `ui` or a per-character bus asks
   * the mixer for it by name — `audio.mixer.bus('ambience', 'master')` mints it
   * under the master gain, `audio.mixer.setDb('ambience', -6)` sets it in
   * decibels — and `audio.mixer.disconnect()` is the ONE teardown for all of
   * them, the three struct members included.
   */
  mixer: AudioBusMixer;
  /** Call this on first user interaction (click/key) to resume audio context */
  resume: () => void;
}

/** The bus every other bus routes into, and the node `masterGain` is. */
const MASTER_BUS = 'master';

/**
 * Creates the audio listener and bus hierarchy.
 *
 * Bus routing: music/sfx/voice → master → destination
 * Attach `listener` to the active camera: `camera.add(audioCtx.listener)`.
 */
export function setupAudio(camera: THREE.Camera): AudioContext {
  installAudioPoseGuard();
  const listener = new THREE.AudioListener();
  camera.add(listener);

  const ctx = listener.context;
  const mixer = createAudioBusMixer({ context: ctx, destination: ctx.destination });
  const masterGain = mixer.bus(MASTER_BUS);

  // Route the Three.js listener through masterGain so that THREE.Audio /
  // THREE.PositionalAudio objects are also silenced by the mute button.
  listener.gain.disconnect();
  listener.gain.connect(masterGain);

  const musicGain = mixer.bus('music', MASTER_BUS);
  musicGain.gain.value = 0.7;

  const sfxGain = mixer.bus('sfx', MASTER_BUS);
  const voiceGain = mixer.bus('voice', MASTER_BUS);

  return {
    listener,
    masterGain,
    buses: {
      music: musicGain,
      sfx: sfxGain,
      voice: voiceGain,
    },
    mixer,
    resume() {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
    },
  };
}
