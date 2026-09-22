/**
 * Owns a module's registry contributions across Vite Fast Refresh.
 *
 * A module-local `registered` boolean is not sufficient: Vite may reload the
 * contributor without reloading the registry (duplicates), or reload the
 * registry without reloading the contributor (missing entries). Tracking the
 * unregister callbacks in `import.meta.hot.data` gives the contribution one
 * explicit lifetime and keeps strict duplicate-id checks meaningful.
 */

export interface HmrRegistrationContext {
  readonly data?: Record<string, unknown>;
  dispose(callback: (data: Record<string, unknown>) => void): void;
}

export interface HmrRegistrationGroup {
  ensure(register: (track: (unregister: () => void) => void) => void): void;
  reset(): void;
}

interface PersistedRegistrationGroup {
  dispose(): void;
}

export function createHmrRegistrationGroup(
  hot: HmrRegistrationContext | undefined,
  key: string,
): HmrRegistrationGroup {
  const persistedKey = `vgai:registration-group:${key}`;
  // Test runners and non-Vite hosts can expose a partial `import.meta.hot`
  // shim without `data`. In that case the group still owns its local
  // registrations, but there is no cross-refresh persistence to maintain.
  const hotData = hot?.data;
  const previous = hotData?.[persistedKey] as PersistedRegistrationGroup | undefined;
  previous?.dispose();

  let active = false;
  let unregisters: Array<() => void> = [];

  const reset = () => {
    active = false;
    const owned = unregisters;
    unregisters = [];
    for (let i = owned.length - 1; i >= 0; i--) owned[i]!();
  };

  const group: HmrRegistrationGroup = {
    ensure(register) {
      if (active) return;
      active = true;
      try {
        register((unregister) => unregisters.push(unregister));
      } catch (error) {
        reset();
        throw error;
      }
    },
    reset,
  };

  if (hotData) {
    hotData[persistedKey] = { dispose: reset } satisfies PersistedRegistrationGroup;
    hot.dispose(reset);
  }

  return group;
}
