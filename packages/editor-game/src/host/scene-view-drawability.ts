/**
 * WHEN THE EDITOR'S OWN RENDERER CANNOT DRAW AN ADOPTED WORLD.
 *
 * The Scene view draws whatever world the editor has adopted with the EDITOR's
 * `three`. For a first-party project, and for an ingested game that shares the
 * host's instance, that is the same three and the question never arises. It
 * arises for a game captured through three's devtools seam, which runs its own
 * pinned revision: `cuberun` pins r129, and r180's `WebGLRenderer` calls
 * `material.onBeforeRender()` — a method r129 materials do not have.
 *
 * Measured, before this guard: `TypeError: material.onBeforeRender is not a
 * function`, ×8955 and climbing, one per frame, from a mount that had otherwise
 * succeeded completely. The unresolved console set is meant to be a work list;
 * a per-frame throw turns it into noise and buries everything else.
 *
 * THE DISCRIMINATOR IS THE FAILURE, NOT THE INSTANCE. `scene instanceof
 * THREE.Scene` would have been the tidy test and it is the WRONG one: `tanks`
 * also runs its own three (r170) and the host renderer draws its world
 * perfectly — measured, in the editor viewport. Revision distance is not a
 * predicate anyone can evaluate ahead of time, so this waits for the actual
 * throw, attributes it to that scene, and stops re-throwing it forever.
 *
 * The game is NOT lost when this fires: its own renderer keeps drawing into its
 * own canvas, which the host adopted, so the Game tab and `vgai screenshot`
 * show the real thing. What is lost is the editor-camera Scene view of it,
 * which is exactly what the message says.
 */

import { commandLine } from '@volter/editor-core/product-command';
import { editorConsole } from '@volter/editor-core/editor-console';

const undrawable = new WeakMap<object, string>();

/**
 * Draw `scene`, unless a previous frame proved the host renderer cannot.
 * Returns `true` when the draw ran.
 */
export function drawSceneUnlessRefused(
  scene: object | null | undefined,
  draw: () => void,
): boolean {
  if (!scene) {
    draw();
    return true;
  }
  if (undrawable.has(scene)) return false;
  try {
    draw();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    undrawable.set(scene, message);
    // WARN, not error: this is a standing capability gap with its closing
    // condition named, the shape every other unreached-capability line here
    // takes — not a failure the reader is being asked to go fix in the editor.
    editorConsole.warn(
      "The Scene view cannot draw this world with the editor's own renderer, and has stopped " +
        `trying: ${message}. This world was built by a copy of three the editor did not make ` +
        '(a vendored bundle pins its own revision), and the editor draws it with ITS three — ' +
        'across a wide enough revision gap the two disagree about the renderer/material ' +
        'contract. The game itself is unaffected and still drawing: its own canvas is what the ' +
        `Game tab and ${commandLine('screenshot')} show, and hierarchy, selection and inspection all still ` +
        "read the live world. It closes when the game resolves `three` to the host's instance " +
        "— a bare, un-rewritten `import 'three'` in its own source.",
      'ingest',
    );
    return false;
  }
}
