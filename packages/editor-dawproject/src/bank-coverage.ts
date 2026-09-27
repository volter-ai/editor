/**
 * WHICH KEYS A PATCH CAN SOUND: a loaded bank's preset (by bank number and program, or a drum kit
 * by program), through its preset zones to its instruments' zones, each zone's key range
 * intersected with its preset zone's. A note outside that set sounds nothing, and nothing else
 * says so: the practical ranges by General MIDI program (`checks.ts`) knew nothing of the bank,
 * and a C3 on VS Chamber Orchestra's violin section (whose samples start at G3) rendered as
 * silence while the checks passed.
 */

import type { BasicSoundBank } from 'spessasynth_core';

interface RangeLike {
  readonly min: number;
  readonly max: number;
}
interface ZoneLike {
  readonly keyRange: RangeLike;
  readonly hasKeyRange: boolean;
}

function range(zone: ZoneLike): [number, number] {
  return zone.hasKeyRange ? [Math.max(0, zone.keyRange.min), Math.min(127, zone.keyRange.max)] : [0, 127];
}

/** The keys the patch sounds, or `null` when the bank has no such preset. */
export function soundingKeys(bank: BasicSoundBank, bankMSB: number, program: number, drums: boolean): Set<number> | null {
  const preset = bank.presets.find((candidate) =>
    drums ? candidate.isGMGSDrum && candidate.program === program : !candidate.isGMGSDrum && candidate.bankMSB === bankMSB && candidate.program === program,
  );
  if (!preset) return null;
  const keys = new Set<number>();
  for (const presetZone of preset.zones) {
    const [presetLow, presetHigh] = range(presetZone);
    for (const zone of presetZone.instrument.zones) {
      const [low, high] = range(zone);
      for (let key = Math.max(low, presetLow); key <= Math.min(high, presetHigh); key++) keys.add(key);
    }
  }
  return keys;
}
