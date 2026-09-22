/**
 * Interactive-edit (undo-gesture) scope — the ONE thing the shared input
 * primitives (`primitives/NumberInput.tsx` / `primitives/ColorInput.tsx`)
 * need from the editor: "a continuous gesture (scrub / color drag) starts /
 * ends now, coalesce it into a single undo step".
 *
 * Split out of the editor's `EditorContext.tsx`: the widget kit is a public
 * export (`@volter/editor-sdk/widgets`) that scaffolded PROJECTS typecheck — importing
 * `EditorContext` (and through it `EditorShellStore` and most of the editor)
 * from a widget would drag the whole editor source graph into every project's
 * `tsc`. This module's closure is react-only; `EditorProvider` bridges it to
 * the real store (`beginInteractiveEdit`/`endInteractiveEdit`).
 *
 * Widgets consume it optionally (`useInteractiveEditScope()` returns `null`
 * outside a provider — e.g. the widget gallery, or a project tool rendered
 * in some future host): no scope simply means no undo coalescing.
 */

import { createContext, useContext } from 'react';

/** Begin/end a coalesced interactive edit gesture (one undo step). Both are
 *  idempotent in the editor's implementation — safe to call defensively. */
export interface InteractiveEditScope {
  begin(): void;
  end(): void;
}

export const InteractiveEditScopeContext = createContext<InteractiveEditScope | null>(null);

/** The ambient gesture scope, or `null` when no host provides one. */
export function useInteractiveEditScope(): InteractiveEditScope | null {
  return useContext(InteractiveEditScopeContext);
}
