/** The runtime frame's INCREMENTAL contract — the one thing the worker that
 * builds a frame (`runtime_present`) and the presenter that applies it
 * (`blender-runtime-view.ts`) both have to agree on.
 *
 * A present ships the columns of the meshes whose store revision moved since
 * the last frame that session sent, and a bare REFERENCE for the rest; the
 * presenter already holds those as `BufferGeometry` and keeps them. This file
 * has no dependencies on purpose: the worker must not pull three.js in to read
 * a marker string.
 */

/** A mesh the presenter is expected to already hold, named by the store and
 *  revision it was last sent as. `store`/`revision` are diagnostic — they are
 *  what a stale-geometry report would quote — and `unchanged` is the
 *  discriminator. */
export interface UnchangedMesh {
  store: number;
  revision: number;
  unchanged: true;
}

/** The presenter's refusal when a reference names geometry it does not hold.
 *
 * It is a MARKER IN THE MESSAGE rather than an error subclass because the
 * refusal crosses a `Function`-constructed page eval and an SSE channel before
 * the worker sees it, and only the message survives that trip. The worker
 * answers by re-sending the whole frame in full; a page that reloaded under a
 * still-running Python session is the case this exists for. */
export const UNKNOWN_GEOMETRY = 'RUNTIME_FRAME_UNKNOWN_GEOMETRY';

/** The presenter's refusal when a material names a PICTURE it does not hold.
 *
 * The same contract one level up from the meshes: a frame carries an image's
 * bytes once per `(name, revision)` and after that its materials name it
 * (`blender/python/runtime_session.py`, `_stage_images`). The worker cannot
 * answer this one — the bytes are Python's to re-stage — so unlike
 * `UNKNOWN_GEOMETRY` it travels all the way back, and `RuntimeSession.present`
 * drops its record and presents the frame again in full. */
export const UNKNOWN_IMAGE = 'RUNTIME_FRAME_UNKNOWN_IMAGE';
