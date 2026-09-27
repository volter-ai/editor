import { createHash } from 'node:crypto';
import type { GodotProofIdentities, GodotProofName } from '../../godot-frontend/proof-identities';

/** The two pinned executables every proof runs. */
export interface GodotProofTools {
  /** The official editor whose run is the native side. */
  readonly officialBinary: string;
  readonly exporterBinary: string;
  /**
   * The official editor the target pipeline imports with (its toolchain pin), when the native side
   * runs another release (`evidence --godot 4.6`); else `officialBinary`.
   */
  readonly pipelineOfficialBinary?: string;
}

/** One proof's run: the identities it measured and whether native and target agreed. */
export interface GodotProofMeasurement {
  readonly name: GodotProofName;
  readonly identities: GodotProofIdentities;
  readonly agree: boolean;
  /** What each side observed, printed when they disagree. */
  readonly detail: string;
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}
