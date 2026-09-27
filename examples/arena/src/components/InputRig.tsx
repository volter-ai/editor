/**
 * The input store's devices and frame tick — mount once, before the mechanics that read
 * input. The BRACKET is `frameInput` in `src/lib/input`, beside the store
 * whose frame contract it is; this component is only the R3F glue that calls
 * it once per frame. Deeply negative fiber priority so every action is already
 * written when the first mechanic hook (0 / -1) or the QA tester (-100) runs.
 * Negative by necessity, never positive: a positive priority takes over
 * rendering (check-idioms W8).
 */

import { useFrame } from '@react-three/fiber';
import { useEffect } from 'react';
import { attachInputDevices, ensureInputMap, frameInput } from '../lib/input';

const INPUT_FRAME_PRIORITY = -200;

export function InputRig({ mapUrl }: { mapUrl?: string } = {}) {
  useEffect(() => {
    ensureInputMap(mapUrl);
  }, [mapUrl]);
  // The keyboard and mouse listeners live exactly as long as this world.
  useEffect(() => attachInputDevices(window), []);
  useFrame(frameInput, INPUT_FRAME_PRIORITY);
  return null;
}
