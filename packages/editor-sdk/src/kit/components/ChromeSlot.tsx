/** Renders whatever a package registered for a chrome slot
 *  (`chrome-slot-registry.ts`), and nothing when nothing did. */

import { useSyncExternalStore } from 'react';
import {
  chromeSlotFillers,
  chromeSlotRegistryVersion,
  subscribeChromeSlots,
} from '../chrome-slot-registry';

export function ChromeSlot({ slot }: { readonly slot: string }) {
  useSyncExternalStore(subscribeChromeSlots, chromeSlotRegistryVersion, chromeSlotRegistryVersion);
  return (
    <>
      {chromeSlotFillers(slot).map((filler) => (
        <filler.Content key={filler.owner} />
      ))}
    </>
  );
}
