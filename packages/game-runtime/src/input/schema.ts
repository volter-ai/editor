// T4.6 — the `.inputmap.json` schema.
//
// Was TS-types-only (`input-types.ts`) until T4.6 authored this Zod schema.
// `InputManager.loadMap` (input-manager.ts) is this schema's runtime reader: it
// parses via this schema, then copies each action's `bindings` array (and its
// declared `valueType`, F1) straight into
// `this.actions`/`this.actionValueTypes`.
//
// Every field has a `.describe()` (repo policy — powers
// `scripts/generate-schema.ts` and the T4.1/T4.6 schema-walk coverage test).
// No runtime dependency beyond `zod`, matching the `scene/schema/` and
// `manifest/schema.ts` precedent.
//
// T4.1 history (now closed by F2): `mouse_move` and `gamepad_axis_pair` were
// authored-but-unhandled binding kinds — REJECTED at parse via a `.superRefine`
// that threw naming the field, mirroring the `scene/schema/ui.ts` dead-field
// mechanism. F2 (spec §12 "Complete Device Backends") un-rejects both: real
// `InputManager` readers now exist for them (`collectPointerDeltaContributions`/
// `collectVector2Contributions` — `mouse_move` feeds pointerDelta/vector2 from
// the existing mouseDelta accumulator; `gamepad_axis_pair` feeds vector2 from
// the coupled `xAxis`/`yAxis` gamepad reading). F2 also adds two new LIVE
// binding kinds, `touch_button`/`touch_stick` (the touch/virtual-control
// backend — see `InputManager.setTouchButton`/`setTouchStick`).
//
// F1 (spec §12 "Define Typed Action Values") adds:
//  - `InputAction.valueType` — an action now DECLARES its value shape
//    (`digital`/`scalar`/`vector2`/`pointerDelta`/`pointerPosition`),
//    defaulted to `digital` so every pre-F1 action stays valid unchanged.
//  - four new, LIVE (not dead-rejected) binding kinds — `test_axis`,
//    `test_vector2`, `test_pointer_delta`, `test_pointer_position` — the
//    "injected test input" backend F2's acceptance criteria names as a
//    peer of keyboard/mouse/gamepad/touch. They read back a caller-injected
//    raw value (InputManager.injectAxis/injectVector2/injectPointerDelta/
//    injectPointerPosition) through the SAME deadzone/normalize/combine path
//    real device bindings use.

import { z } from 'zod';
import type { InputAction, InputBinding, InputMapFile } from './input-types';

const KeyBindingSchema = z
  .object({
    type: z.literal('key').describe('Binding kind: a keyboard key (KeyboardEvent.code)'),
    code: z.string().describe('KeyboardEvent.code value, e.g. "KeyW", "Space", "ArrowUp"'),
  })
  .strict();

const MouseButtonBindingSchema = z
  .object({
    type: z.literal('mouse_button').describe('Binding kind: a mouse button'),
    button: z.number().describe('MouseEvent.button index (0 = left, 1 = middle, 2 = right)'),
  })
  .strict();

const MouseMoveBindingSchema = z
  .object({
    type: z
      .literal('mouse_move')
      .describe(
        'Binding kind: raw mouse movement (F2, spec §12 "Complete Device Backends"). Feeds a ' +
          "'pointerDelta'-valueType action with the raw accumulated mouse delta (no deadzone), and " +
          "can also feed a 'vector2'-valueType action (the same delta, radial-deadzoned + unit-" +
          'circle-clamped via `deadzone`).',
      ),
    deadzone: z
      .number()
      .optional()
      .describe(
        "Radial deadzone magnitude applied only when this binding feeds a 'vector2'-valueType " +
          "action (default 0 — no deadzone; ignored for 'pointerDelta' reads, which are never " +
          'deadzoned).',
      ),
  })
  .strict();

const GamepadButtonBindingSchema = z
  .object({
    type: z.literal('gamepad_button').describe('Binding kind: a gamepad face/shoulder button'),
    button: z.number().describe('Standard Gamepad API button index'),
  })
  .strict();

const GamepadAxisBindingSchema = z
  .object({
    type: z.literal('gamepad_axis').describe('Binding kind: a single thresholded gamepad axis'),
    axis: z.number().describe('Standard Gamepad API axis index'),
    direction: z
      .enum(['positive', 'negative'])
      .describe('Which side of the deadzone counts as "pressed"'),
    deadzone: z.number().optional().describe('Deadzone magnitude (default 0.15 if omitted)'),
  })
  .strict();

const GamepadAxisPairBindingSchema = z
  .object({
    type: z
      .literal('gamepad_axis_pair')
      .describe(
        'Binding kind: a coupled (x, y) gamepad axis pair, e.g. a stick used as a 2D vector ' +
          '(look/aim/movement) (F2, spec §12 "Complete Device Backends"). Feeds a ' +
          "'vector2'-valueType action: (xAxis, yAxis) read together, radial-deadzoned + unit-" +
          'circle-clamped the same way a real analog stick is.',
      ),
    xAxis: z.number().describe('Standard Gamepad API axis index for the X component'),
    yAxis: z.number().describe('Standard Gamepad API axis index for the Y component'),
    deadzone: z.number().optional().describe('Deadzone magnitude (default 0.15 if omitted)'),
  })
  .strict();

// ---------------------------------------------------------------------------
// F1 (spec §12) — injected test input bindings. LIVE (real runtime readers in
// InputManager's getScalar/getVector2/getPointerDelta/getPointerPosition),
// unlike the two dead stubs above. Foreshadows F2's "injected test input"
// backend: real device kinds F2 adds later feed the same typed-value
// aggregation path these exercise today.
// ---------------------------------------------------------------------------

const TestAxisBindingSchema = z
  .object({
    type: z
      .literal('test_axis')
      .describe(
        "Binding kind: an injected synthetic scalar value for a 'scalar'-valueType action " +
          '(InputManager.injectAxis/getScalar) — the "injected test input" backend named in F2, ' +
          "built in F1 as the typed scalar value model's testable source.",
      ),
    sourceId: z
      .string()
      .describe('Names the injected test source this binding reads (InputManager.injectAxis).'),
    deadzone: z
      .number()
      .optional()
      .describe(
        '1D deadzone magnitude applied to the injected raw value before combine (default 0 — no ' +
          'deadzone). Values below it read as 0; values at/above it rescale from 0 (at the ' +
          'deadzone edge) to ±1 (at |raw| = 1), sign preserved.',
      ),
  })
  .strict();

const TestVector2BindingSchema = z
  .object({
    type: z
      .literal('test_vector2')
      .describe(
        "Binding kind: an injected synthetic {x,y} value for a 'vector2'-valueType action " +
          '(InputManager.injectVector2/getVector2) — the "injected test input" backend named in ' +
          "F2, built in F1 as the typed Vector2 value model's testable source.",
      ),
    sourceId: z
      .string()
      .describe('Names the injected test source this binding reads (InputManager.injectVector2).'),
    deadzone: z
      .number()
      .optional()
      .describe(
        'Radial deadzone magnitude applied to the injected raw {x,y} before combine (default 0 ' +
          '— no deadzone). Vectors whose magnitude is below it read as {0,0}; at/above it, ' +
          'direction is preserved and magnitude rescales the same way the scalar deadzone does, ' +
          'then the result is clamped to the unit circle (magnitude <= 1).',
      ),
  })
  .strict();

const TestPointerDeltaBindingSchema = z
  .object({
    type: z
      .literal('test_pointer_delta')
      .describe(
        "Binding kind: an injected synthetic per-frame {x,y} delta for a 'pointerDelta'-" +
          'valueType action (InputManager.injectPointerDelta/getPointerDelta) — the "injected ' +
          'test input" backend named in F2. No deadzone (deltas are not deadzoned).',
      ),
    sourceId: z
      .string()
      .describe(
        'Names the injected test source this binding reads (InputManager.injectPointerDelta).',
      ),
  })
  .strict();

const TestPointerPositionBindingSchema = z
  .object({
    type: z
      .literal('test_pointer_position')
      .describe(
        "Binding kind: an injected synthetic absolute {x,y} position for a 'pointerPosition'-" +
          'valueType action (InputManager.injectPointerPosition/getPointerPosition) — the ' +
          '"injected test input" backend named in F2.',
      ),
    sourceId: z
      .string()
      .describe(
        'Names the injected test source this binding reads (InputManager.injectPointerPosition).',
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// F2 (spec §12 "Complete Device Backends") — touch/virtual-control bindings.
// LIVE (real runtime readers in InputManager's isPressed/isJustPressed/
// isJustReleased/getDigitalSource and getVector2), driven by
// InputManager.setTouchButton/setTouchStick — the headless-testable
// injectable entry points a real on-screen touch-control UI's own
// touchstart/touchmove/touchend handlers would call (that DOM wiring is a
// thin adapter at the edge, out of scope here — see input-manager.ts).
// ---------------------------------------------------------------------------

const TouchButtonBindingSchema = z
  .object({
    type: z
      .literal('touch_button')
      .describe(
        "Binding kind: a virtual on-screen button for a 'digital' action " +
          '(InputManager.setTouchButton/isPressed) — edge-tracked (isJustPressed/isJustReleased) ' +
          'the same way a real mouse/keyboard button is.',
      ),
    sourceId: z
      .string()
      .describe(
        'Names the virtual control zone this binding reads (InputManager.setTouchButton) — a ' +
          'touch-UI-chosen id, not a real device index.',
      ),
  })
  .strict();

const TouchStickBindingSchema = z
  .object({
    type: z
      .literal('touch_stick')
      .describe(
        "Binding kind: a virtual on-screen analog stick for a 'vector2' action " +
          '(InputManager.setTouchStick/getVector2) — radial-deadzoned + unit-circle-clamped the ' +
          'same way a real gamepad stick is.',
      ),
    sourceId: z
      .string()
      .describe(
        'Names the virtual control zone this binding reads (InputManager.setTouchStick) — a ' +
          'touch-UI-chosen id, not a real device index.',
      ),
    deadzone: z
      .number()
      .optional()
      .describe(
        'Radial deadzone magnitude applied to the raw {x,y} before combine (default 0 — no ' +
          'deadzone).',
      ),
  })
  .strict();

/** A single input binding. Every kind listed here is LIVE — F2 (spec §12) closed the last two
 *  dead stubs (`mouse_move`/`gamepad_axis_pair`) by giving both real `InputManager` readers. */
export const InputBindingSchema: z.ZodType<InputBinding> = z.discriminatedUnion('type', [
  KeyBindingSchema,
  MouseButtonBindingSchema,
  MouseMoveBindingSchema,
  GamepadButtonBindingSchema,
  GamepadAxisBindingSchema,
  GamepadAxisPairBindingSchema,
  TestAxisBindingSchema,
  TestVector2BindingSchema,
  TestPointerDeltaBindingSchema,
  TestPointerPositionBindingSchema,
  TouchButtonBindingSchema,
  TouchStickBindingSchema,
]) as z.ZodType<InputBinding>;

/** An action has a name (the record key) and one or more bindings. */
export const InputActionSchema: z.ZodType<InputAction> = z
  .object({
    valueType: z
      .enum(['digital', 'scalar', 'vector2', 'pointerDelta', 'pointerPosition'])
      .default('digital')
      .describe(
        "This action's declared value shape (F1, spec §12). 'digital' (boolean, with " +
          'pressed/justPressed/justReleased edges) is the default when omitted, matching every ' +
          "action authored before F1. 'scalar' is a single deadzone-rescaled float axis. " +
          "'vector2' is a radial-deadzoned, unit-circle-normalized {x,y}. 'pointerDelta' is a " +
          "per-frame {x,y} movement delta, summed across sources. 'pointerPosition' is an " +
          'absolute {x,y}, last-write-wins across sources. InputManager enforces this at read ' +
          'time: reading an action through the wrong typed getter (e.g. getScalar on a ' +
          "'digital' action) throws.",
      ),
    bindings: z
      .array(InputBindingSchema)
      .describe(
        'Bindings that all trigger/feed this action. Digital actions combine via OR (any one ' +
          'binding satisfied is enough). Scalar actions combine via max-magnitude across ' +
          'contributing bindings (ties keep the first-listed binding). Vector2 actions combine ' +
          'by summing contributing {x,y} values then clamping to the unit circle. PointerDelta ' +
          'actions sum contributing deltas. PointerPosition actions use the most-recently-' +
          'written contributing source (last-write-wins).',
      ),
  })
  .strict();

/**
 * The `.inputmap.json` file format (`InputManager.loadMap`).
 *
 * `version` is RESERVED (no range-check reader exists yet for this format —
 * same convention `2d.version`/`Scene2DSchema` used before T2.3 gave the 3D
 * scene version axis a real reader; see `schema-consumption-map.ts`).
 */
export const InputMapFileSchema: z.ZodType<InputMapFile> = z
  .object({
    version: z.number().describe('Input map file format version (RESERVED — no range check yet)'),
    actions: z
      .record(z.string(), InputActionSchema)
      .describe('Named actions, each with a list of bindings (InputManager.loadMap)'),
  })
  .strict() as z.ZodType<InputMapFile>;
