import { useSyncExternalStore } from 'react';
import { getArenaState, subscribeArenaState } from '../arena-state';
import { ArenaHud } from './arena-hud';

/** Live React-root connector. Storybook renders ArenaHud directly with authored
 *  state.
 *
 *  This root reads the game's OWN store directly — `arena-state.ts` publishes
 *  a snapshot per change, and `useSyncExternalStore` re-renders on exactly
 *  those. No host state bridge, no polling: game UI over game state. */
export default function ArenaHudWorld() {
  const state = useSyncExternalStore(subscribeArenaState, getArenaState, getArenaState);
  return <ArenaHud state={state} />;
}
