/**
 * The BLENDER style bundle — Blender's greys and widget blue as a palette
 * document (`blender.palette.json`, the same v3 shape a person imports), its
 * own opaque material, and Blender's chrome regions
 * (`@volter/editor-sdk/looks`, a `workspace.style` contribution).
 *
 * The material transcribes Blender's default theme: widgets round at 0.2 of
 * their height (4px on a 20px widget), areas and panels are flat with no
 * shadow, and only menus and popovers cast one (`menu_shadow_fac` 0.5 over
 * `menu_shadow_width` 4). The `large` radius is our reading — Blender rounds
 * its popovers the same as its menus. The density is measured from Blender
 * 5.2's own frames at 1x (`/Volumes/PeakSSD/volter-work/blender-reference`):
 * 26px top bar and area headers, 24px status bar, and — re-measured against
 * the frames widget by widget — EVERY widget 20px tall, button/field/toggle
 * alike, so all three control sizes are 20 rather than a 18/20/24 ramp
 * Blender does not have. Its UI face measures 11px (an 8px cap+ascender on
 * "Add Modifier"); the rest of the type scale is our reading.
 *
 * THE ICON SET (`blender.icons.json`) IS PART BLENDER'S, AND THAT IS WHY THIS
 * PACKAGE CARRIES TWO LICENCES. Of its 346 glyphs, 197 are machine-TRACED —
 * byte for byte — from Blender's own vector sources
 * (`release/datafiles/icons_svg/*.svg`, 188 distinct files at the engine's
 * pin): an affine transform of Blender's outline onto a 16-unit grid, nothing
 * re-proportioned or re-centred, so a traced glyph IS Blender's drawing and a
 * derivative of GPL-2.0-or-later artwork. Their provenance — `ICON_*` name,
 * source file and sha256 per glyph — is `blender.icons.traced.json`, written
 * by `blender-icon-trace.mjs`. The other 149 are our own drawings in Blender's
 * idiom: a 16-unit grid, monochrome filled silhouettes, ~1.3-unit round-ended
 * strokes, no outline around a fill.
 *
 * So `@volter/editor-blender` is `AGPL-3.0-only AND GPL-3.0-or-later` — our code AGPL,
 * Blender's artwork GPL, combined under each licence's §13
 * (`packages/blender/LICENSE` carries the notice and both texts). NOTHING
 * TRACED MAY BE COPIED INTO AN APACHE-2.0 OR MIT PART OF THIS REPO;
 * `packages/editor`'s own icon set in particular stays free of it.
 *
 * A glyph is EDITED in `blender-icons.source.mjs` and the JSON re-emitted by
 * running it; a path `d` is not a thing a person edits by hand.
 */
import type { IconSetContribution, StyleContribution } from '@volter/editor-sdk/looks';
import iconsJson from './blender.icons.json';
import palette from './blender.palette.json';

/**
 * `resolveJsonModule` widens every string in a JSON import, so each glyph's
 * `tone` arrives typed `string` rather than the `IconCategoryTone` union it
 * holds. The generator is what narrows it: `blender-icons.source.mjs` checks
 * every assignment against the union's own member list and throws on a name
 * outside it, so the JSON cannot carry a tone this type does not have.
 */
const icons = iconsJson as IconSetContribution;

export const point = 'workspace.style';
export const style: StyleContribution = {
  id: 'blender',
  title: 'Blender',
  paletteId: 'blender',
  materialId: 'blender',
  material: {
    id: 'blender',
    title: 'Blender',
    description: 'Flat opaque areas, four-pixel widget corners, shadows under menus only.',
    shape: { small: '4px', medium: '4px', large: '4px', full: '9999px' },
    elevation: {
      small: 'none',
      medium: '0 4px 12px rgba(0,0,0,0.5)',
      large: '0 6px 18px rgba(0,0,0,0.55)',
    },
    density: {
      control: { compact: 20, default: 20, comfortable: 20 },
      font: { xs: 9, sm: 10, base: 11, md: 11, lg: 12 },
      // Blender's glyphs, measured at matched scale: 14 px through the
      // chrome (the Properties tab rail in `properties-data-edit.png`, the
      // Outliner's row and toggle marks in `outliner.png`).
      //
      // `2xl` is now MEASURED too, and it came down from the extrapolated 20.
      // Its only consumer is the viewport navigation cluster
      // (`ViewportFurniture.tsx`), and Blender's own cluster in
      // `modeling-object-none.png` draws 15x15 px of INK at 1x. These glyphs
      // ink at ~0.85 of their box (`blender-icons.source.mjs`'s `S` dial), so
      // 15 px of ink is an 18 px box — at 20 the cluster measured 17x17,
      // two pixels heavier than the frame it is copying.
      //
      // `xs` IS MEASURED NOW, and the note it replaces was wrong about the
      // frames: they do show glyphs below the 14 px chrome rung — the claim
      // had only ever looked at the status bar. The whole sub-14 inventory,
      // ink bounding boxes in CSS px (device halved), all at native 2x:
      //
      //   `+` Add Modifier      `properties-modifier.png`   9.0 x 9.0
      //   `+` list add          `properties-data-edit.png`  9.0 x 9.0
      //   chevron, list button  `properties-data-edit.png`  9.0 x 5.0
      //   chevron, panel band   `properties-data-edit.png`  9.0 x 5.0
      //   caret, datablock well `properties-data-edit.png`  6.5 x 4.0
      //   caret, editor-type    `properties-modifier.png`   6.5 x 4.0
      //   grip `::::`           `properties-data-edit.png` 10.0 x 4.0
      //   triangle, list row    `properties-data-edit.png`  6.0 x 5.0
      //
      // FOUR of those agree at 9.0 wide and that is the rung. Solved against
      // the one glyph both sides draw on the same fill (`#535353`, so the
      // threshold is identical): Blender's `+` arms measure 17.43 and 17.08
      // device px by sub-pixel coverage, mean 8.63 CSS; ours at `xs` 12
      // measure 20.75 device (10.38 CSS, against the path's own geometric
      // bbox of 10.48 — they agree to a tenth). Our glyphs ink 0.865 of the
      // box, so the box that inks 8.63 is 9.98. Two other estimators on the
      // same pair — ink MASS (mass scales as the square, ratio 0.8171) and
      // the pixel bbox (18/22 = 0.818) — give 9.81 and 9.82. The rung is 10.
      //
      // THE RUNG WAS CHECKED AGAINST A SECOND GLYPH FAMILY AFTER LANDING,
      // and it holds: at 10 the dock well's caret inks 5.84 x 3.71 CSS
      // against Blender's editor-type caret at 6.0 x 4.0 (12 x 8 device,
      // `properties-modifier.png` x 62..73, y 23..30). Our chevron inks 0.58
      // of its box where the `+` inks 0.87, so the two agree on the rung
      // only because each was solved against its own counterpart — which is
      // why both were measured rather than one inferred from the other.
      //
      // RESIDUE, measured not closed: Blender has TWO chevron sizes, the
      // well caret at 6.0 wide and the panel-band / list-button chevron at
      // 9.0, and they are not a uniform scale of each other (0.67 wide
      // against 0.80 tall). One rung cannot serve both; our chevron lands on
      // the well caret, so a band chevron drawn at `xs` would ink 5.84 where
      // Blender's inks 9.0. Closing that needs a second glyph, not a rung —
      // and no expanded band is on screen in the Model document to confirm
      // it against.
      icon: { xs: 10, sm: 14, md: 14, lg: 16, xl: 16, '2xl': 18 },
      chrome: {
        commandBar: 26,
        panelHeader: 26,
        localToolbar: 26,
        treeRow: 20,
        // The Outliner's tree is a SQUARE grid — one level steps by the row's
        // own height. Measured on the native 2x `outliner.png`: the type
        // glyphs of Scene Collection, Collection and Camera centre at x 60.5,
        // 100.5 and 140.5 device px (30.25 / 50.25 / 70.25 CSS) and each
        // row's chevron sits one cell to the left of its glyph (Collection's
        // at 30.25, Camera's at 50.25), so the step is 20 and the chevron and
        // the glyph each own one cell of it.
        treeIndent: 20,
        statusBar: 24,
        // The toolbar, RE-MEASURED 2026-09-18 on the native 2x frame
        // (`modeling-edit-none.png`, column x=25 and row y=400): a tool is a
        // 40x35 BORDER BOX — 38x34 of `widget.menu` fill inside a one-pixel
        // boundary — and the boxes are CONTIGUOUS within a group, sharing that
        // one pixel, so the pitch down a strip is 35. Plain viewport shows
        // only BETWEEN groups (four times in Blender's twenty-one-tool rail).
        // These three numbers are the border box, because that is what the
        // rail's CSS sets and what the collapse (`margin-block-start: -1px`
        // in `workspace-dock.css`) measures against: 36 - 1 = the 35 pitch.
        //
        // `toolGap` RE-RE-MEASURED 2026-09-19 on the same frame, BOX EDGE TO
        // BOX EDGE rather than fill to fill: group 1's border box ends at
        // device y 312 and group 2's begins at 323, so the separation is 10
        // device px — 5 CSS, not the 7 or 8 the two earlier readings gave.
        // Both were counting the group's own 1 CSS px emboss (device rows
        // 313-314, luminance 53 over the viewport's 63) and the two borders
        // as part of the bare viewport between the groups.
        toolSize: 36,
        toolWidth: 40,
        toolGap: 5,
        // THE AREA SEAM, measured on the native 2x `modeling.png`: the
        // Outliner-to-Properties groove (median over x 2900..3400) runs
        // y 419..425 as (21,21,21) and the viewport-to-Properties groove
        // runs x 2836..2842 as the same value — 7 device px, 3.5 CSS px,
        // both times with a one-pixel lighter emboss on each side. The
        // colour is the palette's `color.boundary.area`.
        areaSeam: 3.5,
        // THE EMBOSS on each side of that groove, as percent of white mixed
        // into the area's OWN fill. SOLVED on the native 2x `modeling.png`
        // from four fills and their light bands — Properties 47 -> 64
        // (x=3200, y 426..427), Outliner 39 -> 57/56 (y=300, x 2843..2844),
        // the Properties tab rail 23 -> 43/42 (y=1500, same columns), the
        // Outliner's alternate row 42 -> 59/60 (x=3200, y 417..418) — whose
        // individual alphas are 8.17/8.10/8.62/8.45%, mean 8.14; 8.2 is the
        // one value that renders all four measured integers. The viewport's
        // 63 -> 93/94 and the 3D View header's 52 -> 86 are this same lift
        // applied TWICE; see `theme.ts`'s `areaEmbossValue`.
        areaEmboss: 8.2,
      },
      viewport: {
        // BLENDER'S GIZMO IS A CONSTANT SCREEN SIZE (owner, 2026-09-21: "is
        // gizmo perhaps the wrong size?"). `U.gizmo_size` is 75
        // (`DNA_userdef_types.h:1095`; Preferences > Viewport > Gizmos > Size,
        // `rna_userdef.cc:5415-5419`, range 10..200), and it is px PER GIZMO
        // UNIT: `wm_gizmo.cc:450-474` sets `scale_final = scale_basis *
        // UI_SCALE_FAC * U.gizmo_size * ED_view3d_pixel_size_no_ui_scale(...)`,
        // whose last term is world units per DEVICE px against a
        // `UI_SCALE_FAC` of device px per UI px — so one gizmo unit is 75 CSS
        // px whatever the display scale (read back from the engine's own pin
        // on this box: `ui_scale=2.0 pixel_size=2.0 gizmo_size=75`).
        gizmoSize: 75,
        // BLENDER'S FLOOR LINES, in device pixels, measured across one scanline of
        // `modeling-object-none.png` at device resolution: the 1 m line is 4 px at half rise and
        // plateaus at 83, the 10 m line is 6 px and plateaus at 101 — so the major line is wider
        // (2.25 against 1.5) and carried (102 − 63) / (84 − 63) past the minor's colour from the
        // background they share. Stated here, the look's, since the editor's own floor is a
        // single hairline level.
        gridLineWidth: 1.5,
        gridMajorWidth: 2.25,
        gridMajorContrast: 39 / 21,
      },
    },
  },
  icons,
  palette,
};
