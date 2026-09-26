/**
 * The BLENDER keymap (`@volter/editor-sdk/looks`, a `workspace.keymap`
 * contribution). Only the chords that differ from the editor's own are
 * declared; the host fills the rest from its default table.
 *
 * Every chord below is Blender's own, cited to its entry in
 * `scripts/presets/keyconfig/keymap_data/blender_default.py` at the engine's
 * pin (v5.2.0) — the file that IS the "Blender" keyconfig.
 */
import type { KeymapContribution } from '@volter/editor-sdk/looks';

export const point = 'workspace.keymap';
export const keymap: KeymapContribution = {
  id: 'blender',
  title: 'Blender',
  description:
    'Blender bindings: W select, G/R/S gizmo modes, X delete, Shift+D duplicate, A select all, Alt+A deselect, . frames.',
  bindings: {
    // `km_view3d`, `:1950-1955` — `op_tool_cycle("builtin.select_box", {"type": 'W'})`,
    // bound whenever select is on the left mouse button, which is the default.
    'transform.select': [{ key: 'w' }],
    'transform.translate': [{ key: 'g' }],
    'transform.rotate': [{ key: 'r' }],
    'transform.scale': [{ key: 's' }],
    // `km_object_mode`, `:4552` — `object.delete` with `use_global: False`.
    // Blender's X raises a confirmation popup and ours does not; the deletion
    // itself is `bpy.ops.object.delete()` either way.
    'edit.delete': [{ key: 'x' }],
    // `km_object_mode`, `:4563` — `object.duplicate_move` on Shift+D. Blender
    // then runs a modal move on the copy; ours leaves it on the original's
    // pose for the gizmo to move, which is what the Outliner and the `.blend`
    // both read back.
    'edit.duplicate': [{ key: 'd', shift: true }],
    'edit.selectAll': [{ key: 'a' }, { key: 'a', mod: true }],
    'edit.deselectAll': [{ key: 'a', alt: true }],
    'viewport.frameSelection': [{ key: '.' }, { key: '', code: 'NumpadDecimal' }],
    'viewport.cyclePivot': [{ key: ',' }],
    // `km_view3d` — `view3d.view_persportho` on NUMPAD_5; Blender has no isometric preset key.
    'view.perspective': [],
    'view.projection': [{ key: '', code: 'Numpad5' }],
    // `km_view3d` — `view3d.view_axis` with Ctrl for the opposite side, `view3d.view_orbit` on
    // NUMPAD_2/4/6/8 (15°, `pad_rot_angle`) and NUMPAD_9 (π), `view3d.view_roll` on Shift+4/6.
    // Blender's Ctrl is the Control key on every platform, macOS included (`ctrl`, not `mod`).
    'view.back': [{ key: '', code: 'Numpad1', ctrl: true }],
    'view.left': [{ key: '', code: 'Numpad3', ctrl: true }],
    'view.bottom': [{ key: '', code: 'Numpad7', ctrl: true }],
    'view.orbitLeft': [{ key: '', code: 'Numpad4' }],
    'view.orbitRight': [{ key: '', code: 'Numpad6' }],
    'view.orbitUp': [{ key: '', code: 'Numpad8' }],
    'view.orbitDown': [{ key: '', code: 'Numpad2' }],
    'view.opposite': [{ key: '', code: 'Numpad9' }],
    'view.rollLeft': [{ key: '', code: 'Numpad4', shift: true }],
    'view.rollRight': [{ key: '', code: 'Numpad6', shift: true }],
  },
  // `km_view3d` — `view3d.rotate` on MIDDLEMOUSE and `view3d.move` on Shift+MIDDLEMOUSE; the
  // right button is the context menu's, and Shift+Right places the 3D cursor. The factory
  // rotation is Turntable at 0.4° a pixel (`view_rotate_method`,
  // `view_rotate_sensitivity_turntable`, read back from Blender 5.2; a pixel over `UI_SCALE_FAC`,
  // so one CSS pixel on any display), with Auto Perspective on (`use_auto_perspective`).
  navigation: { orbit: 'middle', turntable: { degreesPerPixel: 0.4 }, autoPerspective: true },
};
