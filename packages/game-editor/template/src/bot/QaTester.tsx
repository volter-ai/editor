/**
 * The QA tester's HANDS ON THE FRAME — the one piece of the playtesting loop
 * that must live in the world tree, because acting through input each sim
 * tick IS frame work. Everything else about the tester (its doors, its run
 * state, its repertoire) is plain application code in
 * `src/bot/tester-station.ts`, reached directly as a running module by the
 * Tester contribution and `vgai eval`.
 *
 * The tester's hands run in the INPUT phase — before everything. Fiber sorts
 * `useFrame` callbacks ascending, and this world's own behavior hooks sit at
 * 0 (game logic / animation) or -1 (a movement solve landing before
 * `<Physics>` steps). A virtual action must already be written when the first
 * of those reads it, so the tester runs below the lot of them. Negative by
 * necessity, never positive: a positive priority takes over rendering and
 * blacks out the world (check-idioms W8).
 *
 * Cost when idle: one no-op frame callback. Nothing rendered.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect } from 'react';
import { stepTester, stopTesterForUnmount } from './tester-station';

const TESTER_FRAME_PRIORITY = -100;

export function QaTester() {
  // A run cannot outlive the frame that steps it: stopping Play unmounts this
  // component, and the cleanup ends any run still seated so the next session
  // starts clean.
  useEffect(() => stopTesterForUnmount, []);
  useFrame((_, dt) => {
    stepTester(dt);
  }, TESTER_FRAME_PRIORITY);
  return null;
}
