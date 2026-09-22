/**
 * Renders the editor's transient hint (see `../transient-hint.ts` for the
 * publisher and the rationale). Mounted once, near the bottom of the viewport;
 * absent from the DOM entirely when there is nothing to say.
 *
 * `role="status"` + `aria-live="polite"` so a refusal is announced, not just
 * drawn — this exists BECAUSE the refusal used to be silent.
 */

import { space, themeVars, zIndex } from '@volter/editor-sdk/widgets';
import { useSyncExternalStore } from 'react';
import { subscribeTransientHint, transientHint } from '../transient-hint';

export function TransientHintOverlay() {
  const hint = useSyncExternalStore(subscribeTransientHint, transientHint, transientHint);
  if (!hint) return null;
  return (
    <div
      key={hint.id}
      role="status"
      aria-live="polite"
      data-testid="transient-hint"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: space[6],
        transform: 'translateX(-50%)',
        maxWidth: 'min(440px, 80%)',
        padding: `${space[3]}px ${space[5]}px`,
        borderRadius: themeVars.shape.medium,
        border: `1px solid ${themeVars.boundary.strong}`,
        background: themeVars.surface.overlay,
        color: themeVars.content.primary,
        fontSize: 'var(--vgai-font-base)',
        lineHeight: 1.4,
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: zIndex.toast,
      }}
    >
      {hint.message}
    </div>
  );
}
