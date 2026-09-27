/**
 * Animation: an `AnimationPlayer` node (`<GodotAnimationPlayer>`, compat's AnimationMixer protocol
 * blending its libraries' tracks onto the scene's nodes through the bindings resolved at import),
 * its `AnimationLibrary` (a data file of animations), and an `AnimationTree` over it
 * (`<GodotAnimationTree>`, its `AnimationNodeBlendTree` a data file, its parameters a prop).
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_ANIMATION_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'AnimationLibrary',
    construct: { module: 'lib/godot-compat/animation-library', exportName: 'godot_animation_library_load' },
    source: { file: 'scene/resources/animation_library.cpp', symbol: 'AnimationLibrary::_set_data', line: 148 },
  },
  {
    sourceRevision: REVISION,
    className: 'AnimationNodeBlendTree',
    construct: { module: 'lib/godot-compat/animation-tree', exportName: 'godot_animation_node_load' },
    source: { file: 'scene/animation/animation_blend_tree.cpp', symbol: 'AnimationNodeBlendTree::_set', line: 1740 },
  },
];
