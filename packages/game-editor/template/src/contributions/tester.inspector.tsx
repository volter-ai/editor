/**
 * NOT IMPLEMENTED — this game's TESTER surface.
 *
 * This stub is an OBLIGATION, not an implementation. It claims WHAT this
 * game must make available: a live QA cockpit that helps a human or AI tester
 * direct the resident tester, understand its goals and decisions, arrange
 * difficult situations, and judge the mechanic under test. It says nothing
 * about HOW. REWRITE THIS FILE WHOLE in the game's own vocabulary: rename it,
 * split it into several faces, and structure it the way THIS game's studio
 * would. The error below holds `vgai console` red until you do; delete it
 * with the stub.
 *
 * Make the controller's current owner and the tester's repertoire legible.
 * While a goal runs, expose enough of its mind to explain its intent, current
 * step and target, progress, blockers, latest observation or decision, and
 * outcome. Give the operator clear ways to start, direct, redirect, stop, and
 * hand off the tester. A control's outcome or refusal must be visible,
 * including a goal that completes before the next paint.
 * Present these as readable game-specific labels, readings and controls.
 * A raw JSON/object dump does not fulfill this contribution; keep the
 * unfinished error until the actual interface meets this requirement.
 *
 * Put setup cheats here when honest play would make a QA situation costly or
 * rare, together with the exact live readings needed to judge it. A cheat may
 * establish the situation; the tester still exercises the behavior under
 * judgment through the game's normal input path at simulation speed.
 * Historical metrics belong in Analytics, and authored content or tuning
 * belongs in Data.
 *
 * Read the RUNNING game's own modules through `useGameModules`
 * (`./use-game-modules` — a direct import from a contribution is a phantom
 * second copy); hand-type the slice of each module you read. Human controls
 * call the same ordinary exported functions an agent reaches through
 * `game.run(({ modules }) => ...)`. The worked reference is the
 * datacenter-tycoon game's `src/tools/`.
 */
import type {
  ToolContributionNode,
  ToolInspectorContributionMatchContext,
  ToolInspectorContributionProps,
} from '@volter/editor-sdk/contributions';

export const point = 'selection.inspector';
export const title = 'Tester';

export function match(
  node: ToolContributionNode | null,
  _adapter: unknown,
  context?: ToolInspectorContributionMatchContext,
): boolean {
  return node === null && context?.nullSubjectId === 'game';
}

// Module-scope on purpose: fires the moment the editor loads this game's
// contributions, so the demand is visible before anyone opens the panel.
const unfinished =
  "VGAI_STUB_UNIMPLEMENTED: src/contributions/tester.inspector.tsx — imagine this game's tester helper surface and rewrite the file whole (its header says how).";

// biome-ignore lint/suspicious/noConsole: unopened starter obligations remain visible in the editor console
console.error(unfinished);

export default function TesterInspectorStub(_props: ToolInspectorContributionProps): never {
  throw new Error(unfinished);
}
