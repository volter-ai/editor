/**
 * A DOCUMENT'S SECOND AREA, and the host chrome it borrows.
 *
 * The host draws one header strip over a document (the document's own header, then the stage's
 * controls) and one tool shelf at its leading edge. A document that divides its body into two
 * AREAS side by side (Blender's split 3D viewport) needs that chrome divided the same way,
 * because each of Blender's areas carries its own header over itself and its own tool shelf. So
 * the document declares its second area ({@link setDocumentSecondArea}):
 *
 *  - `headerWidth`: the host reserves that width at the strip's trailing edge, after its own
 *    controls, which then end where the first area ends, and hands the region's element back
 *    ({@link documentSecondAreaHeader}) for the document to draw the second area's header in;
 *  - `shelf`: an element inside the second area, which the host fills with the same tool strip
 *    its own shelf carries (the tools are the workspace's, not an area's).
 *
 * With no second area declared, the host draws its chrome as it always does.
 */
export interface DocumentSecondArea {
  readonly headerWidth: number;
  readonly shelf: HTMLElement | null;
}

const areas = new Map<string, DocumentSecondArea>();
const headers = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version++;
  for (const listener of [...listeners]) listener();
}

/** Declare `documentId`'s second area, or remove it with null. */
export function setDocumentSecondArea(documentId: string, area: DocumentSecondArea | null): void {
  const current = areas.get(documentId);
  const width = area === null ? null : Math.max(0, Math.round(area.headerWidth));
  if (area === null ? current === undefined : current?.headerWidth === width && current.shelf === area.shelf) return;
  if (area === null || width === null) areas.delete(documentId);
  else areas.set(documentId, { headerWidth: width, shelf: area.shelf });
  changed();
}

/** `documentId`'s second area, or null. */
export function documentSecondArea(documentId: string): DocumentSecondArea | null {
  return areas.get(documentId) ?? null;
}

/** The host's header region for the second area, once drawn; null before and after. */
export function documentSecondAreaHeader(documentId: string): HTMLElement | null {
  return headers.get(documentId) ?? null;
}

/** Called by the host as it draws and removes the second area's header region. */
export function bindDocumentSecondAreaHeader(documentId: string, element: HTMLElement | null): void {
  if ((headers.get(documentId) ?? null) === element) return;
  if (element === null) headers.delete(documentId);
  else headers.set(documentId, element);
  changed();
}

export function subscribeDocumentAreas(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function documentAreasVersion(): number {
  return version;
}
