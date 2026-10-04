/** Optional document capability. A tool owns its controls, state and runner;
 * a document kind owns the detached stage it lends that runner. Products name
 * neither side. The page-wide registry joins packaged and served contributions. */
import type { ComponentType } from 'react';

export interface DocumentPlayControlProps {
  readonly documentId: string | undefined;
  readonly onClose: () => void;
}
export interface DocumentPlayStage {
  readonly sourcePath: string;
  readonly root: unknown;
  readonly camera: () => unknown;
  readonly onFrame: (fn: (seconds: number) => void) => () => void;
  readonly report: (title: string, detail: string) => void;
  readonly container: HTMLElement;
  /** The runner has updated its first drawable frame. */
  readonly ready: () => void;
}
export interface DocumentPlayExtension {
  readonly Control: ComponentType<DocumentPlayControlProps>;
  readonly Menu: ComponentType<DocumentPlayControlProps>;
  playing(documentId: string): boolean;
  setPlaying(documentId: string, value: boolean): void;
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
