/**
 * The lazy boundary for a stage's overlays. The host names them; only a stage
 * that actually has a shell above it (and therefore something for them to
 * read) evaluates the module. See `stage-overlay-set.tsx` for what they are
 * and `world-root-stage.ts`'s header for why the condition gates the LOAD.
 */
import { lazy, Suspense } from 'react';
import type { StageOverlaySetProps } from './stage-overlay-set';

const LazyStageOverlaySet = lazy(async () => {
  const module = await import('./stage-overlay-set');
  return { default: module.StageOverlaySet };
});

export function StageOverlays(props: StageOverlaySetProps) {
  return (
    <Suspense fallback={null}>
      <LazyStageOverlaySet {...props} />
    </Suspense>
  );
}
