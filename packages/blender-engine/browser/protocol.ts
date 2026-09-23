/** Messages between the editor tab and its Blender worker. One session per
 * worker; the model lives in the worker's Python and nowhere else. */

export type WorkerRequest =
  | { id: number; op: 'history-begin' | 'history-end' }
  | { id: number; op: 'history-step'; token: string; direction: 'undo' | 'redo' }
  /** `document` is the session's `.blend`, PROJECT-RELATIVE (`models/model.blend`
   *  by default). An existing one is opened at start; an absent one starts
   *  empty and is created by the first save. */
  | { id: number; op: 'start'; project: string; document?: string }
  | { id: number; op: 'execute'; code: string; history?: boolean; label?: string }
  | { id: number; op: 'scene-info' }
  | { id: number; op: 'object-info'; name: string }
  | { id: number; op: 'screenshot-view'; maxSize: number }
  /** PRESENT WHAT THE ENGINE ALREADY HOLDS, with no capture — the frame a
   *  freshly opened Model document asks for (`session.py`'s `present` op,
   *  which `dispatch` has always answered; nothing sent it until the document
   *  did). Every mutation presents, so this is only ever the FIRST one. */
  | { id: number; op: 'present' }
  /** THE RNA DOOR (`./rna.ts` is its contract, `session.py`'s `rna_view`
   *  its answer): one datablock's `bl_rna.properties` as typed rows. `path` is
   *  the engine's own address (`bpy.data.objects["Cube"]`). */
  | { id: number; op: 'rna'; path: string; names?: number }
  /** The active object / bone / material slot / modifier the Properties tabs
   *  key on, and the tabs themselves. `object` names the object the CALLER is
   *  looking at (our viewport's selection); absent, the engine's own active
   *  object answers. `collection` is the same for the COLLECTION tab: the
   *  LayerCollection address of the Outliner row the caller clicked, standing
   *  in for `view_layer.active_layer_collection`, because activating it would
   *  be a mutation the document saves. */
  | { id: number; op: 'rna-context'; object?: string; collection?: string }
  /** ONE property, written through `setattr`. A read-only property is refused
   *  by name. */
  | {
      id: number;
      op: 'rna-set';
      history?: boolean;
      path: string;
      property: string;
      value: unknown;
      index?: number;
    }
  /** THE TREE DOOR (`./rna.ts`'s `BlenderOutlinerTree` is its contract,
   *  `session.py`'s `rna_outliner` its answer): Blender's View Layer tree for
   *  the scene. `selected` is the CALLER's selection by object name — our
   *  viewport's — for the same reason `rna-context` takes an object: reading
   *  a selection must never write the engine's. */
  | { id: number; op: 'outliner'; selected?: readonly string[] }
  /** THE NODE-TREE DOOR (`./rna.ts`'s `BlenderNodeTree` is its contract,
   *  `session.py`'s `rna_node_tree` its answer): ONE material's shader node
   *  tree, whole, because a tree's drawing is a fact about the whole tree and
   *  the generic RNA door answers one struct per round trip. `path` opens a
   *  tree by the engine's own address; `material` by name; neither reads the
   *  active object's active material, which is what Blender's own Shading
   *  header resolves (`space_node.py:89-93`). READ ONLY — there is no writer
   *  beside it, because moving a node or retyping a value is EDITING. */
  | { id: number; op: 'node-tree'; path?: string; material?: string }
  /** ONE MESH'S UV LAYOUT (`session.py`'s `rna_uv_layout`) — the per-corner
   *  arrays as base64 typed-array bytes, because a layout is `len(loops)`
   *  two-float corners and the generic door answers a struct at a time.
   *  Given no `object`, the view layer's active object answers. READ ONLY:
   *  pinning, unwrapping and selecting are edits. */
  | { id: number; op: 'uv-layout'; object?: string; uvLayer?: string }
  /** ONE MESH'S SKIN BINDING (`session.py`'s `rna_rig`) — the armature's bones
   *  with their rest AND bind matrices, plus up to four weighted influences
   *  per Blender vertex as base64 typed-array bytes. The BIND pose is the
   *  pose the exported columns were evaluated at, which is what lets three.js
   *  own playback without Blender's frame ever moving. READ ONLY. */
  | { id: number; op: 'rig'; object?: string }
  /** ONE ACTION AS A THREE.JS CLIP (`session.py`'s `rna_action_clip`) — per
   *  bone, the LOCAL transform at every integer frame of the action's range,
   *  plus the scene's frame range/fps and the summary row's key columns.
   *  READ ONLY: keying, moving a key and setting a range are edits. */
  | { id: number; op: 'action-clip'; object?: string; bake?: boolean }
  /** ONE RESTRICTION COLUMN, written (`session.py`'s `outliner_set`). A column
   *  Blender draws on no row of that type is refused by name. */
  | { id: number; op: 'outliner-set'; path: string; column: string; value: boolean }
  | { id: number; op: 'read-file'; path: string }
  | { id: number; op: 'write-file'; path: string; bytes: Uint8Array }
  | { id: number; op: 'list-files'; path: string }
  /** The tab's answer to a `present` the worker asked for.
   *
   *  `held` is the PRESENTER'S OWN report of what it held BEFORE this frame
   *  (`blender-runtime-view.ts::applyFrame`), carried through to the session so
   *  it can correct its record of what it sent. `null` says the presenter held
   *  nothing; the field is ABSENT when the presenter does not report one. */
  | {
      id: number;
      op: 'present-result';
      error?: string;
      capture?: unknown;
      held?: { session: string; revision: number } | null;
    };

export type WorkerReply =
  | { op: 'history'; entries: NativeHistoryEntry[] }
  | { id: number; result: unknown }
  | { id: number; error: string }
  /** The worker asks the tab to display a frame (and to remember the view a
   *  screenshot wants); the tab answers with `present-result` under the same id.
   *
   *  `description` is that same frame with every column replaced by its
   *  `{dtype, length, sha256}` (`session-frame.mts::describeFrame`). It rides
   *  BESIDE the frame rather than inside it because the frame's schema is
   *  strict and its buffers are TRANSFERRED: the instant this message is
   *  posted there is nothing left in the worker to describe. The tab keeps it
   *  as the record of what the session submitted — the second side a
   *  displayed-versus-submitted comparison otherwise does not have. */
  | { op: 'present'; id: number; frame: unknown; description: unknown; capture?: CaptureRequest }
  | { op: 'log'; level: 'log' | 'error'; text: string }
  /**
   * HOW BIG THE MODULE'S LINEAR MEMORY IS, posted after every call.
   *
   * The one number about the engine's memory that only the worker can read
   * (`Module.HEAPU8.length`), and the one the tab's census had no field for:
   * `heapUsedMB` is the PAGE's JS heap and says nothing about the wasm. wasm32
   * memory never shrinks, so this value is also the session's high-water mark
   * — a reader needs no separate peak.
   *
   * MEASURED 2026-09-18: 512 MB reserved at boot of which ~166 MB is ever
   * touched (so the reservation itself costs no resident pages), growing to
   * 1036 MB across `17-workshop-interior`. Every byte dlmalloc takes inside it
   * stays taken: there is no `madvise` in wasm, so a scene's peak allocation is
   * a permanent cost for the life of the tab.
   */
  | { op: 'memory'; bytes: number };

export type NativeHistoryEntry = { reset: true } | {
  id: string;
  label: string;
  resource: string | null;
};

export interface CaptureRequest {
  /** A viewport screenshot's bound, the longer side of a square frame.
   *  Absent on a render, which states its exact pixel dimensions instead. */
  size?: number;
  /** THE SCENE CAMERA'S FULL POSE, IN BLENDER'S OWN (Z-up) FRAME — a render
   *  carries all three or none. `position` and `target` are points; `up` is the
   *  camera's own up direction (`matrix_world.to_quaternion() @ (0,1,0)`), and
   *  it is not optional: a camera with roll — every top-down render has one —
   *  cannot be expressed by position and target alone. The tab transforms all
   *  three through the model root's world matrix before it builds the
   *  photograph's camera; nothing here is in three.js world space. */
  position?: number[];
  target?: number[];
  up?: number[];
  /** Present when this is a RENDER rather than a viewport screenshot. */
  render?: RenderRequest;
}

/**
 * `bpy.ops.render.render()` asking for the scene camera's own picture.
 *
 * three.js IS the renderer (ARCHITECTURE-CORE, "No second implementation of a
 * substrate capability ships"), so a render is the Model document photographed
 * through the scene's camera at `scene.render`'s exact resolution — and unlike
 * a screenshot, whose view is only REMEMBERED for the transport to photograph
 * later, the pixels come back to the caller inside the operator that asked.
 */
export interface RenderRequest {
  /** Omit the visible world while retaining its illumination. */
  transparent?: boolean;
  width: number;
  height: number;
  /** The camera's VERTICAL field of view, in degrees. */
  fov: number;
  /** The scene's own view transform, as the three.js tone mapping of the same
   *  NAME (`bpy/_render_three.py`). A transform with no curve here never
   *  reaches this point: Python refuses it. */
  toneMapping: 'none' | 'agx' | 'filmic' | 'neutral';
  /** The colour-management LOOK the scene asks for, as Blender names it.
   *  `'None'` means the base transform; anything else is a look the view holds
   *  a baked table for, because the renderer refuses the rest by name. */
  look?: string;
  /** Hand back the SCENE-REFERRED half-float frame too. An EXR is written
   *  from it, and so is the COMPOSITOR's input. */
  linear?: boolean;
  /** DISPLAY THIS FRAME instead of photographing the scene: the scene-linear
   *  half-float RGBA the COMPOSITOR produced, base64 of its raw bytes in the
   *  capture's own bottom-up row order. A composited render cannot be a
   *  photograph — the pixels are the graph's output, not the viewport's — so
   *  the tab runs the view transform over these values and answers with the
   *  PNG. Framing is unused when this is present. */
  linearInput?: { base64: string; width: number; height: number };
  /** `view_settings.exposure` as a linear multiplier. */
  exposure: number;
  /** An ORTHO camera; `fov` then carries `ortho_scale` (`_render_three.py`). */
  orthographic: boolean;
}

export interface FileEntry {
  path: string;
  size: number;
  /** Milliseconds since the epoch, the worker filesystem's own clock. */
  mtime: number;
}

export interface RuntimeStart {
  session: string;
  python: string;
  /** Which build of Blender answered: the standalone Emscripten module, or
   *  Blender as a WALI program on browser-substrate. One gate, both skews --
   *  a board that cannot name the skew it measured cannot call a difference
   *  between them a defect in either. */
  skew?: 'emscripten' | 'wali';
  /** The session's document, project-relative, when one was named. */
  document?: string;
  /** True when the project already held that `.blend` and it was OPENED —
   *  false when the session started empty and will create it on first save. */
  opened?: boolean;
}
