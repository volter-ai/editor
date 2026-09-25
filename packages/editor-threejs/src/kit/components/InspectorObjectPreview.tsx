import type * as THREE from 'three';
import { Object3DSnapshotDocument } from './asset-viewers/EntityModelDocument';

/**
 * Inspector-sized projection of the canonical Asset Lab viewport, over a live
 * `Object3D` the caller already has in hand.
 *
 * It takes the OBJECT, not an id to look one up by: a subject's preview is
 * composed only when the thing is genuinely previewable
 * (`inspection/compose.ts`), and the object the composer proved exists is the
 * one rendered here. A scene node and a part inside an asset document are
 * therefore the same case — the part is not in the shell's object map, and
 * with an id this component could only have shown a "no longer available"
 * alert for a thing that is right there on screen.
 *
 * Every host passes `fill`: the section body's square box, the compact card's
 * round disc, and the minimized card's round thumb all own their own geometry
 * and this component just fills it.
 */
export function InspectorObjectPreview({
  previewKey,
  object,
  displayName,
  fill = false,
}: {
  /** Stable identity for the isolated preview document. */
  previewKey: string;
  object: THREE.Object3D;
  displayName: string;
  fill?: boolean;
}) {
  return (
    <div
      data-testid="inspector-object-preview"
      style={
        fill
          ? { position: 'absolute', inset: 0, overflow: 'hidden' }
          : {
              width: '100%',
              height: 220,
              minHeight: 220,
              borderBottom: '1px solid var(--vgai-structural-divider)',
              overflow: 'hidden',
              position: 'relative',
            }
      }
    >
      <Object3DSnapshotDocument
        documentId={`inspector-preview:${previewKey}`}
        source={object}
        displayName={displayName}
        active
        chromeless
      />
    </div>
  );
}
