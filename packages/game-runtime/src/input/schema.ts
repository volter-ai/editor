// T4.6 — the `.inputmap.json` schema.
//
// The shape a game's own `.inputmap.json` follows: named actions, each with a
// declared `valueType` and its device bindings. No runtime here reads it — a
// game's own input code does — and the template's `validate-asset-content.ts`
// checks a project's maps against it.
//
// Every field has a `.describe()` (repo policy — powers
// `scripts/generate-schema.ts`). No runtime dependency beyond `zod`.

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
// F1 (spec §12) — injected test input bindings: a caller-injected raw value
// read through the same typed-value path as a device binding.
// ---------------------------------------------------------------------------

const TestAxisBindingSchema = z
  .object({
    type: z
      .literal('test_axis')
      .describe(
        "Binding kind: an injected synthetic scalar value for a 'scalar'-valueType action " +
          ' — the "injected test input" backend named in F2, ' +
          "built in F1 as the typed scalar value model's testable source.",
      ),
    sourceId: z
      .string()
      .describe('Names the injected test source this binding reads.'),
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
          ' — the "injected test input" backend named in ' +
          "F2, built in F1 as the typed Vector2 value model's testable source.",
      ),
    sourceId: z
      .string()
      .describe('Names the injected test source this binding reads.'),
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
          'valueType action — the "injected ' +
          'test input" backend named in F2. No deadzone (deltas are not deadzoned).',
      ),
    sourceId: z
      .string()
      .describe(
        'Names the injected test source this binding reads.',
      ),
  })
  .strict();

const TestPointerPositionBindingSchema = z
  .object({
    type: z
      .literal('test_pointer_position')
      .describe(
        "Binding kind: an injected synthetic absolute {x,y} position for a 'pointerPosition'-" +
          'valueType action — the ' +
          '"injected test input" backend named in F2.',
      ),
    sourceId: z
      .string()
      .describe(
        'Names the injected test source this binding reads.',
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// F2 (spec §12 "Complete Device Backends") — touch/virtual-control bindings:
// a named on-screen control zone the game's own touch UI writes.
// ---------------------------------------------------------------------------

const TouchButtonBindingSchema = z
  .object({
    type: z
      .literal('touch_button')
      .describe(
        "Binding kind: a virtual on-screen button for a 'digital' action " +
          ' — edge-tracked (isJustPressed/isJustReleased) ' +
          'the same way a real mouse/keyboard button is.',
      ),
    sourceId: z
      .string()
      .describe(
        'Names the virtual control zone this binding reads — a ' +
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
          ' — radial-deadzoned + unit-circle-clamped the ' +
          'same way a real gamepad stick is.',
      ),
    sourceId: z
      .string()
      .describe(
        'Names the virtual control zone this binding reads — a ' +
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

/** A single input binding. */
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
          'absolute {x,y}, last-write-wins across sources.',
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
 * The `.inputmap.json` file format.
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
      .describe('Named actions, each with a list of bindings'),
  })
  .strict() as z.ZodType<InputMapFile>;
