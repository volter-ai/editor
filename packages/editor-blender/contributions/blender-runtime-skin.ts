/**
 * THE SKIN AND THE CLIP — three.js PLAYS Blender's animation; Blender holds it
 * as DATA (owner rule, 2026-09-20: "we visualize with three.js, not Blender").
 *
 * ## Why this exists at all
 *
 * The obvious Timeline asks Blender for frame N, lets the depsgraph evaluate
 * it and re-exports the mesh columns. That is the wrong architecture: it puts
 * a WASM depsgraph evaluation and a full geometry round trip between the
 * person's pointer and the picture, and it moves `scene.frame_current` sixty
 * times a second under every bpy reader in the session. So the skin travels in the
 * frame itself: the export door ships each Armature-deformed mesh's weights per
 * exported vertex (`bpy_web_export.cc` `write_skin`), the frame names every bone's
 * pose, and the presenter builds the `THREE.SkinnedMesh`es and their skeletons
 * (`blender-runtime-skeleton.ts`). This director only plays the assigned action on
 * those bones with an `AnimationMixer`: every scrub and every played frame costs
 * ZERO calls into Blender, and the clip is baked again exactly when the frame says
 * its action's revision moved.
 *
 * ## The bind pose is the EXPORT pose, and that is the whole trick
 *
 * The export door runs with `evaluate: True`, so the columns the presenter
 * holds are the mesh ALREADY DEFORMED at whatever frame Blender sits on. Bind
 * a skeleton whose bones are in that same pose and the skinning is an identity
 * there — `skinMatrix = Σ wᵢ·Bᵢ·Bᵢ⁻¹ = I` — so the picture at the bind frame is
 * byte-for-byte the frame Blender presented, and every other frame is three's
 * own evaluation of the same skin over the same columns. Nothing has to move
 * Blender's frame, ever.
 *
 * ## What that costs, stated rather than implied
 *
 * While a clip plays, the picture is three.js's skinning of the EXPORT-FRAME
 * mesh. Anything else Blender's depsgraph would do per frame — shape keys, a
 * Displace or Cast or Cloth modifier reading the frame, a driver on geometry —
 * does NOT follow the mixer. The Timeline's status line names any such
 * modifier on the played object rather than showing a confident picture of the
 * wrong thing (`modifiersNotPlayed`). A bone whose pose is a CONSTRAINT's
 * rather than its channels' is named the same way, because the clip is derived
 * from the F-Curves alone.
 */

import type { BlenderActionClip } from '@volter/blender-engine/browser/rna';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { StageTransportHandle } from '@volter/editor-sdk/host';
import * as THREE from 'three';
import { blenderRnaSet } from '../host/blender-runtime-host';

/** Base64 → the typed array it holds. The same three lines every payload in
 *  this package decodes with (`blender-uv-geometry.ts`'s `uvBytes`); kept
 *  local because this module is in the presenter's closure and that one is in
 *  the UV view's. */
function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function float32Of(base64: string): Float32Array {
  const bytes = bytesOf(base64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}
/**
 * A BLENDER ACTION'S BAKED TRACKS as three.js keyframe tracks over `bones` (by Blender's bone
 * name), addressed by bone UUID because three's track-name grammar splits on `.` and `hand.L`
 * is an ordinary bone name. A track for a bone this binding lacks is named in `warnings`.
 */
export function clipTracks(clip: BlenderActionClip, bones: ReadonlyMap<string, THREE.Bone>, warnings: string[]): THREE.KeyframeTrack[] {
  const tracks: THREE.KeyframeTrack[] = [];
  const missing = new Set<string>();
  for (const track of clip.tracks) {
    const bone = bones.get(track.bone);
    if (!bone) {
      missing.add(track.bone);
      continue;
    }
    const times = float32Of(track.timeBase64);
    const values = float32Of(track.valueBase64);
    const path = `${bone.uuid}.${track.property}`;
    tracks.push(
      track.property === 'quaternion'
        ? new THREE.QuaternionKeyframeTrack(path, Array.from(times), Array.from(values))
        : new THREE.VectorKeyframeTrack(path, Array.from(times), Array.from(values)),
    );
  }
  if (missing.size) warnings.push(`${clip.action} animates ${[...missing].join(', ')}, which this binding has no bone for.`);
  return tracks;
}

/**
 * THE ONE DIRECTOR, module-scoped for the reason `BlenderRuntimeView` itself
 * is (`blender-runtime.document.tsx`): the Python session outlives workspace
 * switches and document remounts, so the skeleton it bound must too. The
 * Timeline document reads and drives this exact instance; there is no second
 * copy of the playback state anywhere.
 */
export class BlenderSkinDirector {
  /** The presented view whose skeletons the clip plays on (`sync`). */
  #view: BlenderRuntimeView | null = null;
  /** The armature the clip plays on, and what the clip was read for: armature, action, the
   *  action's revision, the scene's clock and frame. Read again only when this changes. */
  #armature: string | null = null;
  #clipKey: string | null = null;
  #mixer: THREE.AnimationMixer | null = null;
  #action: THREE.AnimationAction | null = null;
  #clip: BlenderActionClip | null = null;
  /** The frame the last SEEK asked for — see {@link frame}. */
  #seeked: number | null = null;
  /** The stage transport this skin is attached to, or null before `attachTo`.
   *  The Timeline look drives THIS (Step 7); the skin holds no clock. */
  #transport: StageTransportHandle | null = null;
  #detach: (() => void) | null = null;
  #listeners = new Set<() => void>();
  #version = 0;
  #warnings: string[] = [];
  /** Engine calls this director has made, counted so a walk can prove that a
   *  scrub costs none (the acceptance the owner named). */
  #engineCalls = 0;

  get version(): number {
    return this.#version;
  }

  get engineCalls(): number {
    return this.#engineCalls;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish(): void {
    this.#version++;
    for (const listener of [...this.#listeners]) listener();
  }

  /** The clip's own facts plus the mixer's live time, expressed in BLENDER
   *  FRAMES — which is the only number the Timeline draws, and the only one a
   *  person or an agent ever names. */
  state(): {
    frame: number;
    start: number;
    end: number;
    fps: number;
    action: string | null;
    object: string | null;
    armature: string | null;
    bones: number;
    keyframes: readonly { frame: number; type: string; select: boolean }[];
    /** Every animated object's own columns plus its SELECTION — what the
     *  summary row's `show_only_selected` filter chooses between. The mixer
     *  never reads it: what plays is the bound action, filter or no filter,
     *  exactly as in Blender. */
    summary: readonly {
      object: string;
      action: string;
      selected: boolean;
      keyframes: readonly { frame: number; type: string; select: boolean }[];
    }[];
    clipStart: number | null;
    clipEnd: number | null;
    tracks: number;
    bound: readonly string[];
    warnings: readonly string[];
    engineCalls: number;
    /** BLENDER'S OWN `scene.frame_current`, as the clip door last read it —
     *  which is a different number from `frame` on purpose. `frame` is where
     *  the person is looking (the mixer's); this is where bpy and the
     *  Properties rail are. They agree after a pause or a scrub-end, and they
     *  are deliberately allowed to differ in between. */
    blenderFrame: number | null;
  } {
    const clip = this.#clip;
    const start = clip?.frameStart ?? 1;
    const end = clip?.frameEnd ?? 250;
    const fps = clip?.fps ?? 24;
    return {
      frame: this.frame(),
      start,
      end,
      fps,
      action: clip?.action ?? null,
      object: clip?.object ?? null,
      armature: clip?.armature ?? null,
      bones: this.#armature ? this.#view?.skeletons.rig(this.#armature)?.bones.size ?? 0 : 0,
      keyframes: clip?.keyframes ?? [],
      summary: clip?.summary ?? [],
      clipStart: clip?.clipStart ?? null,
      clipEnd: clip?.clipEnd ?? null,
      tracks: clip?.tracks.length ?? 0,
      // The armature the clip plays on, when the presenter holds its skeleton.
      bound: this.#armature && this.#view?.skeletons.rig(this.#armature) ? [this.#armature] : [],
      warnings: this.#warnings,
      engineCalls: this.#engineCalls,
      blenderFrame: clip?.frameCurrent ?? null,
    };
  }

  /** The frame on screen, or null before the clip door has been read (when `frame()` can only
   *  say 1). */
  playhead(): number | null {
    return this.#clip ? this.frame() : null;
  }

  /** The mixer's time as a Blender frame. With no clip the scene's own current
   *  frame stands, which is Blender's answer for a file with no animation. */
  frame(): number {
    const clip = this.#clip;
    if (this.#seeked !== null) return this.#seeked;
    if (!clip || !this.#action || clip.clipStart === undefined) return clip?.frameCurrent ?? 1;
    // A SEEK'S OWN ANSWER, while one is standing. `LoopRepeat` wraps
    // `action.time` into `[0, duration)`, so a seek to the LAST frame lands on
    // `time === duration` and reads back as the FIRST — measured on the first
    // walk, where `jump-end` answered frame 1 over a frame-48 pose. The
    // wrapping is right for playback and wrong for a question, so a standing
    // seek answers with the frame it was given and the play tick clears it.
    // THE ACTION'S TIME, NOT THE MIXER'S, and the difference is the whole of
    // looping: `AnimationMixer.time` is monotonic and never wraps, while
    // `AnimationAction.time` is wrapped into `[0, duration]` by `LoopRepeat`.
    // Measured on the first walk: two seconds of playback over a 47-frame clip
    // read as frame 63.5 off the mixer, where the picture was correctly back
    // near the start.
    return clip.clipStart + this.#action.time * clip.fps;
  }

  /** Blender's scene clock exists even when the scene has no action. */
  get playable(): boolean {
    return this.#clip !== null && this.#transport !== null;
  }

  // ------------------------------------------------------------ the frame

  /**
   * FOLLOW THE PRESENTED FRAME. The armature played is the active object's (itself, or the one its
   * skin is bound to), else the one armature that has an action. Its assigned action is read
   * through the clip door when the frame says something about it moved: another armature or
   * action, the action's revision, the scene's clock, or Blender's own frame. Otherwise this costs
   * nothing, which is what lets the model call it after every present.
   */
  async sync(view: BlenderRuntimeView, read: { clip(armature: string): Promise<BlenderActionClip | null> }): Promise<void> {
    this.#view = view;
    const facts = view.animationFacts();
    const names = Object.keys(facts.armatures);
    const active = facts.active;
    const armature = active && facts.armatures[active] ? active
      : (active ? facts.skinArmature(active) : null)
        ?? (names.filter((name) => facts.armatures[name]!.action).length === 1
          ? names.find((name) => facts.armatures[name]!.action)! : null);
    const action = armature ? facts.armatures[armature]?.action ?? null : null;
    const key = JSON.stringify([armature, action, action ? facts.actions[action] ?? null : null, facts.clock, facts.frame,
      armature ? view.skeletons.rig(armature) !== null : false]);
    if (key === this.#clipKey && (!armature || this.#rig() === view.skeletons.rig(armature))) return;
    this.#clipKey = key;
    if (this.#armature && this.#armature !== armature) view.skeletons.restorePose(this.#armature);
    this.#armature = armature;
    this.#boundRig = armature ? view.skeletons.rig(armature) : null;
    const warnings: string[] = [];
    let clip: BlenderActionClip | null = null;
    if (armature) {
      this.#engineCalls++;
      clip = await read.clip(armature);
    }
    const previous = this.#clip;
    const rangeChanged = clip?.frameStart !== previous?.frameStart ||
      clip?.frameEnd !== previous?.frameEnd || clip?.fps !== previous?.fps;
    this.#clip = clip ?? null;
    if (!clip || clip.scene !== previous?.scene) this.#seeked = null;
    if (clip?.reason) warnings.push(clip.reason);
    if (clip) this.#loadClip(clip, warnings);
    else {
      this.#mixer?.stopAllAction();
      this.#mixer = null;
      this.#action = null;
    }
    const activeSubject = this.#transport?.snapshot().activeSubject;
    if (rangeChanged && activeSubject) this.#transport?.setActiveSubject(activeSubject);
    const playing = this.#transport?.snapshot().playbackState === 'playing';
    if (clip && !playing) {
      this.#seek(clip.frameCurrent);
      if (this.#transport && clip.fps > 0) this.#transport.seek(clip.frameCurrent / clip.fps);
    }
    this.#warnings = warnings;
    this.#publish();
  }

  /** The rig the clip was loaded over: a rebuilt rig (new bones) needs the clip loaded again. */
  #boundRig: object | null = null;
  #rig(): object | null {
    return this.#boundRig;
  }

  #loadClip(clip: BlenderActionClip, warnings: string[]): void {
    this.#mixer?.stopAllAction();
    this.#mixer = null;
    this.#action = null;
    if (!clip.tracks.length || clip.clipStart === undefined || clip.clipEnd === undefined) return;
    const rig = clip.armature ? this.#view?.skeletons.rig(clip.armature) : null;
    if (!rig) return;
    const armature = rig.object;
    const byName = rig.bones;
    const tracks = clipTracks(clip, byName, warnings);
    if (!tracks.length) return;
    const duration = clip.duration ?? (clip.clipEnd - clip.clipStart) / clip.fps;
    const mixer = new THREE.AnimationMixer(armature);
    const action = mixer.clipAction(
      new THREE.AnimationClip(clip.action ?? 'action', duration, tracks),
    );
    action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    action.play();
    this.#mixer = mixer;
    this.#action = action;
    // THE FRESH MIXER STARTS AT BLENDER'S OWN FRAME, not at zero, and that is
    // the invariant this whole design rests on: the mesh columns were exported
    // at `frameCurrent` and the skeleton was bound in that pose, so seeking
    // anywhere else would make the first picture after a re-bind disagree with
    // the geometry underneath it. Measured on the first walk: a pause wrote
    // frame 16, the write presented, the present re-exported the mesh at 16
    // and re-bound — and `setTime(0)` snapped the playhead back to frame 1
    // over a frame-16 mesh.
    this.#seek(clip.frameCurrent);
    this.#refresh();
  }

  // ------------------------------------------------------------ the playback

  #seek(frame: number): void {
    const clip = this.#clip;
    if (!clip) return;
    const clamped = Math.min(clip.frameEnd, Math.max(clip.frameStart, frame));
    this.#seeked = clamped;
    // An action supplies a pose at this scene time; it does not own whether
    // the scene clock can move. Empty/static scenes still play and scrub.
    if (!this.#mixer || clip.clipStart === undefined || clip.clipEnd === undefined) return;
    // The TIME is nudged inside the clip so the last frame evaluates as the
    // last frame rather than wrapping to the first; the number REPORTED is the
    // one asked for (see `frame`).
    const duration = (clip.clipEnd - clip.clipStart) / clip.fps;
    this.#mixer.setTime(Math.max(0, Math.min(duration - 1e-4, (clamped - clip.clipStart) / clip.fps)));
    this.#refresh();
  }

  /** The bones moved; make the world matrices agree before the stage's next
   *  render reads them. A `Bone` keeps `matrixAutoUpdate`, so this is a forced
   *  pass over a handful of nodes rather than a recomposition of the scene. */
  #refresh(): void {
    const rig = this.#armature ? this.#view?.skeletons.rig(this.#armature) : null;
    rig?.object.updateMatrixWorld(true);
  }

  /** The scene's name, for the one address the Timeline writes to. */
  get scene(): string | null {
    return this.#clip?.scene ?? null;
  }

  /** Hand Blender back the frame the person is looking at — THE BOOKMARK.
   *
   *  ONCE, HERE — never per played frame. `scene.frame_current` is what every
   *  bpy reader and the whole Properties rail agree with, so leaving it behind
   *  while the picture moved would be the Timeline lying to the rest of the
   *  session; writing it sixty times a second would be the architecture this
   *  module exists to avoid. The transport's `onSettled` is what calls this —
   *  a pause, or the quiet at the end of a scrub — so a slider drag writes
   *  once. Moved verbatim from the Timeline look, which is no longer where a
   *  playhead write belongs. */
  async writeBookmark(): Promise<number> {
    const frame = Math.round(this.frame());
    const clip = this.#clip;
    if (!clip) return frame;
    const scene = clip.scene;
    if (!scene || clip.frameCurrent === frame) return frame;
    this.#engineCalls++;
    // `rna_set` refuses `bpy.context.scene` — the scene must be addressed by
    // name through `bpy.data.scenes[...]`.
    // Timeline navigation, like selection, must not erase an available redo.
    await blenderRnaSet(`bpy.data.scenes[${JSON.stringify(scene)}]`, 'frame_current', frame, undefined, false);
    this.#clip = { ...clip, frameCurrent: frame };
    this.#publish();
    return frame;
  }

  /** The handle this skin was attached to, for the Timeline look to drive.
   *  Published through the existing `subscribe`/`version`. */
  get transport(): StageTransportHandle | null {
    return this.#transport;
  }

  /**
   * ATTACH THIS SKIN TO A STAGE'S TRANSPORT — the Model document calls it with
   * its own document id's handle, because that document is the one that HAS
   * the id (the Timeline binds to this singleton and cannot name one).
   *
   * The subject is the action: Blender has no several-clips-per-subject
   * question, so `clips`/`setClip` are deliberately absent. Seconds are the
   * seam; the frames↔seconds conversion is this file's edge and the look's,
   * and nowhere in between.
   */
  attachTo(transport: StageTransportHandle): () => void {
    this.#detach?.();
    this.#transport = transport;
    const detachSubject = transport.attach({
      id: this.#clip?.action ?? 'blender-action',
      label: this.#clip?.action ?? 'Action',
      range: () => {
        const clip = this.#clip;
        const fps = clip?.fps || 24;
        return {
          start: (clip?.frameStart ?? 1) / fps,
          end: (clip?.frameEnd ?? 250) / fps,
          fps,
        };
      },
      seek: (seconds) => this.seekSeconds(seconds),
    });
    const stopSettled = transport.onSettled(() => {
      void this.writeBookmark();
    });
    let released = false;
    const detach = () => {
      if (released) return;
      released = true;
      stopSettled();
      detachSubject();
      if (this.#detach === detach) {
        if (this.#transport === transport) this.#transport = null;
        this.#detach = null;
      }
    };
    this.#detach = detach;
    // The bookmark READ, if the clip is already loaded when we attach.
    const clip = this.#clip;
    if (clip && clip.fps > 0) transport.seek(clip.frameCurrent / clip.fps);
    return detach;
  }

  /** The transport's one write, in ITS unit. Frames are Blender's; seconds are
   *  the seam's; this is the single conversion on this side. */
  seekSeconds(seconds: number): void {
    const fps = this.#clip?.fps || 24;
    this.#seek(Math.round(seconds * fps));
    this.#publish();
  }

  /** The frames the summary row draws a diamond at, sorted. */
  keyframes(): readonly number[] {
    return (this.#clip?.keyframes ?? []).map((column) => column.frame);
  }

  dispose(): void {
    this.#detach?.();
    this.#mixer?.stopAllAction();
    this.#mixer = null;
    this.#action = null;
    this.#clip = null;
    this.#seeked = null;
    if (this.#armature) this.#view?.skeletons.restorePose(this.#armature);
    this.#armature = null;
    this.#clipKey = null;
  }
}

/** THE ONE DIRECTOR — see the class comment for why it is module-scoped. */
export const blenderSkin = new BlenderSkinDirector();

/** STABLE FUNCTION IDENTITIES for `useSyncExternalStore`, and they are not
 *  ceremony: passing `blenderSkin.subscribe.bind(blenderSkin)` inline mints a
 *  NEW subscribe and a NEW getSnapshot on every render, so React tears the
 *  subscription down and rebuilds it each time — measured on the Timeline's
 *  first walk, where the view bound its rig and its published `drawn` never
 *  moved again because no re-render ever arrived. */
export function subscribeBlenderSkin(listener: () => void): () => void {
  return blenderSkin.subscribe(listener);
}
export function blenderSkinVersion(): number {
  return blenderSkin.version;
}
