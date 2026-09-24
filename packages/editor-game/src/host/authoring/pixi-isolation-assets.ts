/**
 * ONE Pixi asset initialization per project asset module in Edit.
 *
 * Scene isolation documents and canvas component stories are two projections
 * of the same project's constructs. Both can import the game's `assets.ts`,
 * but Pixi owns one realm-global `Assets` singleton and warns on the second
 * `init()`. The source path is the identity because wrapper function identity
 * is not stable across the two Vite import forms.
 */

const initializations = new Map<string, Promise<void>>();

export function initializePixiIsolationAssets(
  sourcePath: string,
  initialize: () => Promise<void>,
): Promise<void> {
  const existing = initializations.get(sourcePath);
  if (existing) return existing;
  const started = initialize().catch((error: unknown) => {
    initializations.delete(sourcePath);
    throw error;
  });
  initializations.set(sourcePath, started);
  return started;
}
