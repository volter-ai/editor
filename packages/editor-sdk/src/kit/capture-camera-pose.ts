/**
 * THE FREE CAPTURE CAMERA AND CLIP POSE, validated at the relay boundary —
 * `--azimuth/--elevation/--distance` and `--clip/--time` as they arrive on a
 * capture command.
 *
 * Extracted from `command-listener.ts:1016,1053`, where both parsers were
 * private to that module and already served TWO verbs:
 * `capture-asset-preview`, which stays in that table, and
 * `capture-story-variants`, which carries its own relay budget and so is a
 * registered command (`stories/story-capture-command.ts`). Two callers before
 * the move and two after; nothing here is new.
 *
 * THE VERB NAMES ITSELF. Both refusals used to spell `capture-asset-preview`
 * unconditionally, so a bad `--azimuth` on `vgai screenshot <module>.stories.tsx`
 * refused in the name of a command the caller never ran. The verb is a
 * parameter now, which the extraction is what made visible.
 */

/** Validate an untrusted `camera` payload: the parsed choice, `undefined` when
 *  absent, or the refusal message naming `verb`. */
export function parseCameraChoice(
  verb: string,
  value: unknown,
): { azimuthDegrees: number; elevationDegrees: number; distance?: number } | undefined | string {
  if (value === undefined) return undefined;
  const record = value as {
    azimuthDegrees?: unknown;
    elevationDegrees?: unknown;
    distance?: unknown;
  } | null;
  if (
    record === null ||
    typeof record !== 'object' ||
    typeof record.azimuthDegrees !== 'number' ||
    !Number.isFinite(record.azimuthDegrees) ||
    typeof record.elevationDegrees !== 'number' ||
    !Number.isFinite(record.elevationDegrees) ||
    record.elevationDegrees < -90 ||
    record.elevationDegrees > 90 ||
    (record.distance !== undefined &&
      (typeof record.distance !== 'number' ||
        !Number.isFinite(record.distance) ||
        record.distance <= 0))
  ) {
    return (
      `${verb} camera must be {azimuthDegrees, elevationDegrees in [-90, 90], ` +
      'distance? > 0 meters}.'
    );
  }
  return {
    azimuthDegrees: record.azimuthDegrees,
    elevationDegrees: record.elevationDegrees,
    ...(record.distance === undefined ? {} : { distance: record.distance }),
  };
}

/** Validate an untrusted `pose` payload: the parsed pose, `undefined` when
 *  absent, or the refusal message naming `verb`. */
export function parsePoseChoice(
  verb: string,
  value: unknown,
): { clip: string; timeSeconds: number } | undefined | string {
  if (value === undefined) return undefined;
  const record = value as { clip?: unknown; timeSeconds?: unknown } | null;
  if (
    record === null ||
    typeof record !== 'object' ||
    typeof record.clip !== 'string' ||
    record.clip.length === 0 ||
    typeof record.timeSeconds !== 'number' ||
    !Number.isFinite(record.timeSeconds) ||
    record.timeSeconds < 0
  ) {
    return `${verb} pose must be {clip: non-empty string, timeSeconds >= 0}.`;
  }
  return { clip: record.clip, timeSeconds: record.timeSeconds };
}
