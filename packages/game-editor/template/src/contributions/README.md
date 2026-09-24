# `src/contributions/` — what this game adds to the editor

These files are this game's editor plugin. They are ordinary React/TSX, found
by filename:

- `*.inspector.tsx` — a section on an inspected subject;
- `*.document.tsx` — a workspace document;
- `*.utility.tsx` — a compact bottom-drawer instrument;
- `*.analytics.tsx` — the game-owned body inside the shared Gameplay Session
  shell.

There is no registry, command vocabulary, generated form, or prescribed panel
layout. A contribution exports its `point`, its `title`, and its default React
component. Write the surface this game's studio would actually use, in the
game's own vocabulary. Import controls from `@vgai/editor-sdk/widgets`; use ordinary
React and CSS for the rest.

A completed contribution is a usable interface: game-specific labels,
relevant readings and working controls. Raw JSON/object dumps do not fulfill
the contribution. Verify its actual presentation and controls before removing
the unfinished-stub warning.

## Live game modules

A live contribution must read the running mount's own module instances through
[`use-game-modules.ts`](./use-game-modules.ts). Do not directly import a
gameplay module from a contribution: the editor and game have different import
graphs, so that creates a second, phantom copy of module state.

```tsx
import type { ToolInspectorContributionProps } from '@vgai/editor-sdk/contributions';
import { Button } from '@vgai/editor-sdk/widgets';
import { useGameModules } from './use-game-modules';

export const point = 'selection.inspector';
export const title = 'Cooling QA';

export default function CoolingQa({ play }: ToolInspectorContributionProps) {
  const { mods, error } = useGameModules(play, {
    cooling: 'src/sim/cooling.ts',
  });
  const cooling = mods?.cooling as
    | { readCooling?: () => { temperature: number }; setupHeatSpike?: () => void }
    | undefined;
  const state = cooling?.readCooling?.();

  return (
    <div>
      <div>{error ?? `Temperature: ${state?.temperature ?? '—'}`}</div>
      <Button onClick={() => cooling?.setupHeatSpike?.()}>Set up heat spike</Button>
    </div>
  );
}
```

The module owns the mechanic, readout, and setup function. The contribution is
only its human face. A coding agent reaches the exact same functions through:

```js
game.run(async ({ modules }) => {
  const cooling = await modules('src/sim/cooling.ts');
  return cooling.readCooling();
})
```

## The three starter surfaces

These three panels arrive with the `studio` addition (`game-editor create <name> --with
studio`, or `--template full`). NO preset brings them otherwise — nothing a
project inherits may error, and these three THROW until they are rewritten
(orchestrator ruling, 2026-09-19). Asking for `studio` is asking for the TODO.

- `tester.inspector.tsx` is deliberately unfinished. Rewrite it whole as the
  live QA cockpit for this game: controller ownership, available goals, the
  active goal's intent/step/target/progress/blocker/decision/outcome, start and
  redirect controls, stop/handoff, setup cheats, and the live readings needed
  to judge rare situations. Setup may conjure a situation; the resident tester
  still exercises the mechanic through normal input at simulation speed.
- `data.document.tsx` is deliberately unfinished. Render the game's typed
  literals from `src/data/` with the derived columns and charts collaborators
  need. Delete the file when the game genuinely has no authored content
  tables.
- `analytics.analytics.tsx` is deliberately unfinished. The editor owns the durable Gameplay
  Session selector, real-time scrub rail, and optional recording preview. Its
  body receives the selected log and cursor and deliberately receives no live
  `play` object. Replace the stub with analysis of the selected session that
  answers this game's development questions. A raw event listing does not
  fulfill the contribution; never import live simulation state into Analytics.

All three stubs emit `VGAI_STUB_UNIMPLEMENTED`. That warning keeps the live
console red, and `npm run check-idioms` reports it as unfinished work. Remove
the sentinel only by replacing the stub with the game's real surface (or by
honestly deleting the optional Data surface), not by silencing the warning.

There is no committed autoplay route or QA spec. Playtesting is interactive:
the developer arranges a situation through exported setup functions, directs
the resident tester toward a goal, advances sim time, reads the play log and
visible result, and redirects as needed. `logs/play-*.jsonl` is the receipt.
