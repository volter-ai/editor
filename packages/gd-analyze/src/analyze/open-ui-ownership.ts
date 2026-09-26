/**
 * Finite open-receiver ownership for UI/input members whose source annotation is broader than
 * the concrete runtime class. These declarations never grant behavior by spelling alone: emitted
 * Variant rows still select the retained concrete ClassDB owner and refuse every class outside
 * `runtimeOwners`.
 */

export type OpenUiAccess = 'property' | 'method';
export type OpenUiReceiverFamily = 'node' | 'control' | 'input-event' | 'resource';

export interface OpenUiOwnership {
  readonly member: string;
  readonly access: OpenUiAccess;
  readonly majors: readonly (3 | 4)[];
  readonly receiverFamilies: readonly OpenUiReceiverFamily[];
  readonly runtimeOwners: readonly string[];
  readonly result: string | null;
}

/** Every pinned InputEvent member remains owned by its concrete retained InputEvent subclass. */
export const OPEN_INPUT_EVENT_PROPERTY_INHERITANCE: OpenUiOwnership = {
  member: '*',
  access: 'property',
  majors: [3, 4],
  receiverFamilies: ['input-event', 'resource'],
  runtimeOwners: ['InputEvent'],
  result: null,
};

export const OPEN_INPUT_EVENT_METHOD_INHERITANCE: OpenUiOwnership = {
  ...OPEN_INPUT_EVENT_PROPERTY_INHERITANCE,
  access: 'method',
};

/**
 * Presentation members a broad Control may legally acquire from a concrete Control subclass.
 * Physics/audio/camera names intentionally stay out: no Control inheritance arm can own them.
 */
export const OPEN_CONTROL_PRESENTATION_MEMBERS: ReadonlySet<string> = new Set([
  'visible',
  'color',
  'text',
  'texture',
  'disabled',
  'editable',
  'placeholder_text',
  'button_pressed',
  'pressed',
  'selected',
  'current_tab',
  'item_count',
  'value',
  'min_value',
  'max_value',
  'hide',
  'show',
  'set_visible',
  'grab_focus',
  'release_focus',
  'has_focus',
]);

export const OPEN_CONTROL_PRESENTATION_INHERITANCE: OpenUiOwnership = {
  member: '*',
  access: 'property',
  majors: [3, 4],
  receiverFamilies: ['control'],
  runtimeOwners: ['Control'],
  result: null,
};

export const OPEN_UI_OWNERSHIP: readonly OpenUiOwnership[] = [
  {
    member: 'value',
    access: 'property',
    majors: [3, 4],
    receiverFamilies: ['node', 'control'],
    runtimeOwners: ['Range'],
    result: 'float',
  },
  {
    member: 'rect_position',
    access: 'property',
    majors: [3],
    receiverFamilies: ['node'],
    runtimeOwners: ['Control'],
    result: 'Vector2',
  },
  {
    member: 'rect_size',
    access: 'property',
    majors: [3],
    receiverFamilies: ['node'],
    runtimeOwners: ['Control'],
    result: 'Vector2',
  },
  {
    member: 'set_visible',
    access: 'method',
    majors: [3, 4],
    receiverFamilies: ['node'],
    runtimeOwners: ['CanvasItem'],
    result: null,
  },
  {
    member: 'position',
    access: 'property',
    majors: [3, 4],
    receiverFamilies: ['input-event', 'resource'],
    runtimeOwners: ['InputEventMouse', 'InputEventScreenTouch', 'InputEventScreenDrag'],
    result: 'Vector2',
  },
  {
    member: 'pressed',
    access: 'property',
    majors: [3, 4],
    receiverFamilies: ['input-event', 'resource'],
    runtimeOwners: [
      'InputEventAction',
      'InputEventKey',
      'InputEventMouseButton',
      'InputEventJoypadButton',
      'InputEventScreenTouch',
    ],
    result: 'bool',
  },
  {
    member: 'button_index',
    access: 'property',
    majors: [3, 4],
    receiverFamilies: ['input-event', 'resource'],
    runtimeOwners: ['InputEventMouseButton', 'InputEventJoypadButton'],
    result: 'int',
  },
  {
    member: 'relative',
    access: 'property',
    majors: [3, 4],
    receiverFamilies: ['input-event', 'resource'],
    runtimeOwners: ['InputEventMouseMotion', 'InputEventScreenDrag'],
    result: 'Vector2',
  },
];

export function openUiOwnershipFor(
  member: string,
  access: OpenUiAccess,
  major: 3 | 4,
): OpenUiOwnership | undefined {
  return OPEN_UI_OWNERSHIP.find(
    (candidate) =>
      candidate.member === member &&
      candidate.access === access &&
      candidate.majors.includes(major),
  );
}
