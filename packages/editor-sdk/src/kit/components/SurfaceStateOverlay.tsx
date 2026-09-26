import { StateSurface } from '@volter/editor-sdk/widgets';
import type { CSSProperties } from 'react';
import type { SurfaceExplanation } from '@volter/editor-sdk/kit/surface-state';

export function SurfaceStateOverlay({
  explanation,
  testId,
  style,
}: {
  readonly explanation: SurfaceExplanation | null;
  readonly testId: string;
  readonly style?: CSSProperties;
}) {
  if (!explanation) return null;
  return (
    <StateSurface
      data-testid={testId}
      tone={explanation.tone}
      title={explanation.title}
      description={<span style={{ whiteSpace: 'pre-wrap' }}>{explanation.description}</span>}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }}
    />
  );
}
