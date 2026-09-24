// A framework-free rebinding STATE MACHINE over an `InputManager`.
// Deliberately has no dependency on React (or any UI library): "listen for the
// next input, surface a conflict, let the caller decide" is the same flow
// whether the caller is a React panel or a CLI. Keeping the logic here makes
// it unit-testable with no DOM/JSX at all, and leaves any UI a thin,
// mechanically-verifiable wrapper.
//
// Flow: `listen(actionName)` -> caller captures the next raw input event
// itself (a keydown, a gamepad poll, a touch tap — capture is inherently
// device-specific and NOT this class's job) and turns it into an
// `InputBinding`, then calls `capture(binding)`. If the proposed binding is
// free, it's applied immediately and the state becomes `'applied'`. If it
// collides with another action's existing binding (per
// `InputManager.findConflicts`), the state becomes `'conflict'`, carrying the
// structured conflict list for the UI to show — the caller then calls either
// `resolveOverride()` (apply anyway) or `cancel()`.

import type { InputManager } from './input-manager';
import type { BindingConflict, InputBinding } from './input-types';

/** How a captured binding is applied once accepted. */
export type RebindMode = 'replace' | 'add';

export type RebindState =
  | { status: 'idle' }
  | { status: 'listening'; actionName: string; mode: RebindMode; index: number }
  | {
      status: 'conflict';
      actionName: string;
      mode: RebindMode;
      index: number;
      proposed: InputBinding;
      conflicts: BindingConflict[];
    }
  | { status: 'applied'; actionName: string; binding: InputBinding };

export class RebindController {
  private state: RebindState = { status: 'idle' };

  constructor(private readonly input: InputManager) {}

  getState(): RebindState {
    return this.state;
  }

  /**
   * Enter listening mode for `actionName`. `mode: 'replace'` (default)
   * rebinds the slot at `index` (default 0 — the action's first/primary
   * binding); `mode: 'add'` appends a new binding alongside the existing
   * ones instead (`index` is ignored for `'add'`).
   */
  listen(actionName: string, mode: RebindMode = 'replace', index = 0): void {
    this.state = { status: 'listening', actionName, mode, index };
  }

  /** Abandon listening/a pending conflict with no changes applied. */
  cancel(): void {
    this.state = { status: 'idle' };
  }

  /**
   * Feed a captured raw `InputBinding` while in the `'listening'` state
   * (a no-op returning the current state unchanged otherwise — e.g. a stray
   * keypress arriving after the UI already cancelled). Checks
   * `InputManager.findConflicts` first: a free binding is applied
   * immediately (-> `'applied'`); a colliding one transitions to
   * `'conflict'` instead of applying, so the UI can surface it before
   * anything changes.
   */
  capture(binding: InputBinding): RebindState {
    if (this.state.status !== 'listening') return this.state;
    const { actionName, mode, index } = this.state;
    const conflicts = this.input.findConflicts(binding, actionName);
    if (conflicts.length > 0) {
      this.state = { status: 'conflict', actionName, mode, index, proposed: binding, conflicts };
      return this.state;
    }
    this.apply(actionName, mode, index, binding);
    this.state = { status: 'applied', actionName, binding };
    return this.state;
  }

  /**
   * From a `'conflict'` state, apply the pending proposed binding anyway
   * (the UI decided the collision is acceptable, e.g. "steal this binding").
   * Does NOT remove the colliding binding from the other action — that is a
   * separate, explicit `InputManager.removeBinding` call the UI can make
   * first if it wants a true swap. A no-op (returns current state) unless a
   * conflict is pending.
   */
  resolveOverride(): RebindState {
    if (this.state.status !== 'conflict') return this.state;
    const { actionName, mode, index, proposed } = this.state;
    this.apply(actionName, mode, index, proposed);
    this.state = { status: 'applied', actionName, binding: proposed };
    return this.state;
  }

  private apply(actionName: string, mode: RebindMode, index: number, binding: InputBinding): void {
    if (mode === 'add') this.input.addBinding(actionName, binding);
    else this.input.replaceBinding(actionName, index, binding);
  }
}
