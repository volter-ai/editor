import { useEditorStore } from '@volter/editor-core/editor-runtime';
import type { InspectorSectionProps } from '@volter/editor-core/inspector-section-registry';
import type { AuthoringAdapter, EditorNode } from '@volter/editor-project/adapter';
import { type ReflectionProbeSnapshot, reflectionProbeOf } from '@volter/threejs-runtime/adapter/reflection-probe';
import { Button, EditorBanner, FieldGroup, FieldRow, Text } from '@volter/editor-sdk/widgets';
import { useSyncExternalStore } from 'react';

export function matches(node: EditorNode | null, adapter: AuthoringAdapter): boolean {
  void adapter;
  return node?.kind === 'reflection-probe';
}

const STATUS_LABEL: Record<ReflectionProbeSnapshot['status'], string> = {
  idle: 'Not captured',
  queued: 'Capture queued',
  capturing: 'Capturing…',
  ready: 'Ready',
  error: 'Capture failed',
};
const EMPTY_SNAPSHOT: ReflectionProbeSnapshot = { status: 'idle', lastCapturedAt: null };

export function ReflectionProbeCaptureSection({ adapter, nodeId }: InspectorSectionProps) {
  const store = useEditorStore();
  const object = nodeId
    ? (store.objectMap.get(nodeId) ?? adapter.hierarchy.object3D?.(nodeId))
    : null;
  const probe = reflectionProbeOf(object);
  const snapshot = useSyncExternalStore(
    (listener) => probe?.subscribe(listener) ?? (() => {}),
    () => probe?.getSnapshot() ?? EMPTY_SNAPSHOT,
  );
  if (!probe) return null;
  const mode =
    probe.config.captureMode === 'on-change'
      ? 'On change'
      : probe.config.captureMode === 'realtime'
        ? 'Realtime'
        : 'Manual';
  return (
    <>
      {snapshot.status === 'error' && snapshot.message ? (
        <EditorBanner tone="error">{snapshot.message}</EditorBanner>
      ) : null}
      <FieldGroup>
        <FieldRow label="Status">
          <Text
            tone={
              snapshot.status === 'error'
                ? 'danger'
                : snapshot.status === 'ready'
                  ? 'success'
                  : 'muted'
            }
          >
            {STATUS_LABEL[snapshot.status]}
          </Text>
        </FieldRow>
        <FieldRow label="Update">
          <Text tone="muted">{mode}</Text>
        </FieldRow>
        <FieldRow label="Cubemap">
          <Text tone="muted">{`${probe.config.resolution} × ${probe.config.resolution}`}</Text>
        </FieldRow>
        <FieldRow label="Capture">
          <Button
            size="compact"
            disabled={snapshot.status === 'capturing'}
            onClick={() => probe.recapture()}
          >
            Recapture
          </Button>
        </FieldRow>
      </FieldGroup>
    </>
  );
}
