/**
 * Meter arithmetic over an `AudioAdapter`'s `AudioMeterFrame.level` — the one
 * place a linear RMS level becomes dBFS and a bar fill. Lives beside the
 * adapter because both readers of a level (the editor's header meter and the
 * `@vgai/game` audio debugger) are consumers of the adapter, and neither may
 * import the other.
 */

/** Linear RMS level → dBFS. Silence clamps to `floorDb` (log of 0 is -∞). */
export function levelToDb(level: number, floorDb = -60): number {
  if (!(level > 0)) return floorDb;
  return Math.max(floorDb, 20 * Math.log10(level));
}

/** Meter-bar fill percentage: dB-scaled from a -60 dBFS floor (a linear
 *  scale would pin every real-world level into the bottom pixels). 0 for
 *  silence, 100 at/above full scale. */
export function meterPercent(level: number, floorDb = -60): number {
  const db = levelToDb(level, floorDb);
  return Math.round(((db - floorDb) / -floorDb) * 100);
}
