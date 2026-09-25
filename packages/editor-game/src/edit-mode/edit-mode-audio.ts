/**
 * Project-lifetime audio for the editor authoring session.
 *
 * Edit mode uses the same first-party Three/Web Audio graph and AudioAdapter
 * implementation as play mode. The mounted game's adapter temporarily wins
 * while Play is active; on Stop, `getActiveAudio()` falls back to this graph.
 *
 * It lives in `@volter/editor-game` because it IS the engine's audio runtime — the
 * mixer, the bus graph and the pose guard behind `@volter/game-runtime/setup/setup-audio` —
 * and the host was installing all of it at boot for every project, including a
 * models project that plays nothing and has no sound (WORK.md §The open-source
 * launch, phase 1 unit 7). The one host surface that reads it, the header
 * meter, already answers "Audio unavailable" when no adapter is installed, and
 * the panel that inspects it (`audio.utility`) has been this package's since
 * unit 2. Same shape as `edit-mode-networking.ts` beside it.
 */

import { setEditModeAudio } from '@volter/editor-sdk/kit/authoring/active-systems';
import {
  createAudioSystemAdapter,
  releaseAudioMeters,
} from '@volter/game-runtime/adapter/first-party-audio-system';
import { setupAudio } from '@volter/game-runtime/setup/setup-audio';
import * as THREE from 'three';

export function installEditModeAudio(camera: THREE.Camera = new THREE.Camera()): () => void {
  const audio = setupAudio(camera);
  const adapter = createAudioSystemAdapter(audio);
  let disposed = false;

  setEditModeAudio(adapter);

  // No Tone here, deliberately. This used to `import('@volter/game-runtime/audio/audio-
  // introspection')` unconditionally, which loaded the whole `tone` package on
  // EVERY editor boot to draw a meter — and the editor has no score of its
  // own to report a transport for. The graph and meters the Audio panel
  // actually shows in edit mode are the base adapter's (535d248dc), and the
  // Tone half now lives in the `music` capability, attached by a game that
  // uses it.

  return () => {
    if (disposed) return;
    disposed = true;
    releaseAudioMeters(adapter);
    setEditModeAudio(null);

    // Do not suspend the shared native AudioContext: a concurrently starting
    // play session can own it. Disconnect only this authoring graph — the
    // mixer's own teardown covers every bus it minted (master, music, sfx,
    // voice, and anything a project asked it for by name), so this cannot go
    // stale the way four hardcoded bus names would.
    audio.listener.gain.disconnect();
    audio.mixer.disconnect();
    camera.remove(audio.listener);
  };
}
