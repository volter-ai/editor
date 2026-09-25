import { type Context, createContext } from 'react';

/**
 * Preserve a React context object across Vite module replacement.
 *
 * A provider from the previous module generation can remain mounted while a
 * freshly imported consumer renders. If both generations call
 * `createContext()`, the consumer observes a different context and falsely
 * reports that it is outside the provider. Vite keeps `import.meta.hot.data`
 * for exactly this kind of module-local state handoff.
 */
export function createHmrStableReactContext<T>(
  hotData: Record<string, unknown> | undefined,
  key: string,
  defaultValue: T,
): Context<T> {
  const existing = hotData?.[key];
  if (existing) return existing as Context<T>;

  const context = createContext(defaultValue);
  if (hotData) hotData[key] = context;
  return context;
}
