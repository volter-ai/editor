/**
 * WHAT A THREE WORLD CAN SHOW AT A TIME — the stage transport's subjects for
 * an ordinary three/R3F stage (WORK.md §The stage transport and the animation
 * door, Step 3).
 *
 * TWO DISCOVERIES, because a three world carries clips in two different
 * places and only one of them is the obvious one:
 *
 *  1. `object.animations` — what a GLTF's own `AnimationClip[]` lands in when
 *     something assigns it. A subject here owns a NEW `AnimationMixer` on that
 *     object, because nothing else is playing it.
 *  2. `liveMixerFor(object)` — the mixer the world's OWN code made for it
 *     (`new THREE.AnimationMixer(…)`, drei's `useAnimations`), found through
 *     the served animation stamp (`@volter/editor-threejs/animation/live-mixers`).
 *     A subject here drives THAT mixer; minting a second mixer over the same
 *     object would give one skeleton two writers.
 *
 * DISCOVERY 2 IS NOT OPTIONAL, and this is the measurement that says so:
 * three's `GLTFLoader` never assigns `scene.animations`, so an R3F character
 * loaded with `useGLTF` has an EMPTY `animations` array on its Object3D. A
 * scan that looked only at `animations` would find nothing on exactly the
 * worlds a person most wants to scrub.
 *
 * THE MIXER IS THREE'S OWN and every call here is three's own API — this is a
 * subject over `AnimationMixer`, never a wrapper around it. `setTime` is the
 * one write; the transport owns the position.
 */
import { liveMixerFor } from '@volter/editor-threejs/animation/live-mixers';
import * as THREE from 'three';
import type { StageTransport } from './stage-transport';

/** The display rate a three clip is shown at. Three clips carry a duration in
 *  SECONDS and no rate of their own, so the transport needs one to convert a
 *  frame for a look that asks in frames. 30 is three's own editor convention
 *  (`AnimationClip.CreateFromMorphTargetSequence` defaults to it). */
const THREE_DISPLAY_FPS = 30;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * A subject over an object's OWN clips, on a mixer this subject mints and
 * owns. `setClip` swaps which clip is showing: the chosen action is played
 * PAUSED (so it poses the skeleton without advancing itself) and every other
 * action is stopped, because the transport — not the action — is what moves.
 */
function attachOwnClips(object: THREE.Object3D, transport: StageTransport): (() => void) | null {
  const clips = object.animations;
  if (clips.length === 0) return null;
  const mixer = new THREE.AnimationMixer(object);
  let current = clips[0];
  if (!current) return null;

  const show = (clip: THREE.AnimationClip): void => {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.paused = true;
    action.play();
    current = clip;
  };
  show(current);

  const detach = transport.attach({
    id: object.uuid,
    label: object.name || current.name || 'Clip',
    range: () => ({ start: 0, end: current?.duration ?? 0, fps: THREE_DISPLAY_FPS }),
    seek: (seconds) => {
      mixer.setTime(clamp(seconds, 0, current?.duration ?? 0));
    },
    clips: () => clips.map((clip) => ({ id: clip.name, label: clip.name })),
    setClip: (id) => {
      const next = clips.find((clip) => clip.name === id);
      if (next) show(next);
    },
  });

  return () => {
    detach();
    mixer.stopAllAction();
    mixer.uncacheRoot(object);
  };
}

/**
 * A subject over a mixer the world's own code made. It drives that mixer and
 * never mints one; `clips` are the ones the world has played through it.
 */
function attachInspected(object: THREE.Object3D, transport: StageTransport): (() => void) | null {
  const inspection = liveMixerFor(object);
  if (!inspection) return null;
  const entries = [...inspection.clips.entries()];
  let current = entries[0]?.[1];
  if (!current) return null;

  const show = (clip: THREE.AnimationClip): void => {
    inspection.mixer.stopAllAction();
    const action = inspection.mixer.clipAction(clip);
    action.paused = true;
    action.play();
    current = clip;
  };

  const detach = transport.attach({
    id: object.uuid,
    label: object.name || current.name || 'Animation',
    range: () => ({ start: 0, end: current?.duration ?? 0, fps: THREE_DISPLAY_FPS }),
    seek: (seconds) => {
      inspection.mixer.setTime(clamp(seconds, 0, current?.duration ?? 0));
    },
    clips: () => entries.map(([name, clip]) => ({ id: name, label: clip.name || name })),
    setClip: (id) => {
      const next = inspection.clips.get(id);
      if (next) show(next);
    },
  });

  // Deliberately NOT stopping the mixer's actions on detach: this subject
  // borrowed a mixer the world owns, and a borrower does not decide what the
  // owner is playing when it leaves.
  return detach;
}

/**
 * One scan of a mounted root, and the handle that keeps it current.
 *
 * `refresh()` DIFFS by object uuid rather than re-attaching: a rescan of an
 * unchanged tree must not detach and re-attach every subject, because that
 * would reset which clip each one is showing under a person's hands. The
 * caller decides when to rescan (the stage host throttles it and skips it
 * while the world is driving time).
 */
export interface ClipSubjectScan {
  refresh(): void;
  dispose(): void;
}

export function scanClipSubjects(root: THREE.Object3D, transport: StageTransport): ClipSubjectScan {
  const attached = new Map<string, () => void>();

  const refresh = (): void => {
    const seen = new Set<string>();
    root.traverse((object) => {
      if (attached.has(object.uuid)) {
        seen.add(object.uuid);
        return;
      }
      // The inspection wins when an object has both: it means a world binding
      // is already driving that skeleton, and a second mixer over it would
      // give one object two writers.
      const detach = attachInspected(object, transport) ?? attachOwnClips(object, transport);
      if (!detach) return;
      attached.set(object.uuid, detach);
      seen.add(object.uuid);
    });
    for (const [uuid, detach] of [...attached]) {
      if (seen.has(uuid)) continue;
      detach();
      attached.delete(uuid);
    }
  };

  refresh();

  return {
    refresh,
    dispose: () => {
      for (const detach of attached.values()) detach();
      attached.clear();
    },
  };
}
