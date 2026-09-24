/**
 * THE COMPONENT-CONTRACT ANALYZER — the one browser-side question the kit's Content index asks
 * of a source-authoring integration: what authoring contract each component a module defines
 * exposes (which transform props land where, which channels it binds). An integration's
 * contribution registers the analyzer; the index reads it. With none registered, a module
 * declares no contracts, which is the honest answer for a product with no such integration.
 *
 * Module state under a `Symbol.for` key, like the host door, so the registration and the read
 * meet across the editor's module instances.
 */

import type { R3fComponentContract } from './source-authoring';

export type ComponentContractAnalyzer = (
  source: string,
  path: string,
) => ReadonlyMap<string, R3fComponentContract>;

const ANALYZER_KEY = Symbol.for('vgai.editor.componentContractAnalyzer');
type AnalyzerSlot = { [ANALYZER_KEY]?: ComponentContractAnalyzer | null };

export function registerComponentContractAnalyzer(analyzer: ComponentContractAnalyzer | null): void {
  (globalThis as AnalyzerSlot)[ANALYZER_KEY] = analyzer;
}

export function componentContractAnalyzer(): ComponentContractAnalyzer | null {
  return (globalThis as AnalyzerSlot)[ANALYZER_KEY] ?? null;
}
