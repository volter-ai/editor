/** Optional document capability. A tool owns its controls, state and runner;
 * a document kind owns the detached stage it lends that runner. Products name
 * neither side. The page-wide registry joins packaged and served contributions. */
import type { ComponentType } from 'react';

export interface DocumentPlayControlProps {
  readonly documentId: string | undefined;
  readonly onClose: () => void;
}
export interface DocumentPlayStage {
  readonly documentId: string;
  readonly sourcePath: string;
  readonly root: unknown;
  readonly camera: () => unknown;
  /** The editing area's current draw camera, before handing its view to Play. */
  readonly editingCamera: () => unknown;
  readonly onFrame: (fn: (seconds: number) => void) => () => void;
  readonly report: (title: string, detail: string) => void;
  readonly container: HTMLElement;
  /** The runner has updated its first drawable frame. */
  readonly ready: () => void;
  /** The return camera is approaching the editing pose; fade authoring chrome back in. */
  readonly returning: () => void;
  /** A copy of one of `root`'s materials that one object can wear alone and a runner can
   *  recolour, keeping the document's own draw hooks; null for a material that is not the
   *  document's. Absent, a runner clones. */
  readonly ownMaterial?: (material: unknown) => unknown;
}
export interface DocumentPlayExtension {
  readonly Control: ComponentType<DocumentPlayControlProps>;
  readonly Menu: ComponentType<DocumentPlayControlProps>;
  playing(documentId: string): boolean;
  /** Intended live frame shape; absent/null lets the document fill its area. */
  aspectRatio?(documentId: string): number | null;
  setPlaying(documentId: string, value: boolean): void;
  escape?(documentId: string): void;
  subscribe(listener: () => void): () => void;
  run(stage: DocumentPlayStage): () => void;
}
const key = Symbol.for('volter.document-play-extensions');
interface Registry {
  extensions: Map<string, DocumentPlayExtension>;
  listeners: Set<() => void>;
}
const page = globalThis as typeof globalThis & { [key]?: Registry };
const registry = page[key] ??= { extensions: new Map(), listeners: new Set() };
function publish(): void { for (const listener of registry.listeners) listener(); }
export function documentPlayExtension(kind: string): DocumentPlayExtension | null {
  return registry.extensions.get(kind) ?? null;
}
/** Host shells wrap adapter entries as generic documents. Ask the capability
 * owners about this document's identity rather than treating that wrapper's
 * semantic kind as the adapter's registered Play kind. */
export function documentPlaying(documentId: string): boolean {
  for (const extension of registry.extensions.values()) {
    if (extension.playing(documentId)) return true;
  }
  return false;
}
export function subscribeDocumentPlayExtensions(listener: () => void): () => void {
  registry.listeners.add(listener);
  return () => { registry.listeners.delete(listener); };
}
export function registerDocumentPlayExtension(kind: string, extension: DocumentPlayExtension): () => void {
  if (registry.extensions.has(kind)) throw new Error(`A Play tool already owns ${kind} documents.`);
  registry.extensions.set(kind, extension);
  const stop = extension.subscribe(publish);
  publish();
  return () => {
    stop();
    if (registry.extensions.get(kind) === extension) registry.extensions.delete(kind);
    publish();
  };
}
