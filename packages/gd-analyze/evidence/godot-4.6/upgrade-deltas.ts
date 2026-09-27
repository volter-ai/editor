/**
 * The measured 4.6-to-4.7 upgrade deltas: each case (`<case file>:<case id>`) whose native run on
 * the official Godot 4.6 binary disagrees with the same target (compat, which transcribes 4.7), with
 * the source change between the two pinned revisions that explains it (4.6 `89cea143`, 4.7
 * `5b4e0cb0`), or `unexplained` where the line is not isolated. A 4.6 project imports as 4.7 runs it
 * (`selectGodotFrontendAuthority`); these are recorded, not conditioned on.
 */
export type GodotUpgradeDeltaExplanation =
  | {
      readonly file: string;
      readonly line46: number | 'absent';
      readonly line47: number;
      readonly change: string;
    }
  | { readonly unexplained: string };

const NORMALIZE_2 = {
  file: 'core/math/vector2.cpp',
  line46: 52,
  line47: 52,
  change: 'Vector2::normalize: 4.7 zeroes a non-finite vector and a zero-length one (`zero()`); 4.6 divided by the length when it was non-zero and otherwise left the components as they were (a subnormal whose square underflows, a negative zero)',
};
const NORMALIZE_3 = {
  file: 'core/math/vector3.h',
  line46: 548,
  line47: 548,
  change: 'Vector3::normalize: 4.7 zeroes a non-finite vector (`!is_finite()` → `zero()`); 4.6 divided by its length',
};
const ANIMATION_LENGTH = {
  file: 'scene/resources/animation.h',
  line46: 528,
  line47: 536,
  change: 'Animation::set_length takes `real_t` (float) in 4.6 and `double` in 4.7: a length reads back as its float in 4.6 (0.4 → 0.4000000059604645)',
};
const INPUT_DEVICE = {
  file: 'core/input/input_event.cpp',
  line46: 'absent',
  line47: 669,
  change: 'InputEventKey and InputEventMouse default to DEVICE_ID_KEYBOARD (16) and DEVICE_ID_MOUSE (32) in 4.7 (their constructors, :669 and :715), and InputMap::action_add_event rewrites a device-0 key or mouse event to them (core/input/input_map.cpp:211); in 4.6 they are device 0, so action matching and get_device differ',
};
const BOX_CEIL = {
  file: 'scene/gui/box_container.cpp',
  line46: 63,
  line47: 70,
  change: 'BoxContainer::_resort takes each child minimum size as `get_combined_minimum_size().ceil()` in 4.7; 4.6 converted it to Size2i without the ceil',
};

export const GODOT_4_6_UPGRADE_DELTAS: Readonly<Record<string, GodotUpgradeDeltaExplanation>> = {
  'vector2:normalized-subnormal': NORMALIZE_2,
  'vector2:normalized-negative-zero': NORMALIZE_2,
  'vector2:normalized-infinite': NORMALIZE_2,
  'vector2:normalized-nan': NORMALIZE_2,
  'vector3:normalized-infinite': NORMALIZE_3,
  'vector3:normalized-nan': NORMALIZE_3,
  ...Object.fromEntries(
    ['length-loop-step', 'length-loop-step-get_length', 'length-loop-step-set_loop_mode', 'length-loop-step-get_loop_mode', 'length-loop-step-set_step', 'length-loop-step-get_step'].map((id) => [`animation:${id}`, ANIMATION_LENGTH]),
  ),
  // The player's and mixer's timelines read an animation's length (`get_current_animation_length`).
  'animation-mixer:set_deterministic': ANIMATION_LENGTH,
  'animation-player:queue-then-finish': ANIMATION_LENGTH,
  'animation-player:set_blend_time': ANIMATION_LENGTH,
  'animation-player:play-library': ANIMATION_LENGTH,
  'animation-player:animation_set_next': ANIMATION_LENGTH,
  'animation-player:set_current_animation': {
    file: 'scene/animation/animation_player.cpp',
    line46: 594,
    line47: 613,
    change: 'AnimationPlayer::set_current_animation("[stop]") stops at once in 4.6; 4.7 defers the stop (`call_deferred`) and only while playing',
  },
  'animation-player:play-transforms': {
    file: 'scene/animation/animation_mixer.cpp',
    line46: 1901,
    line47: 1946,
    change: 'AnimationMixer::_blend_apply writes a node with position, rotation and scale tracks as one Transform3D(Basis(rot).scaled(scale), loc) in 4.7; 4.6 set rotation (from Euler) then scale, which rounds differently',
  },
  'animation-tree:set_animation_player': {
    unexplained: 'on re-attaching the player, 4.6 restarts the blend from time 0 and 4.7 resumes; the AnimationTree instance and process-state model was rewritten between the revisions and the line is not isolated',
  },
  'box-container:set_alignment-box': BOX_CEIL,
  'box-container:get_alignment-box': BOX_CEIL,
  'box-container:is_vertical-box': BOX_CEIL,
  'container:fit_child_in_rect-box': BOX_CEIL,
  'cpu-particles-3d:fixed-fps-preprocess': {
    file: 'scene/3d/cpu_particles_3d.cpp',
    line46: 667,
    line47: 696,
    change: 'CPUParticles3D preprocessing steps whole frames in 4.6; 4.7 clamps the last step to the time left (`frame_time > todo ? todo : frame_time`)',
  },
  'cpu-particles-3d:preprocess': {
    file: 'scene/3d/cpu_particles_3d.cpp',
    line46: 667,
    line47: 696,
    change: 'CPUParticles3D preprocessing steps whole frames in 4.6; 4.7 clamps the last step to the time left (`frame_time > todo ? todo : frame_time`)',
  },
  'gradient-texture-2d:pixels-conic-mirror': {
    file: 'scene/resources/gradient_texture.cpp',
    line46: 'absent',
    line47: 307,
    change: 'GradientTexture2D FILL_CONIC is new in 4.7; 4.6 has no conic fill and draws the value as another fill',
  },
  ...Object.fromEntries(
    [
      'input-event:get_device-key-pressed',
      'input-event:get_device-mouse-canceled',
      ...['key-press-timeline', 'key-release-physics-first', 'key-press-flushed-mid-frame', 'key-press-release-same-frame', 'key-device-zero-does-not-match', 'key-echo', 'key-modifiers', 'physical-and-label-keys', 'action_press-then-key-release', 'get_axis-keys', 'get_vector-overlapping', 'mouse-button'].map((id) => `input:${id}`),
      ...['set_process_input-input', 'is_processing_input-input', 'set_process_shortcut_input-input', 'is_processing_shortcut_input-input', 'set_process_unhandled_input-input', 'is_processing_unhandled_input-input', 'set_process_unhandled_key_input-input', 'is_processing_unhandled_key_input-input'].map((id) => `node:${id}`),
      ...['push_input-order', 'set_input_as_handled-handled', 'is_input_handled-handled', 'push_input-gui'].map((id) => `viewport:${id}`),
    ].map((key) => [key, INPUT_DEVICE]),
  ),
};
