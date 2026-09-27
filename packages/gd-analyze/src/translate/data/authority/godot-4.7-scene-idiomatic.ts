/**
 * Idiomatic scenes (GODOT.md, "The output is idiomatic three.js"): a scene whose nodes, properties
 * and resources all have an idiomatic mapping is written as React Three Fiber JSX with converted
 * literal values, `@react-three/rapier` bodies and `useGodotScript` attachments.
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneStructureRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

export const GODOT_4_7_IDIOMATIC_STRUCTURE_RULES: readonly (GodotSceneStructureRule & {
  readonly source: Readonly<{ file: string; symbol: string; line: number }>;
})[] = [
  {
    sourceRevision: REVISION,
    id: 'idiomatic-scene',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate', line: 400 },
  },
];
