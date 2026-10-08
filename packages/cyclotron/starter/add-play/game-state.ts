// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.

/** What the play script publishes and the React UI draws: one value, and who to tell when it changes. */
export interface GameState {
  x: number;
  y: number;
  height: number;
  jumps: number;
}

let state: GameState = { x: 0, y: 0, height: 0, jumps: 0 };
const listeners = new Set<() => void>();

export const getGameState = (): GameState => state;

export function subscribeGameState(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishGameState(next: GameState): void {
  state = next;
  for (const listener of listeners) listener();
}
