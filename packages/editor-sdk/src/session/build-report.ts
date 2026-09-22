/**
 * Transient facts about one native project build. The report crosses the
 * editor server's existing export SSE response; it is not persisted as a
 * project document or sidecar. Paths are relative to the project's `dist/`.
 */
export const WEB_BUILD_ARTIFACT = 'vgai-web.zip';

export interface BuildReportFile {
  readonly path: string;
  readonly bytes: number;
}

export interface BuildReport {
  readonly artifact: string;
  readonly artifactBytes: number;
  readonly outputBytes: number;
  readonly fileCount: number;
  readonly largestFiles: readonly BuildReportFile[];
}
