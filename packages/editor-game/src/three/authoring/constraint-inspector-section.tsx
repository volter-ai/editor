import { instanceStampOf } from '@volter/editor-core/authoring/component-instance-root';
import { setAuthoringSelection } from '@volter/editor-core/authoring/consumer-actions';
import { useEditorStore } from '@volter/editor-core/editor-runtime';
import type { InspectorSectionProps } from '@volter/editor-core/inspector-section-registry';
import type { AuthoringAdapter, EditorNode } from '@volter/editor-project/adapter';
import {
  type ConstraintMark,
  type ConstraintSnapshot,
  constraintsOf,
} from '@volter/threejs-runtime/adapter/constraint';
import {
  Button,
  EditorBanner,
  FieldGroup,
  FieldRow,
  Text,
  themeVars,
} from '@volter/editor-sdk/widgets';
import type * as THREE from 'three';

function objectFor(adapter: AuthoringAdapter, nodeId: string | null) {
  return nodeId ? (adapter.hierarchy.object3D?.(nodeId) ?? null) : null;
}

/** Marks owned by this semantic component, including same-instance host nodes
 * the component-aware hierarchy deliberately folds beneath its one row. */
function constraintMarksFor(object: THREE.Object3D | null): ConstraintMark[] {
  if (!object) return [];
  const instance = instanceStampOf(object);
  const marks = new Set<ConstraintMark>();
  const visit = (current: THREE.Object3D): void => {
    const currentInstance = instanceStampOf(current);
    if (
      current !== object &&
      instance !== undefined &&
      currentInstance !== undefined &&
      currentInstance !== instance
    ) {
      return;
    }
    for (const mark of constraintsOf(current)) marks.add(mark);
    for (const child of current.children) visit(child);
  };
  visit(object);
  return [...marks];
}

export function matches(node: EditorNode | null, adapter: AuthoringAdapter): boolean {
  return constraintMarksFor(objectFor(adapter, node?.id ?? null)).length > 0;
}

const STATUS_LABEL: Record<ConstraintSnapshot['status'], string> = {
  ready: 'Ready',
  disabled: 'Disabled',
  unresolved: 'Unresolved',
  error: 'Error',
};

function typeLabel(type: ConstraintMark['config']['type']): string {
  if (type === 'two-bone-ik') return 'Two Bone IK';
  if (type === 'ccd-ik') return 'CCD IK';
  if (type === 'aim') return 'Aim';
  if (type === 'rotation') return 'Rotation';
  return type;
}

export function ConstraintStackSection({ adapter, nodeId }: InspectorSectionProps) {
  const store = useEditorStore();
  const object = nodeId
    ? (store.objectMap.get(nodeId) ?? objectFor(adapter, nodeId) ?? null)
    : null;
  const marks = constraintMarksFor(object).sort(
    (left, right) => left.config.order - right.config.order,
  );

  const selectObject = (object: THREE.Object3D | null): void => {
    if (!object) return;
    const id = adapter.hierarchy.idForObject3D?.(object);
    if (!id) return;
    if (!setAuthoringSelection(adapter, [id], { intent: 'exact' })) store.select(id);
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one compact card projects one constraint snapshot. */}
      {marks.map((mark, index) => {
        const config = mark.config;
        const snapshot = mark.getSnapshot();
        const isIk = config.type === 'two-bone-ik' || config.type === 'ccd-ik';
        return (
          <div
            key={config.id}
            style={{
              border: `1px solid ${themeVars.boundary.default}`,
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                alignItems: 'center',
                background: themeVars.surface.raised,
                display: 'flex',
                gap: 8,
                justifyContent: 'space-between',
                padding: '6px 8px',
              }}
            >
              <Text>{`${index + 1}. ${config.label}`}</Text>
              <Text tone="muted">{typeLabel(config.type)}</Text>
            </div>
            {snapshot.message &&
            (snapshot.status === 'error' || snapshot.status === 'unresolved') ? (
              <EditorBanner tone="error">{snapshot.message}</EditorBanner>
            ) : null}
            <FieldGroup>
              <FieldRow label="Status">
                <Text
                  tone={
                    snapshot.status === 'error' || snapshot.status === 'unresolved'
                      ? 'danger'
                      : snapshot.status === 'ready'
                        ? 'success'
                        : 'muted'
                  }
                >
                  {STATUS_LABEL[snapshot.status]}
                </Text>
              </FieldRow>
              <FieldRow label="Weight">
                <Text tone="muted">{`${Math.round(config.weight * 100)}%`}</Text>
              </FieldRow>
              {isIk ? (
                <FieldRow label="Chain">
                  <Text tone="muted">
                    {snapshot.chain.map((bone) => bone.name || bone.type).join(' → ') ||
                      'Unresolved'}
                  </Text>
                </FieldRow>
              ) : (
                <FieldRow label="Constrained">
                  {snapshot.constrained &&
                  adapter.hierarchy.idForObject3D?.(snapshot.constrained) ? (
                    <Button size="compact" onClick={() => selectObject(snapshot.constrained)}>
                      {snapshot.constrained.name || 'Select object'}
                    </Button>
                  ) : (
                    <Text tone="muted">{snapshot.constrained?.name || 'Unresolved'}</Text>
                  )}
                </FieldRow>
              )}
              {snapshot.error !== null ? (
                <FieldRow
                  label={snapshot.error.unit === 'degrees' ? 'Angular error' : 'Solve error'}
                >
                  <Text tone="muted">
                    {snapshot.error.unit === 'degrees'
                      ? `${snapshot.error.value.toFixed(2)}°`
                      : `${snapshot.error.value.toFixed(3)} m`}
                  </Text>
                </FieldRow>
              ) : null}
              <FieldRow label="Target">
                {snapshot.target && adapter.hierarchy.idForObject3D?.(snapshot.target) ? (
                  <Button size="compact" onClick={() => selectObject(snapshot.target)}>
                    {snapshot.target.name || 'Select target'}
                  </Button>
                ) : (
                  <Text tone="muted">{snapshot.target?.name || 'Dynamic target'}</Text>
                )}
              </FieldRow>
              {isIk ? (
                <FieldRow label="Pole">
                  {snapshot.pole && adapter.hierarchy.idForObject3D?.(snapshot.pole) ? (
                    <Button size="compact" onClick={() => selectObject(snapshot.pole)}>
                      {snapshot.pole.name || 'Select pole'}
                    </Button>
                  ) : (
                    <Text tone="muted">{snapshot.pole?.name || 'None'}</Text>
                  )}
                </FieldRow>
              ) : null}
            </FieldGroup>
          </div>
        );
      })}
    </div>
  );
}
