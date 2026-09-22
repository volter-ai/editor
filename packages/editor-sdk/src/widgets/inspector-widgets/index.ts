/**
 * The figma-grade inspector widget kit (spec 27 §5 C1). PURE,
 * contract-driven components — `value` + `onChange` (+ optional
 * `onChangeEnd` for the commit tick, see `shared.tsx`'s `ChangeHandlers<T>`
 * doc comment). The kit stays contract-pure: widgets never import editor
 * state, which is what lets the whole directory sit in the Apache face.
 *
 * This is an INTERNAL barrel — `../index.ts` is the published door
 * (`@volter/editor-sdk/widgets`), and it re-exports this whole surface.
 */

export * from './AlignmentGrid';
export * from './AssetSlotPicker';
export * from './BorderEditor';
export * from './ColorPicker';
export * from './CurveEditor';
export type { ColorFormat } from './color-utils';
export * from './curve-utils';
export * from './FilterEditor';
export * from './FontPicker';
export * from './GradientEditor';
export * from './ScrubbableInput';
export * from './ShadowEditor';
export * from './shared';
