/**
 * NOT IMPLEMENTED — this game's Analytics contribution.
 *
 * Replace this stub with analysis that answers this game's development
 * questions. Choose its metrics and presentation from the game's needs.
 * A raw event listing does not fulfill this contribution.
 *
 * The editor already supplies the Gameplay Session picker, playback/scrub
 * controls and optional recording preview. Keep those shared facilities;
 * derive this contribution's analysis from the selected session and cursor
 * supplied through gameplaySessions, never from live simulation state.
 */
import type { ToolAnalyticsContributionProps } from '@volter/editor-sdk/contributions';

export const point = 'workspace.analytics';
export const title = 'Analytics';

const unfinished =
  'VGAI_STUB_UNIMPLEMENTED: src/contributions/analytics.analytics.tsx — replace this stub with game-specific analysis of recorded Gameplay Sessions; playback is provided by the editor.';

// biome-ignore lint/suspicious/noConsole: unopened starter obligations remain visible in the editor console
console.error(unfinished);

export default function AnalyticsStub(_props: ToolAnalyticsContributionProps): never {
  throw new Error(unfinished);
}
