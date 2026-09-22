import { faCubesStacked } from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FieldRow,
  Text,
  themeVars,
} from '@volter/editor-sdk/widgets';
import type {
  AuthoringAdapter,
  ComponentInstanceOverride,
  EditorNode,
} from '@volter/editor-project/adapter';
import { useEffect, useState } from 'react';
import { createHmrRegistrationGroup } from '../hmr-registration-group';
import { GROUP_SECTION_ORDER, type InspectionSection } from '../inspection/model';
import { registerInspectorSections } from '../inspector-section-registry';
import { showTransientHint } from '../transient-hint';
import {
  applyAuthoringInstanceToComponent,
  openAuthoringComponent,
  revertAuthoringInstance,
} from './consumer-actions';
import { matchesPrefabInstance, prefabInstanceStoryAction } from './prefab-instance-section-model';

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function PrefabInstanceSection({ adapter, nodeId }: { adapter: AuthoringAdapter; nodeId: string }) {
  const description = adapter.instances?.describe(nodeId) ?? null;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyTarget, setApplyTarget] = useState<ComponentInstanceOverride | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(new Set());
    setApplyTarget(null);
  }, [nodeId]);

  if (!description) return null;
  const storyAction = prefabInstanceStoryAction(adapter, nodeId);

  const toggle = (path: string, checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const revertSelected = async (): Promise<void> => {
    if (selected.size === 0 || !adapter.instances) return;
    setBusy(true);
    try {
      await revertAuthoringInstance(adapter, nodeId, [...selected]);
      setSelected(new Set());
      showTransientHint(
        `Reverted ${selected.size} prefab override${selected.size === 1 ? '' : 's'}.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (!applyTarget || !adapter.instances) return;
    setBusy(true);
    try {
      const result = await applyAuthoringInstanceToComponent(adapter, nodeId, applyTarget.path);
      showTransientHint(result.message);
      if (result.changed) setApplyTarget(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="prefab-instance-overrides">
      <FieldRow label="Prefab">
        <Text>{description.componentName}</Text>
      </FieldRow>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button
          size="compact"
          disabled={!adapter.instances?.openComponent}
          onClick={() => openAuthoringComponent(adapter, nodeId)}
        >
          Open Component
        </Button>
        <Button
          size="compact"
          disabled={!storyAction}
          title={
            storyAction ? `Open ${storyAction.story.label}` : 'This prefab has no composed story.'
          }
          onClick={() => storyAction?.open()}
        >
          Open Story
        </Button>
      </div>

      <div>
        <Text tone="muted">Overrides ({description.overrides.length})</Text>
        {description.overrides.length === 0 ? (
          <div style={{ paddingTop: 6 }}>
            <Text tone="muted">
              Using component defaults. Change a property above and it will be listed here as an
              override you can apply or revert.
            </Text>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 4, paddingTop: 6 }}>
            {description.overrides.map((override) => (
              <div
                key={override.path}
                style={{
                  border: `1px solid ${themeVars.boundary.default}`,
                  borderRadius: 5,
                  display: 'grid',
                  gap: 4,
                  padding: 6,
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Checkbox
                    checked={selected.has(override.path)}
                    onChange={(event) => toggle(override.path, event.target.checked)}
                  />
                  <Text>{override.label}</Text>
                  <Text tone="muted">{display(override.value)}</Text>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 22 }}>
                  <Text tone="muted">default: {override.defaultText ?? 'component fallback'}</Text>
                  <Button
                    size="compact"
                    disabled={!override.canApplyToComponent || busy}
                    title={override.applyUnavailableReason}
                    onClick={() => setApplyTarget(override)}
                  >
                    Apply…
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {description.overrides.length > 0 ? (
        <Button
          size="compact"
          disabled={selected.size === 0 || busy}
          title={selected.size === 0 ? 'Tick an override above to select it first.' : undefined}
          onClick={() => void revertSelected()}
        >
          Revert Selected
        </Button>
      ) : null}

      {applyTarget ? (
        <Dialog
          labelledBy="apply-prefab-default-title"
          onDismiss={() => !busy && setApplyTarget(null)}
        >
          <DialogHeader
            titleId="apply-prefab-default-title"
            title={`Apply “${applyTarget.label} = ${display(applyTarget.value)}” to ${description.componentName}?`}
          />
          <DialogBody>
            <div style={{ display: 'grid', gap: 8 }}>
              <Text>
                This changes the default used by {applyTarget.affectedInstanceCount} placed instance
                {applyTarget.affectedInstanceCount === 1 ? '' : 's'}.
              </Text>
              <FieldRow label="Current default">
                <Text tone="muted">{applyTarget.defaultText ?? 'component fallback'}</Text>
              </FieldRow>
              <FieldRow label="New default">
                <Text>{display(applyTarget.value)}</Text>
              </FieldRow>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button disabled={busy} onClick={() => setApplyTarget(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void apply()}>
              Apply
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}

function sections(
  node: EditorNode | null,
  adapter: AuthoringAdapter,
): readonly InspectionSection[] {
  if (!node || !matchesPrefabInstance(node, adapter)) return [];
  const description = adapter.instances?.describe(node.id);
  if (!description) return [];
  return [
    {
      id: 'prefab-instance',
      title: 'Prefab Instance',
      icon: faCubesStacked,
      order: GROUP_SECTION_ORDER + 125,
      body: {
        kind: 'custom',
        render: () => <PrefabInstanceSection adapter={adapter} nodeId={node.id} />,
        data: {
          component: description.componentName,
          sourcePath: description.sourcePath ?? null,
          overrideCount: description.overrides.length,
          overrides: description.overrides.map((override) => ({
            path: override.path,
            value: override.value,
            default: override.defaultText ?? null,
            canApplyToComponent: override.canApplyToComponent,
          })),
        },
      },
    },
  ];
}

const registrationGroup = createHmrRegistrationGroup(import.meta.hot, 'prefab-instance-inspector');
registrationGroup.ensure((track) => {
  track(registerInspectorSections({ match: matchesPrefabInstance, sections }));
});
