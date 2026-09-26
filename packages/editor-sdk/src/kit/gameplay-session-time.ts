/** Map the editor's Play-relative cursor onto a recording that may have
 * started later than Play. Both starts are wall-clock milliseconds. */
export function gameplayRecordingMediaTimeMs(
  sessionStartedAt: number,
  recordingStartedAt: number | null,
  cursorMs: number,
): number {
  return Math.max(0, sessionStartedAt + cursorMs - (recordingStartedAt ?? sessionStartedAt));
}
