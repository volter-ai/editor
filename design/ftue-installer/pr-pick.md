The owner, trying the browser editor (cyclotron-web, Canyon Comet), on 2026-10-07: "I can't click on any of the carts".

**Cause.** The viewport pick itself is correct. StageHost.tsx:1334-1350 resolves the kart part through the presentation index, and the batched-instance raycast hits it. The selection is lost afterwards:
- `rna_outliner` answers only the first `_OUTLINER_PAGE` = 64 rows of each child list (session.py:3848, `page_tree` :5253).
- The Blender Outliner adapter turns ids into Blender names through rows only (`rowIdFor`/`rowIdForObject`, blender-outliner-authoring.ts:1135-1169, 1283-1315). An object with no row is dropped, and the click writes an empty selection.
- In Canyon Comet the collection has 1,146 top-level rows. The tree stops at Lane dash 057 with `more=1082`, and Kart.0-5 are rows 96-101.
- Since 9e39dba2, the Properties rail shows the still-active object, so the click seemed to select something behind the kart.
- Every object past row 64 of its list fails the same way: in this scene, about 1,000 environment objects, the camera and the sun.
- The code is unchanged from 0.5.191 to main.

**Fix.**
- `selection.set` (TS): an id with no row is named by identity (`threeObject` → `presented().blenderObjectName`), so Blender selects and activates it.
- `page_tree` (Python): keeps the rows of selected and active objects, and of every row above them, past the page. The next tree read then gives the outline, gizmo and Outliner their row through the existing `subscribeBlenderOutliner(syncFromEngine)`.
- What the user sees: the outline appears one engine round trip after the click. A click selects the part (e.g. "K0 sculpted chassis"), as Blender's click-select does.

**How it was established** (no tests, per repo rule):
- **Read in code:** the pick path, the row-only lookup, the cap and the Properties fallback.
- **Probe under node, real main TS:** a kart part under an Empty, batched by `BlenderRuntimeInstances`, resolves to its source id, and a row lookup on that id returns null.
- **Blender 5.2.2 headless, on a copy of the .blend:**
  - Main's `rna_outliner` gives 67 of 1,493 object rows, ends at Lane dash 057, and has no Kart.0 row even when it's passed as selected.
  - The patched one gives rows for Kart.0 and "K0 sculpted chassis" when the engine selects that part.
- **Typecheck:** nothing in blender-outliner-authoring.ts. I checked against another checkout's dependencies, so the only errors were that checkout's cross-package drift.
- **Not yet run in the editor.** I'll confirm on the release with Canyon Comet, by clicking a kart in the viewport.

The browser editor (cyclotron-web) needs a rebuild from the release that carries this.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
