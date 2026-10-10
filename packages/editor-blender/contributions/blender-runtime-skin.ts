/**
 * THE TIMELINE'S ANIMATION — three.js PLAYS Blender's animation; Blender holds it
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
 * rest, channels, constraints and pose and each armature's NLA stack, and the presenter
 * builds the skeletons (`blender-runtime-skeleton.ts`). This director poses EVERY armature
 * at the scene frame on three.js's own `AnimationMixer` (`blender-mixer-pose.ts`): each action
 * sampled once by Blender, its NLA tracks and active action placed as Blender places them
 * (`blender-pose.ts`) and blended by the mixer, and its Damped Track constraints. Every scrub
 * and every played frame costs ZERO calls into Blender; an action is baked again exactly when
 * the frame says its revision moved.
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
 * ## The fidelity check, and what is not played
 *
 * At Blender's own frame, standing still, the picture IS Blender's pose (the frame's), and the
 * mixer's answer for that frame is compared with it bone by bone (`poseDivergence`). A bone
 * further off than a degree is said in the console with what would explain it, so a difference
 * between this Timeline (and a game, which plays the same clips) and Blender is never silent. What the evaluator does not play — a constraint other than Damped Track, a
 * driver, non-default parenting — is named once as well. Anything Blender's depsgraph does to
 * GEOMETRY per frame (shape keys, a Displace or Cloth modifier) does not follow the bones.
 */

import type { BlenderActionClip, BlenderSceneMovie } from '@volter/blender-engine/browser/rna';
import type { BlenderArmature } from '@volter/blender-engine/browser/three/blender-runtime-armature';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import { editorHost, type StageTransportHandle } from '@volter/sdk/host';
import { blenderRnaSet } from '../host/blender-runtime-host';
import { actionLayer, nlaLayers, type PoseLayer } from './blender-pose';
import { MixerPose, mixerClip, poseDivergence, type MixerClip } from './blender-mixer-pose';
import { playMovie, type PlayMovie } from './blender-play-movie';
import { invalidateStages } from '@volter/sdk/kit/stage-invalidation';

/** How the director reads the engine: the Timeline's subject (its keys, the scene's range) and
 *  one action baked for one armature. */
export interface SkinReader {
  /** The scene's clock and range, and `armature`'s action when there is one (null: the scene alone). */
  clip(armature: string | null): Promise<BlenderActionClip | null>;
  bake(armature: string, action: string): Promise<BlenderActionClip | null>;
  /** The scene's movie: every animated object and camera sampled at every scene frame, and the
   *  markers' camera cuts (`rna_scene_movie`, as a game's cutscene reads it). */
  movie?(): Promise<BlenderSceneMovie | null>;
}

/** An armature's layers at a scene frame: its NLA, then its active action over them. */
export function sceneLayers(armature: BlenderArmature, frame: number,
  clips: (action: string) => MixerClip | null | undefined): { layers: PoseLayer[]; waiting: boolean; skipped: string[] } {
  const stack = nlaLayers(armature.animation, frame, clips);
  const action = armature.action ?? null;
  if (action) {
    const clip = clips(action);
    if (clip === undefined) stack.waiting = true;
    const layer = clip ? actionLayer(armature.animation, clip, frame, stack.evaluated) : null;
    if (layer) stack.layers.push(layer);
  }
  return stack;
}

/** What to do about what plays only in Blender, by kind. */
export function remedy(unsupported: readonly string[]): string {
  const out: string[] = [];
  if (unsupported.some((thing) => thing.includes(' constraint ') || thing.includes('drivers')))
    out.push('Bake a constraint or driver into the action (Pose ▸ Animation ▸ Bake Action, Visual Keying), or aim with a Damped Track.');
  if (unsupported.some((thing) => thing.includes('curves on ')))
    out.push("Key the motion on a bone (the root bone) instead of the armature object, or move the object from the game.");
  if (unsupported.some((thing) => thing.includes('interpolation') || thing.includes(' modifier')))
    out.push('Use Bezier, Linear or Constant keys and the Cycles modifier only, or bake the curves (Key ▸ Bake Keyframes).');
  return out.length ? ` ${out.join(' ')}` : '';
}

/** True when an armature has anything to evaluate: an action, or NLA strips. */
export function animated(armature: BlenderArmature): boolean {
  return !!armature.action || !!armature.animation?.tracks.some((track) => track.strips.length);
}

/**
 * THE ONE DIRECTOR, module-scoped for the reason `BlenderRuntimeView` itself
 * is (`blender-runtime.document.tsx`): the Python session outlives workspace
 * switches and document remounts, so the skeleton it bound must too. The
 * Timeline document reads and drives this exact instance; there is no second
 * copy of the playback state anywhere.
 */
export class BlenderSkinDirector {
  /** The presented view whose skeletons are posed (`sync`). */
  #view: BlenderRuntimeView | null = null;
  #reader: SkinReader | null = null;
  /** THE SCENE'S MOVIE on the document's view (`docs/SCENE-ANIMATION.md`, step 2): its objects and
   *  cameras posed at every Timeline frame beside the armatures, and its camera cuts. */
  #movie: PlayMovie | null = null;
  #movieKey: string | null = null;
  #moviePosed: number | null = null;
  /** The Timeline's subject: the armature its keys and header describe, and what its header was
   *  read for. Read again only when that changes. */
  #armature: string | null = null;
  #clipKey: string | null = null;
  #clip: BlenderActionClip | null = null;
  /** Each posed armature's evaluator, and every action baked for it, at the revision baked. */
  #poses = new Map<string, MixerPose>();
  #baked = new Map<string, { revision: number | null; clip: MixerClip | null | undefined }>();
  /** The frame the last SEEK asked for — see {@link frame}. */
  #seeked: number | null = null;
  /** The stage transport this skin is attached to, or null before `attachTo`.
   *  The Timeline look drives THIS (Step 7); the skin holds no clock. */
  #transport: StageTransportHandle | null = null;
  #detach: (() => void) | null = null;
  #listeners = new Set<() => void>();
  #version = 0;
  #warnings: string[] = [];
  /** What was already said in the console, so each finding is said once. */
  #said = new Set<string>();
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

  /** The subject's facts plus the playhead, expressed in BLENDER FRAMES — which is the only
   *  number the Timeline draws, and the only one a person or an agent ever names. */
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
     *  summary row's `show_only_selected` filter chooses between. What plays
     *  is every armature's stack, filter or no filter, exactly as in Blender. */
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
     *  the person is looking; this is where bpy and the Properties rail are.
     *  They agree after a pause or a scrub-end, and they are deliberately
     *  allowed to differ in between. */
    blenderFrame: number | null;
    /** The scene's movie on the Timeline: how many objects it moves, the camera it cuts to now, the
     *  frame it last posed (null: posed by Blender, standing at its own frame), and the camera the
     *  camera view looks through. */
    movie: { objects: number; camera: string | null; posed: number | null; viewCamera: string | null } | null;
  } {
    const clip = this.#clip;
    return {
      frame: this.frame(),
      start: clip?.frameStart ?? 1,
      end: clip?.frameEnd ?? 250,
      fps: clip?.fps ?? 24,
      action: clip?.action ?? null,
      object: clip?.object ?? null,
      armature: clip?.armature ?? null,
      bones: this.#armature ? this.#view?.skeletons.rig(this.#armature)?.bones.size ?? 0 : 0,
      keyframes: clip?.keyframes ?? [],
      summary: clip?.summary ?? [],
      clipStart: clip?.clipStart ?? null,
      clipEnd: clip?.clipEnd ?? null,
      tracks: clip?.tracks.length ?? 0,
      bound: [...this.#poses.keys()],
      warnings: this.#warnings,
      engineCalls: this.#engineCalls,
      blenderFrame: clip?.frameCurrent ?? null,
      movie: this.#movie ? { objects: this.#movie.objects.length, camera: this.#moviePosed === null ? null : this.#movie.cameraAt(this.#moviePosed), posed: this.#moviePosed, viewCamera: this.#view?.cameraViewCamera() ?? null } : null,
    };
  }

  /** The frame on screen, or null before the clip door has been read (when `frame()` can only
   *  say 1). */
  playhead(): number | null {
    return this.#clip ? this.frame() : null;
  }

  /** The frame on screen: the last seek's, else Blender's own. */
  frame(): number {
    return this.#seeked ?? this.#clip?.frameCurrent ?? 1;
  }

  /** Blender's scene clock exists even when the scene has no action. */
  get playable(): boolean {
    return this.#clip !== null && this.#transport !== null;
  }

  // ------------------------------------------------------------ the frame

  /**
   * FOLLOW THE PRESENTED FRAME. Every armature the frame names is posed; the Timeline's subject is
   * the active object's armature (itself, or the one its skin is bound to), else the one armature
   * that has an action, and its header is read through the clip door when the frame says
   * something about it moved. Actions are baked once per revision, the first time a frame needs
   * them. Otherwise this costs nothing, which is what lets the model call it after every present.
   */
  async sync(view: BlenderRuntimeView, read: SkinReader): Promise<void> {
    this.#view = view;
    this.#reader = read;
    const facts = view.animationFacts();
    const names = Object.keys(facts.armatures);
    const active = facts.active;
    const armature = active && facts.armatures[active] ? active
      : (active ? facts.skinArmature(active) : null)
        ?? (names.filter((name) => facts.armatures[name]!.action).length === 1
          ? names.find((name) => facts.armatures[name]!.action)! : null);
    // EVERY ARMATURE'S EVALUATOR, over the rig the presenter holds for it now.
    for (const [name, pose] of [...this.#poses])
      if (!facts.armatures[name] || view.skeletons.rig(name) !== pose.rig) { pose.dispose(); this.#poses.delete(name); }
    for (const [name, entry] of Object.entries(facts.armatures)) {
      const rig = view.skeletons.rig(name);
      if (!rig || !animated(entry)) {
        this.#poses.get(name)?.dispose();
        this.#poses.delete(name);
        continue;
      }
      let pose = this.#poses.get(name);
      if (!pose) this.#poses.set(name, pose = new MixerPose(rig));
      pose.facts(entry);
    }
    // A BAKE IS GOOD FOR ITS ACTION'S REVISION; a new revision bakes it again when next needed.
    for (const [key, entry] of [...this.#baked]) {
      const action = key.slice(key.indexOf('\u0000') + 1);
      if ((facts.actions[action] ?? null) !== entry.revision) this.#baked.delete(key);
    }
    const action = armature ? facts.armatures[armature]?.action ?? null : null;
    const key = JSON.stringify([armature, action, action ? facts.actions[action] ?? null : null, facts.clock, facts.frame]);
    if (key !== this.#clipKey) {
      this.#clipKey = key;
      this.#armature = armature;
      // THE SCENE'S CLOCK IS READ WITH OR WITHOUT AN ARMATURE (`docs/SCENE-ANIMATION.md`, step 1): a
      // film of keyed cameras and props has a range, a frame and markers, and the Timeline plays it
      this.#engineCalls++;
      const clip: BlenderActionClip | null = await read.clip(armature);
      if (clip?.action && clip.armature) this.#baked.set(`${clip.armature}\u0000${clip.action}`, { revision: facts.actions[clip.action] ?? null, clip: mixerClip(clip) });
      const previous = this.#clip;
      const rangeChanged = clip?.frameStart !== previous?.frameStart ||
        clip?.frameEnd !== previous?.frameEnd || clip?.fps !== previous?.fps;
      this.#clip = clip ?? null;
      if (!clip || clip.scene !== previous?.scene) this.#seeked = null;
      const activeSubject = this.#transport?.snapshot().activeSubject;
      if (rangeChanged && activeSubject) this.#transport?.setActiveSubject(activeSubject);
      const playing = this.#transport?.snapshot().playbackState === 'playing';
      if (clip && !playing) {
        this.#seeked = null;
        if (this.#transport && clip.fps > 0) this.#transport.seek(clip.frameCurrent / clip.fps);
      }
    }
    // THE MOVIE IS READ AGAIN WHEN AN ACTION OR THE SCENE'S CLOCK MOVED (a key, a marker, the range)
    const movieKey = JSON.stringify([facts.actions, facts.clock, this.#clip?.frameStart, this.#clip?.frameEnd]);
    if (read.movie && movieKey !== this.#movieKey) {
      this.#movieKey = movieKey;
      this.#engineCalls++;
      const data = await read.movie();
      this.#movie = data && data.objects.length ? playMovie(view, data) : null;
      for (const warning of this.#movie?.warnings ?? []) this.#say(`movie:${warning}`, warning);
    }
    this.#pose();
    this.#publish();
  }

  /** One action of one armature: baked, or being baked now (once), or null when it plays nothing. */
  #clipOf(armature: string, action: string): MixerClip | null | undefined {
    const key = `${armature}\u0000${action}`;
    const held = this.#baked.get(key);
    if (held) return held.clip;
    const reader = this.#reader;
    const revision = this.#view?.animationFacts().actions[action] ?? null;
    if (!reader) return null;
    const entry: { revision: number | null; clip: MixerClip | null | undefined } = { revision, clip: undefined };
    this.#baked.set(key, entry);
    this.#engineCalls++;
    void reader.bake(armature, action).then((baked) => {
      entry.clip = baked ? mixerClip(baked) : null;
      if (this.#baked.get(key) !== entry) return;
      this.#pose();
      this.#publish();
    }, (error: unknown) => {
      entry.clip = null;
      this.#say(`bake:${key}`, `${armature} / ${action} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    });
    return undefined;
  }

  /**
   * POSE EVERY ARMATURE AT THE FRAME ON SCREEN. At Blender's own frame, standing still, the bones
   * take Blender's pose (the frame's, exact) and the evaluator's answer is checked against it;
   * anywhere else they take the evaluator's.
   */
  #pose(): void {
    const view = this.#view;
    if (!view) return;
    const facts = view.animationFacts();
    const frame = this.frame();
    // BLENDER'S OWN FRAME is the one the presented pose was evaluated at, not the bookmark: a pause
    // writes the bookmark first and the frame evaluated there arrives after.
    const atBlender = frame === facts.frame;
    const playing = this.#transport?.snapshot().playbackState === 'playing';
    const warnings: string[] = this.#clip?.reason ? [this.#clip.reason] : [];
    const world = { object: (name: string) => view.objectForBlenderName(name) };
    // OBJECTS AND CAMERAS FIRST (an armature may ride on one), then the cut: the camera view looks
    // through the camera Blender's playback shows at this frame
    // (standing still at Blender's own frame the picture is Blender's, as for the armatures: an object
    // moved by hand and not keyed stays where it was put until the frame changes, as in Blender)
    if (this.#movie) {
      if (!(atBlender && !playing)) { this.#movie.pose(frame); this.#moviePosed = frame; } else this.#moviePosed = null;
      // THE CUT ALWAYS FOLLOWS THE MARKERS, at Blender's own frame too: Blender switches `scene.camera`
      // at bound markers as it plays, which a frame written back to it does not do
      const cut = this.#movie.cameraAt(frame);
      view.setPlaybackCamera(cut, cut === null ? null : this.#movie.cameraData(cut));
      // (a scrub that moved only objects and cameras asks the stage for the frame it now shows)
      invalidateStages();
    } else { view.setPlaybackCamera(null); this.#moviePosed = null; }
    for (const [name, pose] of this.#poses) {
      const armature = facts.armatures[name];
      if (!armature) continue;
      const unsupported = [...pose.unsupported(), ...this.#clipsOf(name).flatMap((clip) => clip.unsupported)];
      if (unsupported.length) {
        const said = `${name} plays ${unsupported.join(', ')} only in Blender, not in the Timeline or a game.${remedy(unsupported)}`;
        warnings.push(said);
        this.#say(`unsupported:${name}:${unsupported.join('|')}`, said);
      }
      const stack = sceneLayers(armature, frame, (action) => this.#clipOf(name, action));
      for (const skipped of stack.skipped) this.#say(`skipped:${name}:${skipped}`, `${name}: ${skipped} plays only in Blender, not in the Timeline or a game.`);
      if (stack.waiting) continue;
      if (atBlender && !playing) {
        this.#check(name, pose, armature, stack.layers, world, unsupported);
        view.skeletons.restorePose(name);
        pose.rig.object.updateMatrixWorld(true);
      } else {
        pose.apply(stack.layers, world);
      }
    }
    this.#warnings = warnings;
  }

  /** The clips baked so far for one armature. */
  #clipsOf(armature: string): MixerClip[] {
    const out: MixerClip[] = [];
    for (const [key, entry] of this.#baked) if (key.startsWith(`${armature} `) && entry.clip) out.push(entry.clip);
    return out;
  }

  /** THE FIDELITY CHECK at Blender's own frame: the evaluator's pose against Blender's. */
  #check(name: string, pose: MixerPose, armature: BlenderArmature, layers: readonly PoseLayer[],
    world: { object(name: string): ReturnType<BlenderRuntimeView['objectForBlenderName']> }, unsupported: readonly string[]): void {
    const off = poseDivergence(pose.apply(layers, world), armature);
    if (!off) return;
    const frame = this.#clip?.frameCurrent ?? this.frame();
    const why = unsupported.length
      ? `What Blender plays here and the evaluator does not: ${unsupported.join(', ')}.`
      : 'Nothing the evaluator knows of explains it; this is a defect in the presenter, report it with the file.';
    this.#say(`divergence:${name}:${frame}:${off.bone}:${Math.round(off.degrees)}`,
      `${name} at frame ${frame}: bone "${off.bone}" is ${off.degrees.toFixed(1)}° and ${(off.offset * 100).toFixed(1)}% of its length off Blender's own pose, so the Timeline and a game show it differently from Blender. ${why}`);
  }

  #say(key: string, message: string): void {
    if (this.#said.has(key)) return;
    this.#said.add(key);
    editorHost().console.warn(message, 'blender-animation');
  }

  // ------------------------------------------------------------ the playback

  #seek(frame: number): void {
    const clip = this.#clip;
    if (!clip) return;
    this.#seeked = Math.min(clip.frameEnd, Math.max(clip.frameStart, frame));
    this.#pose();
  }

  // ------------------------------------------------------------ what the animation editors read

  /** The armature the editors describe (the active object's, else the one with an action). */
  get subject(): string | null {
    return this.#armature;
  }

  /** Every action in the file, by name: what the Action Editor's selector offers. */
  actionNames(): string[] {
    return Object.keys(this.#view?.animationFacts().actions ?? {}).sort((a, b) => a.localeCompare(b));
  }

  /** The Action Editor's channels: the subject's active action, per bone, the frames it keys. */
  channels(): { bone: string; keys: number[] }[] {
    const bones = new Map<string, Set<number>>();
    for (const track of this.#clip?.tracks ?? []) {
      const raw = atob(track.keysBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const keys = new Float32Array(bytes.buffer, 0, bytes.length >> 2);
      let frames = bones.get(track.bone);
      if (!frames) bones.set(track.bone, frames = new Set());
      for (let i = 0; i < keys.length; i += 6) frames.add(Math.round(keys[i]! * 1000) / 1000);
    }
    return [...bones].map(([bone, frames]) => ({ bone, keys: [...frames].sort((a, b) => a - b) }));
  }

  /** Every armature with its NLA stack and active action, as the frame describes them. */
  stacks(): { armature: string; action: string | null; animation: BlenderArmature['animation'] }[] {
    const facts = this.#view?.animationFacts();
    if (!facts) return [];
    return Object.entries(facts.armatures).map(([armature, entry]) => ({ armature, action: entry.action ?? null, animation: entry.animation }));
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
    this.#clip = null;
    this.#seeked = null;
    for (const [name, pose] of this.#poses) { pose.dispose(); this.#view?.skeletons.restorePose(name); }
    this.#poses.clear();
    this.#baked.clear();
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
