/**
 * BLENDER'S AREAS, as the regions every Blender workspace declares (ARCHITECTURE.md rule 7:
 * which regions exist and what a hierarchy row spells are function, the workspace's, never the
 * look's). Each of this package's layouts spreads these beneath its own.
 */
import type { WorkspaceLayoutContribution } from '@volter/editor-sdk/looks';

export const BLENDER_REGIONS: NonNullable<WorkspaceLayoutContribution['regions']> = {
  workspaceTabs: 'shown',
  // Blender has no document tab strip over its areas (the host's own note
  // in `workspace-presets.ts` says so; the bundle contradicted it).
  header: 'shown',
  shelf: 'shown',
  inspector: 'properties',
  // Measured on `modeling.png`: Blender's top-right corner carries two quiet
  // wells (Scene, ViewLayer) and nothing brighter than the 216 its labels
  // ink at. Ours drew a yellow FPS/ms readout, an orange sparkline and a lit
  // audio meter there — the brightest, highest-chroma thing in the frame and
  // the first place the eye lands. The numbers keep their door (the Profiler
  // utility, which the readout's own tooltip names).
  telemetry: 'hidden',
  // Measured on `outliner.png`: Scene Collection, Collection, Camera, Cube
  // and Light each carry their NAME and nothing after it — no type text
  // anywhere in the frame. The type is the GLYPH, which is why the glyph is
  // coloured by category in the first place; a row that also spelled the
  // type would say it twice. Ours printed `Hero Box ·HeroBox` at
  // `content.dim` in a 10px face, one `space-2` past the name.
  hierarchyTypeSuffix: 'hidden',
  // Measured across all three Outliner frames — `outliner.png` (edit mode),
  // `modeling-object-none.png` (object mode, nothing selected) and
  // `modeling-object-selected.png` (object mode, everything selected):
  // Blender draws NO rule, dotted or solid, under any name in that panel, in
  // any selection state. Ours drew an orange dotted rule under every
  // component-instance name — six of this scaffold's eleven rows — which is a
  // mark with no counterpart in the frame at all. The instance fact keeps its
  // doors (the label's tooltip, Go to Callsite / Open Component Source, the
  // inspector's component sections); only the paint yields.
  hierarchyInstanceRule: 'hidden',
  // Measured on `outliner.png`: every object row carries an EYE (CSS ink
  // 257.5-270.5, 32 px in from the area's right edge) and a render CAMERA
  // (277.5-290.5, 12 px in) on a 20 px column pitch, and no lock glyph
  // anywhere — Blender's Disable Selection column is off by default. Ours
  // drew a lock 29-41 px in and the eye 6-18 px in, so the LOCK was sitting
  // in Blender's eye column and the eye outboard of its camera column. The
  // lock goes, and the render column is reserved blank so the eye lands on
  // Blender's own; `workspace-regions.ts` carries why it stays blank.
  hierarchyRestrictions: 'viewport+render',
  // Measured at native 2x on `outliner.png` AND on the Properties area of
  // `modeling-edit-none.png` — device x relative to each area's own left
  // edge, and the two agree to half a pixel: every Blender area begins with
  // an EDITOR-TYPE WELL at x 17..80, i.e. 8.5 CSS in and 32 CSS wide, 20
  // tall, its glyph and a chevron inside a 1 px `#3c3c3c` outline over a
  // `#272727` inner. It is there whether the area holds one editor or a
  // dozen, and its dropdown is how an area changes editor. Ours began with
  // a 203 px strip of WORDS, which is what squeezed the Outliner's search
  // to 64 px against Blender's 115, truncated the third tab to `Libr`, and
  // left the Properties area — a lone panel declaring no header controls —
  // with no header band at all.
};
