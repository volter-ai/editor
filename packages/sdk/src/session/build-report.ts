/**
 * Transient facts about one native project build. The report crosses the
 * editor server's existing export SSE response; it is not persisted as a
 * project document or sidecar. Paths are relative to the project's `dist/`.
 */
/** The web build's download name: `<project-slug>-web.zip`. */
export function webBuildArtifactName(projectSlug: string): string {
  return `${projectSlug}-web.zip`;
}

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
