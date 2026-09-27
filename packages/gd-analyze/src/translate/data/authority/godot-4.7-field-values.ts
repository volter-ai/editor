import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotFieldValueRule } from '../field-value-authority';

const MUTABLE_INT =
  'BUILTIN|ANNOTATED_EXPLICIT|int|int|||||mutable|writable|instance|concrete|sync|[]';
const MUTABLE_FLOAT =
  'BUILTIN|ANNOTATED_EXPLICIT|float|float|||||mutable|writable|instance|concrete|sync|[]';
const MUTABLE_BOOL =
  'BUILTIN|ANNOTATED_EXPLICIT|bool|bool|||||mutable|writable|instance|concrete|sync|[]';
const MUTABLE_STRING =
  'BUILTIN|ANNOTATED_EXPLICIT|String|String|||||mutable|writable|instance|concrete|sync|[]';

/** The same fields declared by inference (`@export var speed := 1.5`): the value is set the same way. */
const inferred = (explicit: string) => explicit.replace('ANNOTATED_EXPLICIT', 'ANNOTATED_INFERRED');

export const GODOT_4_7_FIELD_VALUE_RULES: readonly GodotFieldValueRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: MUTABLE_INT,
    serializedValue: 'number:int',
    targetKind: 'number',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: MUTABLE_FLOAT,
    serializedValue: 'number:float',
    targetKind: 'number',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: MUTABLE_BOOL,
    serializedValue: 'bool',
    targetKind: 'boolean',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: MUTABLE_STRING,
    serializedValue: 'string',
    targetKind: 'string',
  },
  ...(
    [
      [MUTABLE_INT, 'number:int', 'number', 'int'],
      [MUTABLE_FLOAT, 'number:float', 'number', 'float'],
      [MUTABLE_BOOL, 'bool', 'boolean', 'bool'],
      [MUTABLE_STRING, 'string', 'string', 'string'],
    ] as const
  ).map(([datatype, serializedValue, targetKind, name]) => ({
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: inferred(datatype),
    serializedValue,
    targetKind,
  })),
];

/**
 * A field the scene stores as a NodePath (`node_paths`), whatever its object type (keyed by the
 * datatype's class): set to the node at the path once the scene's nodes all exist
 * (`SceneState::instantiate`, packed_scene.cpp:597).
 */
export const GODOT_4_7_NODE_REFERENCE_RULES: readonly GodotFieldValueRule[] = (['NATIVE:*', 'CLASS:*'] as const).map((datatype) => ({
  sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
  fieldDatatype: datatype,
  serializedValue: 'node-path',
  targetKind: 'node-reference',
}));
