/**
 * NAMES AN AGENT REACHES FOR THAT THE FAÇADE DOES NOT HAVE, and where the
 * thing it wanted actually lives.
 *
 * Why this exists (measured 2026-10, an agent building an obby in the Model
 * Editor): it called `editor.setCamera(...)`, got the engine's bare
 * "editor.setCamera is not a function", searched for a camera verb, and in the
 * end improvised a pose from `frame()` and `orbit()`. The camera was reachable
 * the whole time — through `editor.present`'s `viewport.camera` — but the
 * failure said nothing about it. The refusal is the one moment the caller is
 * certainly reading, so that is where the pointer goes.
 *
 * TARGETED, NOT A CATCH-ALL. Only the names below are intercepted, each with
 * the door it was looking for. Every other missing member keeps JavaScript's
 * own behaviour (`undefined`, then the engine's TypeError), so this table can
 * never turn a typo into a wrong suggestion — it only ever adds what is known.
 */

const CAMERA_HINT =
  'The viewport camera is posed through a presented view: ' +
  'await editor.present({ version: 1, viewport: { camera: { position: { x, y, z }, target: { x, y, z }, fov } } }) ' +
  '(stage space: metres, Y up; a Blender point (x, y, z) is { x, y: z, z: -y }), ' +
  'and read back with (await editor.currentView()).viewport.camera. ' +
  'From the Model Editor\'s shell: volter-model-editor camera --position x,y,z --target x,y,z [--fov n] (Blender coordinates). ' +
  'editor.frame() and editor.orbit() frame or swing around the subject instead.';

/** Missing `editor` member → what to use instead. */
const EDITOR_MEMBER_HINTS: Readonly<Record<string, string>> = {
  camera: CAMERA_HINT,
  setCamera: CAMERA_HINT,
  getCamera: CAMERA_HINT,
  cameraPose: CAMERA_HINT,
  setCameraPose: CAMERA_HINT,
  moveCamera: CAMERA_HINT,
  poseCamera: CAMERA_HINT,
  lookAt: CAMERA_HINT,
};

/** The pointer for a member `editor` does not have, or undefined when there is none to give. */
export function editorMemberHint(member: PropertyKey): string | undefined {
  return typeof member === 'string' && Object.hasOwn(EDITOR_MEMBER_HINTS, member) ? EDITOR_MEMBER_HINTS[member] : undefined;
}

/**
 * `editor` as `eval` binds it: the same object, except that reading one of the
 * hinted names it does NOT have throws the hint, naming `binding.member`.
 * Thrown on READ, not on call, so `editor.camera.position` is caught as well as
 * `editor.setCamera(...)`.
 *
 * Methods come back bound to the real object: `LiveEditor` keeps its client in
 * a `#`-private field, which a call whose `this` is the proxy cannot read.
 */
export function withEditorMemberHints<T extends object>(target: T, binding = 'editor'): T {
  return new Proxy(target, {
    get(object, key) {
      if (!(key in object)) {
        const hint = editorMemberHint(key);
        if (hint !== undefined) throw new TypeError(`${binding}.${String(key)} does not exist. ${hint}`);
      }
      const value: unknown = Reflect.get(object, key, object);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(object) : value;
    },
  });
}
