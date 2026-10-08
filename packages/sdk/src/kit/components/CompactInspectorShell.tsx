/**
 * The viewport host's handle into the MINI card (`inspector-presentation.ts`):
 * the one action a projected mini card needs from its physical home — collapse
 * to the pill. The host (`components/CompactInspectorCard.tsx`) provides it; a
 * bounded design-system host provides none, so the card renders without a
 * minimize control.
 *
 * The mini card and pill chrome itself lives with the projections in
 * `components/InspectionProjection.tsx` — this module is only the context seam
 * between them and the viewport host.
 */

import { createContext, type ReactNode, useContext } from 'react';

interface CompactInspectorHostActions {
  readonly minimize: () => void;
}

const CompactInspectorHostContext = createContext<CompactInspectorHostActions | null>(null);

export function CompactInspectorHostProvider({
  actions,
  children,
}: {
  readonly actions: CompactInspectorHostActions;
  readonly children: ReactNode;
}) {
  return (
    <CompactInspectorHostContext.Provider value={actions}>
      {children}
    </CompactInspectorHostContext.Provider>
  );
}

/** The mini card's handle to its viewport host — `null` in a bounded host,
 *  where there is nothing to minimize into. */
export function useCompactInspectorHost(): CompactInspectorHostActions | null {
  return useContext(CompactInspectorHostContext);
}
