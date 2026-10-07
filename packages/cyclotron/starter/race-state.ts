// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.
/** One race's state, shared by its play script and React DOM root in one mount. */
export interface RaceState {
  readonly lap: number;
  readonly lapTime: number;
  readonly lastLap: number;
  readonly speed: number;
  readonly fps: number;
  readonly airborne: boolean;
}
let state: RaceState = { lap: 1, lapTime: 0, lastLap: 0, speed: 0, fps: 0, airborne: false };
const listeners = new Set<() => void>();
export const getRaceState = (): RaceState => state;
export const subscribeRaceState = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function publishRaceState(next: RaceState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}
