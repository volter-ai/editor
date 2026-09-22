/**
 * The PREVIEW section's body — a live square view of whatever the subject is,
 * with the subject's `preview`-placed verbs sitting in the box over it.
 *
 * It lives in its own light module for one reason: `inspection/compose.ts`
 * builds the preview section, and the preview drags the whole render stack
 * (three.quarks, realism-effects) behind it. The heavy component stays behind
 * `lazy()` here, so a headless composer — every unit test of the model, and
 * `editor.inspect`, which never renders — pays nothing for it.
 *
 * `render` fills its host at any size, which is what lets the section body and
 * the minimized card's round thumb be the SAME function off the SAME subject
 * (`components/CompactInspectorCard.tsx`) rather than two derivations of what
 * the thing looks like. What differs between those hosts is CHROME, not the
 * picture — see {@link InspectionPreviewMode}.
 */

import { Button } from '@volter/editor-sdk/widgets';
import { lazy, Suspense } from 'react';
import type * as THREE from 'three';
import type { ContentEntry, ContentEntrySource } from '../content-entry-source-registry';
import type { InspectionAction, InspectionPreviewMode } from '../inspection/model';
import { useAfterPaint } from './use-after-paint';

const InspectorObjectPreview = lazy(() =>
  import('./InspectorObjectPreview').then((m) => ({ default: m.InspectorObjectPreview })),
);
const InspectorCanvasPreview = lazy(() =>
  import('./InspectorCanvasPreview').then((m) => ({ default: m.InspectorCanvasPreview })),
);

export function InspectorPreviewBody({
  object,
  displayName,
  previewKey,
  actions,
  mode = 'section',
}: {
  /** The live object to preview. The composer only builds a preview section
   *  when it HAS one, so this is never a lookup that can come up empty — the
   *  honest alternative to a fabricated render is no section at all. */
  readonly object: THREE.Object3D;
  readonly displayName: string;
  /** Stable identity for the isolated preview document (the subject's node
   *  id) — remounts when the subject changes, not on every compose. */
  readonly previewKey: string;
  readonly actions: readonly InspectionAction[];
  /** Which host this is rendering into. Default `section` — the full box. */
  readonly mode?: InspectionPreviewMode;
}) {
  // A thumbnail host is a small clipped shape that owns its own single press,
  // so the body gives it the PICTURE and nothing else: it fills the host
  // exactly, and the verbs stay in the section, which is where they are
  // reachable and readable.
  const thumbnail = mode === 'thumbnail';
  // The picture arrives a frame after the box does: mounting it is scene and GL
  // work, and doing it in the selection's own commit is what used to make the
  // whole inspector wait on it (`components/use-after-paint.ts`).
  const showPicture = useAfterPaint(previewKey);
  return (
    <div
      data-testid={thumbnail ? 'inspection-preview-thumbnail' : 'inspection-preview'}
      style={
        thumbnail
          ? { position: 'absolute', inset: 0, overflow: 'hidden' }
          : {
              position: 'relative',
              width: 'calc(100% - 24px)',
              aspectRatio: '1 / 1',
              flexShrink: 0,
              margin: 12,
              overflow: 'hidden',
              border: '1px solid var(--vgai-structural-divider)',
              borderRadius: 'var(--dv-group-border-radius, 8px)',
            }
      }
    >
      {showPicture && (
        <Suspense fallback={null}>
          <InspectorObjectPreview
            previewKey={previewKey}
            object={object}
            displayName={displayName}
            fill
          />
        </Suspense>
      )}
      {!thumbnail &&
        actions.map((action) => (
          <Button
            key={action.id}
            data-testid={action.id}
            size="compact"
            disabled={action.disabled}
            title={action.title}
            onClick={action.run}
            style={{ position: 'absolute', right: 8, bottom: 8 }}
          >
            {action.label}
          </Button>
        ))}
    </div>
  );
}

/** The same Preview-section chrome around a COMPONENT's own picture, painted by
 * whichever content source admits it (`content-entry-source-registry.ts`).
 * Canvas entities are Pixi display objects rather than Object3Ds, so the
 * picture Content already shows is the honest preview authority here too; the
 * shell never substitutes the Transform icon for a picture, and never knows
 * what the picture IS. */
export function InspectorComponentPreviewBody({
  source,
  entry,
  previewKey,
  actions,
  mode = 'section',
}: {
  readonly source: ContentEntrySource;
  readonly entry: ContentEntry;
  readonly previewKey: string;
  readonly actions: readonly InspectionAction[];
  readonly mode?: InspectionPreviewMode;
}) {
  const thumbnail = mode === 'thumbnail';
  const showPicture = useAfterPaint(previewKey);
  return (
    <div
      data-testid={thumbnail ? 'inspection-preview-thumbnail' : 'inspection-preview'}
      style={
        thumbnail
          ? { position: 'absolute', inset: 0, overflow: 'hidden' }
          : {
              position: 'relative',
              width: 'calc(100% - 24px)',
              aspectRatio: '1 / 1',
              flexShrink: 0,
              margin: 12,
              overflow: 'hidden',
              border: '1px solid var(--vgai-structural-divider)',
              borderRadius: 'var(--dv-group-border-radius, 8px)',
            }
      }
    >
      {showPicture && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            background: 'var(--vgai-bg-inset)',
          }}
        >
          <source.Thumbnail
            entry={entry}
            previewRevision={0}
            width={thumbnail ? 96 : 256}
            height={thumbnail ? 96 : 256}
          />
        </div>
      )}
      {!thumbnail &&
        actions.map((action) => (
          <Button
            key={action.id}
            data-testid={action.id}
            size="compact"
            disabled={action.disabled}
            title={action.title}
            onClick={action.run}
            style={{ position: 'absolute', right: 8, bottom: 8 }}
          >
            {action.label}
          </Button>
        ))}
    </div>
  );
}

/** The selected live Canvas subtree in the same Preview-section shell used by
 * Three and by story fallbacks. */
export function InspectorCanvasPreviewBody({
  capture,
  previewKey,
  actions,
  mode = 'section',
}: {
  readonly capture: (size: number) => Promise<string | null>;
  readonly previewKey: string;
  readonly actions: readonly InspectionAction[];
  readonly mode?: InspectionPreviewMode;
}) {
  const thumbnail = mode === 'thumbnail';
  const showPicture = useAfterPaint(previewKey);
  return (
    <div
      data-testid={thumbnail ? 'inspection-preview-thumbnail' : 'inspection-preview'}
      style={
        thumbnail
          ? { position: 'absolute', inset: 0, overflow: 'hidden' }
          : {
              position: 'relative',
              width: 'calc(100% - 24px)',
              aspectRatio: '1 / 1',
              flexShrink: 0,
              margin: 12,
              overflow: 'hidden',
              border: '1px solid var(--vgai-structural-divider)',
              borderRadius: 'var(--dv-group-border-radius, 8px)',
            }
      }
    >
      {showPicture && (
        <Suspense fallback={null}>
          <InspectorCanvasPreview
            capture={capture}
            previewKey={previewKey}
            size={thumbnail ? 96 : 256}
          />
        </Suspense>
      )}
      {!thumbnail &&
        actions.map((action) => (
          <Button
            key={action.id}
            data-testid={action.id}
            size="compact"
            disabled={action.disabled}
            title={action.title}
            onClick={action.run}
            style={{ position: 'absolute', right: 8, bottom: 8 }}
          >
            {action.label}
          </Button>
        ))}
    </div>
  );
}
