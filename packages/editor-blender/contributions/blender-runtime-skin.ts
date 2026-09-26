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
 * times a second under every bpy reader in the session. So instead the tab
 * reads the rig ONCE (`session.py`'s `rna_rig`) and the action ONCE
 * (`rna_action_clip`), builds a real `THREE.SkinnedMesh` + `Skeleton` +
 * `AnimationMixer`, and every scrub and every played frame after that costs
 * ZERO calls into Blender.
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

import type {
  BlenderActionClip,
  BlenderRig,
  BlenderRigBinding,
} from '@volter/blender-engine/browser/rna';
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
function uint16Of(base64: string): Uint16Array {
  const bytes = bytesOf(base64);
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
}

/** A row-major four-row matrix, as every matrix in the RNA doors crosses —
 *  `THREE.Matrix4.set` takes its arguments row-major too, so this is a spread
 *  and not a transpose. */
function matrixOf(rows: readonly (readonly [number, number, number, number])[]): THREE.Matrix4 {
  return new THREE.Matrix4().set(...(rows.flat() as unknown as Parameters<THREE.Matrix4['set']>));
}

/** What the presenter needs of the view to swap a Mesh for a SkinnedMesh and
 *  to hang bones off an armature. Deliberately three methods and not the view:
 *  this module has no business knowing about frames, materials or overlays. */
export interface SkinPresentation {
  /** The presented `Object3D` for a Blender object NAME, or null. */
  objectForBlenderName(name: string): THREE.Object3D | null;
  /** Put `next` where `previous` was — same parent, same place in the object
   *  table — so the next frame's reuse check finds it. */
  replacePresentedObject(previous: THREE.Object3D, next: THREE.Object3D): void;
  /** The presented root, for the one forced `updateMatrixWorld` a bind needs. */
  root: THREE.Object3D;
}

interface BoundRig {
  /** The MESH object's Blender name. */
  readonly object: string;
  readonly armature: string;
  readonly mesh: THREE.SkinnedMesh;
  readonly boneRoot: THREE.Group;
  readonly bones: readonly THREE.Bone[];
  readonly skeleton: THREE.Skeleton;
  /** `scene.frame_current` the binding was read at. */
  readonly frame: number;
  /** The identity a re-read is compared against: rebuilding a skeleton on
   *  every present would throw away the mixer's time sixty times a minute. */
  readonly signature: string;
}

function rigSignature(rig: BlenderRigBinding, frame: number): string {
  return [rig.object, rig.mesh, rig.armature, rig.vertexCount, rig.bones.length, frame].join('|');
}

/**
 * THE ONE DIRECTOR, module-scoped for the reason `BlenderRuntimeView` itself
 * is (`blender-runtime.document.tsx`): the Python session outlives workspace
 * switches and document remounts, so the skeleton it bound must too. The
 * Timeline document reads and drives this exact instance; there is no second
 * copy of the playback state anywhere.
 */
export class BlenderSkinDirector {
  #rigs = new Map<string, BoundRig>();
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
      bones: [...this.#rigs.values()].reduce((sum, rig) => sum + rig.bones.length, 0),
      keyframes: clip?.keyframes ?? [],
      summary: clip?.summary ?? [],
      clipStart: clip?.clipStart ?? null,
      clipEnd: clip?.clipEnd ?? null,
      tracks: clip?.tracks.length ?? 0,
      bound: [...this.#rigs.keys()],
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
    if (!clip || !this.#action || clip.clipStart === undefined) return clip?.frameCurrent ?? 1;
    // A SEEK'S OWN ANSWER, while one is standing. `LoopRepeat` wraps
    // `action.time` into `[0, duration)`, so a seek to the LAST frame lands on
    // `time === duration` and reads back as the FIRST — measured on the first
    // walk, where `jump-end` answered frame 1 over a frame-48 pose. The
    // wrapping is right for playback and wrong for a question, so a standing
    // seek answers with the frame it was given and the play tick clears it.
    if (this.#seeked !== null) return this.#seeked;
    // THE ACTION'S TIME, NOT THE MIXER'S, and the difference is the whole of
    // looping: `AnimationMixer.time` is monotonic and never wraps, while
    // `AnimationAction.time` is wrapped into `[0, duration]` by `LoopRepeat`.
    // Measured on the first walk: two seconds of playback over a 47-frame clip
    // read as frame 63.5 off the mixer, where the picture was correctly back
    // near the start.
    return clip.clipStart + this.#action.time * clip.fps;
  }

  /** Whether anything is actually playable — a Timeline over a file with no
   *  action still draws its ruler and its range. */
  get playable(): boolean {
    return this.#action !== null;
  }

  // ------------------------------------------------------------ the binding

  /**
   * Bind every rigged mesh the frame carries, and load the active action.
   *
   * IDEMPOTENT BY SIGNATURE: a rig whose mesh, armature, vertex count, bone
   * count and export frame are unchanged is left exactly as it is, mixer time
   * included. That is what lets the presenter call this after EVERY frame
   * without the picture jumping back to the bind pose each time something
   * unrelated moved.
   */
  async bind(
    presentation: SkinPresentation,
    read: {
      rig(): Promise<BlenderRig | null>;
      clip(): Promise<BlenderActionClip | null>;
    },
  ): Promise<void> {
    this.#engineCalls++;
    const answer = await read.rig();
    if (!answer) return;
    const warnings: string[] = [];
    const wanted = new Set<string>();
    let changed = false;
    for (const rig of answer.rigs) {
      if (!rig.object || !rig.armature || !rig.skinIndexBase64 || !rig.skinWeightBase64) {
        if (rig.reason) warnings.push(rig.reason);
        continue;
      }
      wanted.add(rig.object);
      const signature = rigSignature(rig, answer.frame);
      if (this.#rigs.get(rig.object)?.signature === signature) continue;
      const bound = this.#bindOne(presentation, rig, answer.frame, warnings);
      if (bound) {
        this.#rigs.get(rig.object)?.skeleton.dispose();
        this.#rigs.set(rig.object, bound);
        changed = true;
      }
    }
    for (const [name, rig] of [...this.#rigs])
      if (!wanted.has(name)) {
        rig.skeleton.dispose();
        rig.boneRoot.removeFromParent();
        this.#rigs.delete(name);
        changed = true;
      }
    this.#engineCalls++;
    const clip = await read.clip();
    const previous = this.#clip;
    const movedAction =
      clip?.action !== previous?.action ||
      clip?.tracks.length !== previous?.tracks.length ||
      clip?.clipStart !== previous?.clipStart ||
      clip?.clipEnd !== previous?.clipEnd;
    this.#clip = clip ?? null;
    if (clip?.reason) warnings.push(clip.reason);
    if (clip && (movedAction || changed)) this.#loadClip(presentation, clip, warnings);
    // BLENDER'S OWN FRAME RE-SYNCS THE PLAYHEAD. An agent that set
    // `scene.frame_current` in bpy has said where it wants to be, and a
    // present is how we hear about it; while the transport is PLAYING it would
    // be the Timeline arguing with itself, so it is honoured only at rest.
    const playing = this.#transport?.snapshot().playbackState === 'playing';
    if (clip && !playing && previous?.frameCurrent !== clip.frameCurrent) {
      this.#seek(clip.frameCurrent);
      // THE BOOKMARK READ, once per bind: the file says where it was left, and
      // the transport is what everything else now asks.
      if (this.#transport && clip.fps > 0) this.#transport.seek(clip.frameCurrent / clip.fps);
    }
    this.#warnings = warnings;
    this.#publish();
  }

  #bindOne(
    presentation: SkinPresentation,
    rig: BlenderRigBinding,
    frame: number,
    warnings: string[],
  ): BoundRig | null {
    const meshObject = presentation.objectForBlenderName(rig.object ?? '');
    const armatureObject = presentation.objectForBlenderName(rig.armature ?? '');
    if (!meshObject || !armatureObject) return null;
    const source = meshObject as THREE.Mesh;
    const geometry = source.geometry;
    if (!geometry) return null;
    const blenderVertex = geometry.getAttribute('blenderVertex');
    if (!blenderVertex) {
      warnings.push(
        `"${rig.object}" cannot be skinned: its presented geometry carries no \`blenderVertex\` attribute, so a per-Blender-vertex weight cannot be expanded onto its drawn vertices.`,
      );
      return null;
    }
    if (rig.vertexCount === 0) return null;
    // THE COLUMNS AND THE BINDING MUST BE THE SAME MESH. `rna_rig` reads the
    // ORIGINAL mesh's vertices (a deform layer is not geometry, so that is
    // where the weights live); a generative modifier — Subdivision, Mirror,
    // Array — makes the EVALUATED mesh the export door ships a different
    // vertex set, and a skin bound across that mismatch would weight the wrong
    // vertices. Named, never silently drawn.
    let highest = 0;
    for (let i = 0; i < blenderVertex.count; i++)
      highest = Math.max(highest, blenderVertex.getX(i));
    if (highest >= rig.vertexCount) {
      warnings.push(
        `"${rig.object}" is not skinned here: its presented geometry references Blender vertex ${highest} while the mesh declares ${rig.vertexCount}, which is a generative modifier (Subdivision, Mirror, Array…) between the two. Blender's own viewport shows the evaluated result; this presenter shows the exported columns unskinned.`,
      );
      return null;
    }
    const skinIndex = uint16Of(rig.skinIndexBase64 ?? '');
    const skinWeight = float32Of(rig.skinWeightBase64 ?? '');
    const drawn = blenderVertex.count;
    const indices = new Uint16Array(drawn * 4);
    const weights = new Float32Array(drawn * 4);
    for (let i = 0; i < drawn; i++) {
      const vertex = blenderVertex.getX(i);
      for (let k = 0; k < 4; k++) {
        indices[i * 4 + k] = skinIndex[vertex * 4 + k] ?? 0;
        weights[i * 4 + k] = skinWeight[vertex * 4 + k] ?? 0;
      }
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));

    const boneRoot = new THREE.Group();
    boneRoot.name = `${rig.armature}:bones`;
    const bones: THREE.Bone[] = [];
    const armatureSpace = rig.bones.map((bone) => matrixOf(bone.pose));
    const indexByName = new Map(rig.bones.map((bone, index) => [bone.name, index]));
    rig.bones.forEach((declared, index) => {
      const bone = new THREE.Bone();
      // THE NAME IS BLENDER'S, unsanitized, because a game reads it: the
      // arena's `Player.tsx` finds its bones by Blender's own names. The CLIP
      // therefore addresses bones by UUID rather than by name — three's
      // `PropertyBinding` track-name grammar splits on `.`, and Blender's
      // `hand.L` is an ordinary bone name.
      bone.name = declared.name;
      bones.push(bone);
      const parentIndex = declared.parent === null ? undefined : indexByName.get(declared.parent);
      const local =
        parentIndex === undefined
          ? armatureSpace[index]!.clone()
          : armatureSpace[parentIndex]!.clone().invert().multiply(armatureSpace[index]!);
      local.decompose(bone.position, bone.quaternion, bone.scale);
      (parentIndex === undefined ? boneRoot : bones[parentIndex]!).add(bone);
    });
    armatureObject.add(boneRoot);

    const skinned = new THREE.SkinnedMesh(geometry, source.material);
    skinned.name = source.name;
    skinned.matrixAutoUpdate = false;
    skinned.matrix.copy(source.matrix);
    skinned.matrix.decompose(skinned.position, skinned.quaternion, skinned.scale);
    skinned.userData = source.userData;
    // A SKIN MOVES PAST ITS BIND BOUNDS. three computes a SkinnedMesh's
    // bounding sphere from the bind pose, so a raised arm at frame 24 is
    // culled while its bind-pose sphere is off screen — a picture that
    // vanishes mid-scrub with no error anywhere.
    skinned.frustumCulled = false;
    presentation.replacePresentedObject(source, skinned);
    // THE BIND IS TAKEN AFTER THE GRAPH STANDS, because both halves of it are
    // WORLD matrices: `Skeleton`'s bone inverses are the bones' `matrixWorld`
    // at this instant and `bindMatrix` is the mesh's.
    presentation.root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    skinned.bind(skeleton, skinned.matrixWorld.clone());
    if (rig.constrainedBones?.length)
      warnings.push(
        `Bone constraints on ${rig.constrainedBones.join(', ')}: the clip is derived from the F-Curves alone, so those bones play their channels rather than Blender's solved pose.`,
      );
    if (rig.unmappedGroups?.length)
      warnings.push(
        `${rig.object} carries vertex groups no bone is named for (${rig.unmappedGroups.join(', ')}); they weight nothing here, exactly as they deform nothing in Blender.`,
      );
    return {
      object: rig.object ?? '',
      armature: rig.armature ?? '',
      mesh: skinned,
      boneRoot,
      bones,
      skeleton,
      frame,
      signature: rigSignature(rig, frame),
    };
  }

  #loadClip(presentation: SkinPresentation, clip: BlenderActionClip, warnings: string[]): void {
    this.#mixer?.stopAllAction();
    this.#mixer = null;
    this.#action = null;
    if (!clip.tracks.length || clip.clipStart === undefined || clip.clipEnd === undefined) return;
    const armature = clip.armature ? presentation.objectForBlenderName(clip.armature) : null;
    if (!armature) return;
    const byName = new Map<string, THREE.Bone>();
    for (const rig of this.#rigs.values())
      if (rig.armature === clip.armature) for (const bone of rig.bones) byName.set(bone.name, bone);
    const tracks: THREE.KeyframeTrack[] = [];
    const missing = new Set<string>();
    for (const track of clip.tracks) {
      const bone = byName.get(track.bone);
      if (!bone) {
        missing.add(track.bone);
        continue;
      }
      const times = float32Of(track.timeBase64);
      const values = float32Of(track.valueBase64);
      // ADDRESSED BY UUID, not by name — see the bone-naming note above.
      const path = `${bone.uuid}.${track.property}`;
      tracks.push(
        track.property === 'quaternion'
          ? new THREE.QuaternionKeyframeTrack(path, Array.from(times), Array.from(values))
          : new THREE.VectorKeyframeTrack(path, Array.from(times), Array.from(values)),
      );
    }
    if (missing.size)
      warnings.push(
        `${clip.action} animates ${[...missing].join(', ')}, which this binding has no bone for.`,
      );
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
    if (!clip || !this.#mixer || clip.clipStart === undefined || clip.clipEnd === undefined) return;
    const clamped = Math.min(clip.clipEnd, Math.max(clip.clipStart, frame));
    this.#seeked = clamped;
    // The TIME is nudged inside the clip so the last frame evaluates as the
    // last frame rather than wrapping to the first; the number REPORTED is the
    // one asked for (see `frame`).
    const duration = (clip.clipEnd - clip.clipStart) / clip.fps;
    this.#mixer.setTime(Math.min(duration - 1e-4, (clamped - clip.clipStart) / clip.fps));
    this.#refresh();
  }

  /** The bones moved; make the world matrices agree before the stage's next
   *  render reads them. A `Bone` keeps `matrixAutoUpdate`, so this is a forced
   *  pass over a handful of nodes rather than a recomposition of the scene. */
  #refresh(): void {
    for (const rig of this.#rigs.values()) {
      rig.boneRoot.updateMatrixWorld(true);
      rig.skeleton.update();
    }
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
    const detach = () => {
      stopSettled();
      detachSubject();
      if (this.#transport === transport) this.#transport = null;
      this.#detach = null;
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
    for (const rig of this.#rigs.values()) {
      rig.skeleton.dispose();
      rig.boneRoot.removeFromParent();
    }
    this.#rigs.clear();
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
