/** Script-visible MainLoop lifecycle and permission-result signal. */

import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';

export interface GodotMainLoopHooks {
  readonly initialize?: () => void;
  readonly physicsProcess?: (delta: number) => boolean;
  readonly process?: (delta: number) => boolean;
  readonly finalize?: () => void;
}

function deltaValue(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`MainLoop.${member} delta requires a non-negative finite number.`);
  }
  return value;
}

export class GodotMainLoop {
  private readonly permissionResult = createSignal<[permission: string, granted: boolean]>();
  private initialized = false;
  private finalized = false;
  private hooks: GodotMainLoopHooks;

  readonly on_request_permissions_result: GodotSignal<[permission: string, granted: boolean]> =
    this.permissionResult.signal;

  constructor(hooks: GodotMainLoopHooks = {}) {
    this.hooks = hooks;
    registerGodotObjectIdentity(this, 'MainLoop');
  }

  set_hooks(hooks: GodotMainLoopHooks): void {
    if (typeof hooks !== 'object' || hooks === null) throw new TypeError('MainLoop hooks require an object.');
    this.hooks = hooks;
  }

  _initialize(): void {
    if (this.initialized && !this.finalized) return;
    this.initialized = true;
    this.finalized = false;
    this.hooks.initialize?.();
  }

  _physics_process(delta: unknown): boolean {
    if (!this.initialized || this.finalized) return true;
    return this.hooks.physicsProcess?.(deltaValue(delta, '_physics_process')) === true;
  }

  _process(delta: unknown): boolean {
    if (!this.initialized || this.finalized) return true;
    return this.hooks.process?.(deltaValue(delta, '_process')) === true;
  }

  _finalize(): void {
    if (!this.initialized || this.finalized) return;
    this.finalized = true;
    this.hooks.finalize?.();
  }

  emit_permission_result(permission: unknown, granted: unknown): void {
    if (typeof permission !== 'string') throw new TypeError('MainLoop permission requires String.');
    this.permissionResult.emit(permission, Boolean(granted));
  }

  is_initialized(): boolean { return this.initialized && !this.finalized; }
  is_finalized(): boolean { return this.finalized; }
}

export function createGodotMainLoop(hooks: GodotMainLoopHooks = {}): GodotMainLoop {
  return new GodotMainLoop(hooks);
}
