import type { GodotCodeRuleEntry } from '../lowering-rules';
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from './godot-4.7-seed';

export const GODOT_4_7_AUTOLOAD_REFERENCE_RULES: readonly GodotCodeRuleEntry[] = [
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'IDENTIFIER',
      semanticKey: 'autoload-identifier:resolved-script-singleton|annotations:[]',
      inputDatatypes: [],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'autoload-identifier' },
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'RETURN',
      semanticKey: 'return:value|annotations:[]',
      inputDatatypes: [
        'CLASS|ANNOTATED_EXPLICIT|SettingsState|Object|Node||res://settings.gd|SettingsState|constant|writable|instance|concrete|sync|[]',
      ],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'return' },
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'RETURN',
      semanticKey: 'return:value|annotations:[]',
      inputDatatypes: [
        'CLASS|ANNOTATED_EXPLICIT|GlobalsState|Object|Node||res://globals.gd|GlobalsState|constant|writable|instance|concrete|sync|[]',
      ],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'return' },
  },
];
