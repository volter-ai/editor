import { WorldProvider } from '@volter/game-runtime/react/world-state';
import type { GameDomHostContext } from '@volter/game-runtime/runtime/host-context';
import type { MountedReactGame, ReactRootAdapter } from '@volter/game-runtime/runtime/create-runtime';
import { isAdapterRegistered, registerAdapter } from '@volter/game-runtime/runtime/mount-game';
import { type ComponentType, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

interface ReactEntryModule {
  readonly default?: ComponentType;
}

/** Construct one canonical React root adapter for direct host composition. */
export function createReactRootAdapter(id: string, Entry: ComponentType): ReactRootAdapter {
  return {
    id,
    async mount(host: GameDomHostContext): Promise<MountedReactGame> {
      if (!host.game) throw new Error(`React root "${id}" requires a Game host.`);
      const reactRoot = createRoot(host.container);
      flushSync(() => {
        reactRoot.render(createElement(WorldProvider, { game: host.game! }, createElement(Entry)));
      });
      return {
        kind: 'dom',
        container: host.container,
        drivesOwnLoop: false,
        dispose: () => reactRoot.unmount(),
      };
    },
  };
}

/**
 * Register React as the factory for this project's `dom` roots. Call once at
 * module load, before mounting — ADD the call to your `src/main.ts` yourself:
 * the scaffold's main.ts registers only `three`, and installing this
 * capability does not edit it.
 *
 * Registration is what makes a `dom` root mount at all; the engine ships no
 * default. Swap React out by not calling this and registering your own
 * factory for `'dom'` instead — the host hands that factory an `HTMLElement`
 * and asks for a dispose, which is all `createApp().mount(el)` or
 * `new Svelte({ target })` needs.
 */
export function registerReactAdapter(): void {
  if (isAdapterRegistered('dom')) return;
  registerAdapter('dom', (root, { entryModule }) => {
    const Entry = (entryModule as ReactEntryModule | undefined)?.default;
    if (!Entry) {
      throw new Error(
        `React root "${root.id}" entry "${root.entry ?? '(missing)'}" must default-export a component.`,
      );
    }

    return { kind: 'dom', adapter: createReactRootAdapter(root.id, Entry) };
  });
}
