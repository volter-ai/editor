import type { EditorRegionName, WorkspacePanelGlyphName } from '@volter/editor-sdk/widgets';
import { Button } from '@volter/editor-sdk/widgets';
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { WORKSPACE_STATIC_PANELS, type WorkspaceStaticPanelKind } from '@volter/editor-sdk/kit/workspace-static-panels';
import { AssetBrowser, type AssetBrowserServices } from './AssetBrowser';
import { ChromeSlot } from './ChromeSlot';
import { GameHierarchy } from './GameHierarchy';
import { Inspector } from './Inspector';

export interface WorkspaceStaticPanelDependencies {
  readonly assets?: AssetBrowserServices;
}

interface WorkspaceStaticPanelContentProps {
  readonly dependencies?: WorkspaceStaticPanelDependencies | undefined;
}

export interface WorkspaceStaticPanelRegistration {
  readonly kind: WorkspaceStaticPanelKind;
  readonly title: string;
  readonly hotkeyScope: (typeof WORKSPACE_STATIC_PANELS)[number]['hotkeyScope'];
  readonly selectableText: boolean;
  /** The EDITOR-AREA fill this panel claims (`workspace-static-panels.ts`);
   *  absent means the one fill every dock group shares. */
  readonly region?: EditorRegionName;
  /** The glyph this panel shows in Blender's editor-type well
   *  (`workspace-static-panels.ts`; the well is `groupTabs: 'well'`). */
  readonly icon?: WorkspacePanelGlyphName;
  readonly Content: ComponentType<WorkspaceStaticPanelContentProps>;
}

const CONTENT_BY_KIND: Readonly<
  Record<WorkspaceStaticPanelKind, ComponentType<WorkspaceStaticPanelContentProps>>
> = {
  // The CONVERSATIONS panel's place is the host's; its surface is not. The
  // agent-harness conversation UI is `@vgai/agents`, filling the `panel:agent`
  // chrome slot (`chrome-slot-registry.ts`); a build without that package
  // shows an empty panel rather than an imported one.
  agent: () => <ChromeSlot slot="panel:agent" />,
  // The PROJECT WORK panel's place is the host's; its surface is not. A
  // `ztrack` board of the worktree's open work, with "work on this with an
  // agent" beside it, is `@vgai/agents` — the same reasoning as the two rows
  // around it, and the same door. Its `services` prop came with it: nothing in
  // the product ever supplied one (only a design-system story did), so the
  // panel's own defaults are what ran.
  'project-work': () => <ChromeSlot slot="panel:project-work" />,
  hierarchy: GameHierarchy,
  assets: ({ dependencies }) => <AssetBrowser services={dependencies?.assets} />,
  // The LIBRARY panel's place is the host's; its surface is not. Browsing an
  // external provider's catalog is `@vgai/asset-library`, filling the
  // `panel:asset-library` chrome slot (`chrome-slot-registry.ts`) exactly as
  // the `agent` row above does; a build without that package — the
  // open-source core+Blender cut — shows an empty panel rather than an
  // imported managed-service client.
  'asset-library': () => <ChromeSlot slot="panel:asset-library" />,
  inspector: Inspector,
};

/**
 * A crash inside ONE static panel stays inside that panel.
 *
 * Without this, a panel's render throw climbed to `EditorRuntimeBoundary`
 * (AppRoot), which replaces the WHOLE editor with the startup-error screen:
 * the dock, the viewport and the game container all unmount, so play refuses
 * ("the game container is not mounted"), and React's recovery re-creates the
 * crashed subtree from scratch — a panel that crashes deterministically then
 * crashes again on every recovery. The blind modeling bench measured the
 * whole chain from a single Agents-panel throw (a duplicate `session-1` row
 * key from the harness UI, then "Maximum update depth exceeded"): 53
 * recoveries, the main thread pegged, the WebSocket dropped with 1006, the
 * tab's heartbeat silent for 30 s, the tab declared departed, and every
 * `vgai screenshot` refused with "No tab has been present" until the agent
 * ran `vgai edit` again — in four of five sessions.
 *
 * The boundary reports the throw ONCE to the editor console (so `vgai
 * console` carries it and its component stack), renders a small notice in the
 * panel's own space, and remounts the panel ONLY when the user clicks Retry —
 * never automatically, because an automatic remount of a deterministic crash
 * is the loop above.
 */
class StaticPanelCrashBoundary extends Component<
  { readonly title: string; readonly children: ReactNode },
  { readonly error: Error | null }
> {
  override state: { readonly error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { readonly error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    editorConsole.error(
      `The ${this.props.title} panel crashed and was taken down alone (the rest of the editor ` +
        `stays up; Retry in the panel remounts it): ${error.message}\n${info.componentStack ?? ''}`,
      'editor',
    );
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="static-panel-crashed"
        style={{ padding: 12, display: 'grid', gap: 8, alignContent: 'start' }}
      >
        <strong>{this.props.title} crashed.</strong>
        <span style={{ opacity: 0.8, wordBreak: 'break-word' }}>{this.state.error.message}</span>
        <div>
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }
}

/** Canonical realization of the static-panel inventory. Every host — the
 * frame, a bounded production host, a story fixture — consumes this same
 * registry; there is no second switch or story-only component map to drift. */
export const WORKSPACE_STATIC_PANEL_REGISTRY: readonly WorkspaceStaticPanelRegistration[] =
  WORKSPACE_STATIC_PANELS.map((panel) => {
    const Inner = CONTENT_BY_KIND[panel.kind];
    const Content: ComponentType<WorkspaceStaticPanelContentProps> = (props) => (
      <StaticPanelCrashBoundary title={panel.title}>
        <Inner {...props} />
      </StaticPanelCrashBoundary>
    );
    Content.displayName = `StaticPanel(${panel.kind})`;
    return { ...panel, Content };
  });

export function workspaceStaticPanelRegistration(
  kind: WorkspaceStaticPanelKind,
): WorkspaceStaticPanelRegistration {
  return WORKSPACE_STATIC_PANEL_REGISTRY.find((panel) => panel.kind === kind)!;
}

export function WorkspaceStaticPanelSurface({
  kind,
  dependencies,
}: WorkspaceStaticPanelContentProps & { readonly kind: WorkspaceStaticPanelKind }) {
  const { Content } = workspaceStaticPanelRegistration(kind);
  return <Content dependencies={dependencies} />;
}
