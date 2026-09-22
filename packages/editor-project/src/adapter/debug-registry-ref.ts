/**
 * The game-scoped debug registry AS THE SEAM SEES IT — a reference a binding
 * carries, and the one member the seam reads off it.
 *
 * The contract does not restate `@vgai/game-runtime/runtime/debug-registry`'s
 * `DebugRegistry`: that interface names the game runtime's own vocabulary
 * (`DebugCtxSurface`, `InputManager`, `Game`, the run-ticks target), and
 * moving it here would put the game host's debugger inside the project
 * contract. Nothing across this seam calls the registry — the binding holds
 * the reference so the host can hand it back to whoever created it — so the
 * structural shape is the adapter it seeds, and `DebugRegistry` satisfies it.
 */

import type { DebugAdapter } from './system-adapter';

export interface DebugRegistryRef {
  /** The `SystemAdapters.debug` implementer this registry seeds. */
  readonly adapter: DebugAdapter;
}
