export type PreviewResourceKind =
  | 'webglContext'
  | 'animationFrame'
  | 'resizeObserver'
  | 'objectUrl';

export interface PreviewResourceSnapshot {
  webglContext: number;
  animationFrame: number;
  resizeObserver: number;
  objectUrl: number;
  peaks: Record<PreviewResourceKind, number>;
}

const current: Record<PreviewResourceKind, number> = {
  webglContext: 0,
  animationFrame: 0,
  resizeObserver: 0,
  objectUrl: 0,
};
const peaks = { ...current };

/** Local diagnostic counter used by stress tests and the Debugger; never uploads identifiers. */
export function registerPreviewResource(kind: PreviewResourceKind): () => void {
  current[kind]++;
  peaks[kind] = Math.max(peaks[kind], current[kind]);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current[kind] = Math.max(0, current[kind] - 1);
  };
}

export function previewResourceSnapshot(): PreviewResourceSnapshot {
  return { ...current, peaks: { ...peaks } };
}

export function resetPreviewResourceCounters(): void {
  for (const key of Object.keys(current) as PreviewResourceKind[]) {
    current[key] = 0;
    peaks[key] = 0;
  }
}
