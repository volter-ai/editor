import type { GodotCodeRuleEntry } from '../lowering-rules';
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from './godot-4.7-seed';

export const GODOT_4_7_SCENE_SPAWN_RULES: readonly GodotCodeRuleEntry[] = [
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'PRELOAD',
      semanticKey: 'preload:packed-scene|annotations:[]',
      inputDatatypes: [],
      resultDatatype: 'NATIVE:PackedScene',
    },
    target: { kind: 'structural', construct: 'preload' },
  },
];
