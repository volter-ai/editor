/**
 * THE TWO VERDICTS a declared system slot can carry besides an adapter: a
 * positive ABSENCE with the game's own evidence, and a MALFORMED declaration
 * with the reason it could not be honoured.
 *
 * They are the contract's because the entry-module surface names them
 * (`./native-entry-surface.ts`'s `NativeSystemsBinding.absent`) and the
 * coverage report reads them; the projection that produces them is the game
 * runtime's (`@volter/editor-game/runtime/adapter/ingest/contract-system-adapters`).
 */

import type { VgaiGameSystemAdapters } from './game-contract';

/** One system slot of the game contract, by name. */
export type ContractSystemSlot = keyof VgaiGameSystemAdapters;

/** One slot the game positively answered as having nothing behind it. */
export interface ContractSystemEmptySlot {
  readonly slot: ContractSystemSlot;
  /** The game's own source-level evidence, verbatim. */
  readonly evidence: string;
}

/** One slot whose declaration could not be honoured, and why. */
export interface ContractSystemMalformedSlot {
  readonly slot: ContractSystemSlot;
  readonly reason: string;
}
