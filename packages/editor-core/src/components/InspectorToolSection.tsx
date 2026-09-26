/**
 * Inspector-tool section host (W3) — renders one project tool (`placement:
 * 'inspector'`) as a section in the ONE inspector shell (`Inspector.tsx`), via
 * `inspector-section-registry`.
 *
 * The chrome is the editor's (§3.4): a bordered section with a semantic tool
 * icon in its title row, matching
 * the shell's own section styling (`Inspector.tsx`'s Stories block). What the
 * tool renders inside is its own business — plain React, ideally built from
 * `@volter/editor-sdk/widgets` so fields sit flush with the built-in sections.
 *
 * Crash containment mirrors the dock (`ToolHost.tsx`, shared boundary): a
 * throwing tool component swaps THIS section for a teaching message; the
 * rest of the inspector, and every other tool, keep working. The loader
 * re-registers a fresh registration per (re)load, so an HMR save remounts
 * the section and clears a tripped boundary for free.
 *
 * W3.1 (§3.3): the tool render is wrapped in `EditorSelectionProvider`, INSIDE
 * the error boundary, so `useSelection()` works for any inspector tool
 * without adding to `InspectorToolProps` — richer data arrives through hooks,
 * not more props. Utility tools get no such provider (`ToolHost` inside a
 * utility has no adapter/selection in scope) — `useSelection` throws a
 * teaching error, contained the same way a render crash is.
 */

import type { ToolInspectorContributionProps } from '@volter/editor-sdk/contributions';
import { EditorSelectionProvider } from '@volter/editor-sdk/selection';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { type ComponentType, useSyncExternalStore } from 'react';
import { accountVersion, contributionAccount, subscribeAccount } from '@volter/editor-sdk/kit/account-client';
import type { ProjectToolCatalogEntry } from '../project-tools';
import {
  subscribeToolContributionPlay,
  toolContributionPlay,
  toolContributionPlayKey,
} from '@volter/editor-sdk/kit/tool-contribution-play';
import { getToolContributionClient } from '../tool-loader';
import { toolContributionSurfaces } from '@volter/editor-sdk/kit/components/ToolContributionSurfaces';
import { ToolErrorBoundary } from './ToolHost';

export interface InspectorToolSectionProps {
  /** `ToolConfig.id` — the section's `data-testid` suffix (`inspector-tool-<id>`). */
  id: string;
  /** The contribution's title — shown by the SECTION HEADER (the collapsible
   *  row the inspector owns); the body deliberately does not repeat it. */
  title: string;
  /** Project-relative source file, shown in crash/teaching messages. */
  file: string;
  /** The registered callable the module named, when it named one at all. */
  tool?: ProjectToolCatalogEntry;
  Component: ComponentType<ToolInspectorContributionProps>;
  /** Live adapter + selection, as the section registry hands them over. */
  adapter: AuthoringAdapter;
  nodeId: string | null;
}

/** One inspector tool's section: editor-styled chrome + boundary + the tool. */
export function InspectorToolSection({
  id,
  title: _title,
  file,
  tool,
  Component,
  adapter,
  nodeId,
}: InspectorToolSectionProps) {
  useSyncExternalStore(subscribeAccount, accountVersion, accountVersion);
  // Re-render when the bound play instance changes, so a section mounted
  // before Play (or while another seat was inspected) does not keep reporting
  // "no game" to a contribution whose whole subject is the running one.
  useSyncExternalStore(
    subscribeToolContributionPlay,
    toolContributionPlayKey,
    toolContributionPlayKey,
  );
  const node = nodeId ? adapter.hierarchy.node(nodeId) : null;
  return (
    <div className="vgai-inspector-tool-section" data-testid={`inspector-tool-${id}`}>
      <ToolErrorBoundary file={file}>
        <EditorSelectionProvider adapter={adapter} nodeId={nodeId}>
          <Component
            {...(tool ? { tool } : {})}
            contributionId={id.slice(id.lastIndexOf(':') + 1)}
            client={getToolContributionClient()}
            surfaces={toolContributionSurfaces}
            account={contributionAccount()}
            play={toolContributionPlay()}
            node={node}
            nodeId={nodeId}
            adapter={adapter}
          />
        </EditorSelectionProvider>
      </ToolErrorBoundary>
    </div>
  );
}
