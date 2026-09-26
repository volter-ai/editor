/**
 * A non-enumerable slot carried by the game object itself.
 *
 * Packaged editor play can legitimately involve two copies of `@volter/game-runtime`:
 * the editor bundle creates the Game, while the project's Vite graph creates
 * its root adapter. Module-local WeakMaps cannot cross that boundary. A
 * registry-backed symbol can, while keeping the internal value off the public
 * string-keyed Game surface.
 */
export function createGameScopedSlot<T>(name: string): {
  set(owner: object, value: T): void;
  get(owner: object): T | null;
} {
  const key = Symbol.for(`@vgai/game-runtime/game-scoped/${name}`);

  return {
    set(owner, value) {
      Object.defineProperty(owner, key, {
        configurable: true,
        enumerable: false,
        value,
      });
    },
    get(owner) {
      return (owner as { [key: symbol]: T | undefined })[key] ?? null;
    },
  };
}
