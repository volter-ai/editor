/**
 * NOT IMPLEMENTED — this game's DATA surface.
 *
 * An OBLIGATION, not an implementation: the game's numbers and content
 * tables (`src/data/` — plain typed TS literals) must be viewable, with
 * their derived picture, by the humans collaborating on this game. How is
 * yours. REWRITE THIS FILE WHOLE; the error below holds `vgai console`
 * red until you do.
 *
 * The method: render the data modules as tables (a plain `<table>` until a
 * table earns a grid — then `react-data-grid`) with the DERIVED columns a
 * studio spreadsheet would compute ($/unit, payback, crossover points —
 * plain functions beside the data), and graphs from a common charting
 * library (e.g. Recharts). Import the data modules directly — for inert
 * data that is file truth, which is what a data view shows. The worked
 * reference: datacenter-tycoon's data document.
 *
 * A game with genuinely NO content tables deletes this file — the
 * deletion, visible in git, is the honest declaration.
 */
import type { ToolContributionProps } from '@volter/editor-sdk/contributions';

export const point = 'workspace.document';
export const title = 'Data';

// Module-scope on purpose — the demand is visible from editor boot.
const unfinished =
  "VGAI_STUB_UNIMPLEMENTED: src/contributions/data.document.tsx — render this game's data (src/data/) with its derived columns, or delete this file if the game truly has no content tables (its header says how).";

// biome-ignore lint/suspicious/noConsole: unopened starter obligations remain visible in the editor console
console.error(unfinished);

export default function DataStub(_props: ToolContributionProps): never {
  throw new Error(unfinished);
}
