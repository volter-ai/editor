/** Match source revisions to completed Vite updates, irrespective of channel
 * order. A websocket message alone is not evidence that an update applied.
 * Entries are bounded by current file paths, never by edit count.
 */
export interface RefreshSource {
  file: string;
  path: string;
  sha: string;
  timestamp?: number;
  /** Accepted importer URLs for a changed non-component dependency. */
  boundaries?: readonly string[];
}

function updateFile(path: string): string {
  return decodeURIComponent(path.split('?')[0]!)
    .replace(/^\/@fs\/(?=[A-Za-z]:\/)/, '')
    .replace(/^\/@fs/, '');
}

export class SourceRefreshRevisions {
  private readonly sources = new Map<string, RefreshSource>();
  private readonly applied = new Map<string, string>();
  private readonly expected = new Map<string, string | null>();
  private missingRevision = false;

  source(source: RefreshSource): void {
    this.sources.set(source.file, source);
  }

  complete(updates: readonly { acceptedPath: string; timestamp: number }[]): void {
    for (const [file, source] of this.sources) {
      const current = updates.filter((update) => source.timestamp === update.timestamp);
      const complete = source.boundaries
        ? source.boundaries.every((boundary) =>
            current.some((update) => update.acceptedPath === boundary),
          )
        : current.some((update) => updateFile(update.acceptedPath) === file);
      if (!complete) continue;
      this.applied.set(source.path, source.sha);
      this.sources.delete(file);
    }
  }

  matches(update: { acceptedPath: string; timestamp: number }): boolean {
    const file = updateFile(update.acceptedPath);
    return [...this.sources.values()].some(
      (source) =>
        source.timestamp === update.timestamp &&
        (source.boundaries
          ? source.boundaries.includes(update.acceptedPath)
          : source.file === file),
    );
  }

  revision(resources: readonly { path: string; sha: string | null }[]): void {
    for (const resource of resources) {
      this.expected.set(resource.path, resource.sha);
      if (resource.sha === null) this.applied.delete(resource.path);
    }
  }

  needsRemount(): boolean {
    if (this.missingRevision) return true;
    for (const [path, sha] of this.expected) {
      if (sha === null || this.applied.get(path) !== sha) return true;
    }
    return false;
  }

  missing(): void {
    this.missingRevision = true;
  }

  /** A completed cold mount consumed these revisions through ordinary source. */
  mounted(): void {
    this.expected.clear();
    this.applied.clear();
    this.sources.clear();
    this.missingRevision = false;
  }
}
