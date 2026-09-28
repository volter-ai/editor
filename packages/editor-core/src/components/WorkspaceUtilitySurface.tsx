import type { WorkspaceUtilityRegistration } from '@volter/editor-sdk/kit/workspace-utility-registry';

/** Canonical host for one registered workspace utility. */
export function WorkspaceUtilitySurface({
  utility,
  testId,
}: {
  readonly utility: WorkspaceUtilityRegistration;
  readonly testId?: string | undefined;
}) {
  const Content = utility.Content;
  return (
    <div
      className="volter-dock-panel volter-regular-panel-portal"
      data-testid={testId ?? `bottom-panel-utility-${utility.id}`}
      data-editor-hotkey-scope="workspace"
      data-volter-noselect="true"
    >
      <Content />
    </div>
  );
}
