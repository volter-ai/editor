/**
 * THE TIMELINE'S CONSTANTS — every one read from Blender's source at the
 * engine's pin (5.2.0, `fbe6228777e7`) AND checked against a PIXEL in Blender's
 * own frame (5.2.1 on this box, `scripts/blender-reference-frames.py`).
 *
 * This is the first unit of the inspection arc with a sighted read behind it.
 * I1-I5 each recorded "`/Volumes/PeakSSD` was not mounted, so this is graded
 * against Blender's SOURCE alone"; Blender is installed here, the script above
 * drives its real GUI, and the numbers below carry three things each: the
 * source that defines them, the pixel that confirms them, and what we draw.
 *
 * ## The screenshot reads ONE 8-BIT LEVEL BELOW the theme byte
 *
 * Measured on every flat fill in the frame: the theme's `#303030` reads
 * `#2f2f2f`, `#1d1d1d` reads `#1c1c1c`, `#161616` reads `#151515`,
 * `#4772b3` reads `#4671b2`, `#ffbe33` reads `#ffbd32`. It is uniform and it
 * is the screenshot path's, not the theme's — so the values below are the
 * THEME BYTES (what Blender means) and a reader comparing them against a
 * reference PNG should expect that −1.
 *
 * ## The theme's own table disagrees with the source's default in one place,
 * and the running theme wins
 *
 * `userdef_default_theme.c:490` declares `.space_action.back` as
 * `RGBA(0x30303000)` — alpha ZERO. Read off the RUNNING factory theme
 * (`bpy.context.preferences.themes[0].dopesheet_editor.space.back`) it is
 * `#303030ff`. The difference is load-bearing: `ANIM_draw_framerange` paints
 * the out-of-range area with `TH_BACK` shaded −25 at alpha −100, which at
 * alpha 0 would draw NOTHING and at alpha 255 draws a visible darkening. The
 * frame settles it — outside the range is `#202020` against `#2f2f2f` inside,
 * which is exactly `48 + (23 − 48) × 155/255 = 32.8`. The screenshot wins.
 */

/** `U.widget_unit` — `wm_window.cc:779`, `int(roundf(18 * scale_factor)) + 2 *
 *  pixelsize` = 20 at scale 1. Confirmed in the frame: a transport button
 *  block of six is 120 px wide (x 697…816), so each is 20. */
export const WIDGET_UNIT = 20;

/** `UI_TIME_SCRUB_MARGIN_Y` — `UI_view2d.hh:491`, `23 * UI_SCALE_FAC`. The
 *  strip the ruler and the playhead's number pill live in. CONFIRMED: the
 *  Timeline area's `.regions.scrubbing.back` band is exactly 23 px tall
 *  (image rows 26…48 under a 26-px header). */
export const SCRUB_HEIGHT = 23;

/** `HEADERY` — `DNA_screen_types.h:602`, `20 + HEADER_PADDING_Y`. CONFIRMED
 *  at 26 px, with its 20-px widgets centred (3 px above, 3 below). */
export const HEADER_HEIGHT = 26;

/** `ANIM_UI_get_channel_height` — `anim_channels_defines.cc:5147-5150`,
 *  `0.8 * keyframe_scale_fac * widget_unit`; `keyframe_scale_fac` is 1.0
 *  (`userdef_default_theme.c:508`, and read back 1.0 off the running theme). */
export const CHANNEL_HEIGHT = 16;
/** `ANIM_UI_get_channel_skip` — `:5152-5155`, `0.1 * widget_unit`. */
export const CHANNEL_SKIP = 2;
/** `ANIM_UI_get_first_channel_top` — `:5157-5160`: the first row's TOP is
 *  `-UI_TIME_SCRUB_MARGIN_Y - skip` below the region's top edge. */
export const FIRST_CHANNEL_TOP = SCRUB_HEIGHT + CHANNEL_SKIP;

/**
 * THE TIMELINE DRAWS EXACTLY ONE CHANNEL ROW, and that is a source fact rather
 * than a layout choice: `action_create` sets `ADS_FLAG_SUMMARY_COLLAPSED` when
 * the area's subtype is `SACTCONT_TIMELINE` (`space_action.cc:80-83`), and
 * `animdata_filter_dopesheet` returns 0 right after adding the summary channel
 * when that flag is set (`anim_filter.cc:3845-3849`). The channel-NAMES region
 * is not drawn at all in Timeline mode
 * (`action_region_poll_hide_in_timeline`, `space_action.cc:785-790`).
 *
 * THE ROW HAS NO BACKDROP EITHER. `draw_backdrops` branches on
 * `ELEM(ac->datatype, ANIMCONT_ACTION, ANIMCONT_DOPESHEET, ANIMCONT_SHAPEKEY)`
 * and then on GPENCIL and MASK (`action_draw.cc:218-300`); `ANIMCONT_TIMELINE`
 * matches none of them, so the summary row is drawn straight onto the region's
 * own clear. CONFIRMED: the row is `#2f2f2f` inside the frame range, the same
 * value as the rest of the region.
 */
export const TIMELINE_ROWS = 1;

/** `MIN_MAJOR_LINE_DISTANCE` — `view2d_draw.cc:41`, `U.v2d_min_gridsize *
 *  UI_SCALE_FAC`, default 35 (`versioning_userdef.cc:1028-1029`). The real
 *  minimum is `max(35, label width + 6)` (`get_min_line_distance_x`, `:485`,
 *  `text_padding` at `:478`). */
export const MIN_MAJOR_LINE_DISTANCE = 35;
/** `get_label_width`'s `text_padding` — `view2d_draw.cc:478`. */
export const LABEL_PADDING = 6;

/**
 * `calculate_grid_step` — `view2d_draw.cc:88-118`, and it is NOT a table of
 * powers: it starts at the BASE (the scene fps, because the Timeline's ruler
 * is `view2d_draw_scale_x(…, base = fps)` through `ED_time_scrub_draw`,
 * `space_action.cc:298`) and then either SHRINKS it by a special prime
 * factorisation that prefers to land on 2, or DOUBLES it until a step is at
 * least `minDistance` pixels apart.
 *
 * `get_divisor` (`:52-79`) is the shrinking half: of 2, 3 and 5, prefer the
 * divisor whose quotient is exactly 2 ("animating on 2s is a very useful thing
 * for animators"), else the first that divides cleanly, else the distance
 * itself (so the next step down is 1).
 */
export function gridDivisor(distance: number): number {
  const divisors = [2, 3, 5];
  const clean: boolean[] = [];
  for (let i = 0; i < divisors.length; i++) {
    const divisor = divisors[i]!;
    const result = Math.trunc(distance / divisor);
    const exact = result * divisor === distance;
    if (exact && result === 2) return divisor;
    clean[i] = exact;
  }
  for (let i = 0; i < divisors.length; i++) if (clean[i]) return divisors[i]!;
  return distance;
}

/** `calculate_grid_step` (`view2d_draw.cc:88-118`), transcribed. `base` is the
 *  scene fps for a frame ruler; `pixelWidth` is the region's width + 1 and
 *  `viewWidth` the frames it spans. */
export function gridStep(
  base: number,
  pixelWidth: number,
  viewWidth: number,
  minDistance: number,
): number {
  if (viewWidth === 0) return 1;
  const perUnit = pixelWidth / viewWidth;
  let distance = Math.max(base, 1);
  if (perUnit * distance > minDistance) {
    while (distance > 1) {
      const divisor = gridDivisor(distance);
      const result = Math.trunc(distance / divisor);
      if (perUnit * result < minDistance) break;
      distance = result;
    }
  } else {
    while (perUnit * distance < minDistance && distance < 1 << 30) distance *= 2;
  }
  return distance;
}

/** `view2d_draw_lines`' minor half — `view2d_draw.cc:260-285`: one more
 *  `get_divisor` step below the major distance, drawn only while it stays at
 *  least `MIN_MAJOR_LINE_DISTANCE / 5` pixels apart, and (for a frame ruler,
 *  where `show_fractions` is false through `ED_time_scrub_draw`'s
 *  `discrete_frames = true`) only while the major distance is above 1
 *  (`view2d_draw_lines_x`, `:545`). */
export function minorStep(major: number): number | null {
  if (major <= 1) return null;
  return major / gridDivisor(Math.round(major));
}

/**
 * THE THEME, as the RUNNING factory theme answers it (read back through
 * `bpy.context.preferences.themes[0]`), with each key's source line beside it.
 * Where the source's default literal and the running theme disagree the
 * running theme is what draws, and the disagreement is named.
 */
export const TIMELINE_THEME = {
  /** `.space_action.back` — `userdef_default_theme.c:490` declares
   *  `0x30303000`; the RUNNING theme is `#303030ff` (see the module header).
   *  The region's clear, `frame_buffer_clear(TH_BACK)`. */
  back: '#303030',
  /** `.space_action.header` `0x303030b3` (`:494`) over the window. Reads
   *  `#2f2f2f` in the frame, which at alpha 0xb3 over `#2d2d2d`-ish window
   *  chrome is what this value resolves to; drawn flat here. */
  header: '#303030',
  /** `.space_action.grid` — `:498`. The MAJOR frame lines. */
  grid: '#161616',
  /** `get_color_shade_3ubv(TH_GRID, 16)` — `view2d_draw.cc:266`. The MINOR
   *  lines, exactly 16 levels lighter. CONFIRMED `#252525` in the frame
   *  against the major's `#151515`. */
  gridMinor: '#262626',
  /** `.regions.scrubbing.back` — `userdef_default_theme.c:300`. */
  scrubBack: '#1d1d1d',
  /** `.regions.scrubbing.text` — `:301`, the ruler's numbers
   *  (`TH_TIME_SCRUB_TEXT`, passed by `ED_time_scrub_draw`). */
  scrubText: '#808080',
  /** `.common.anim.playhead` (`TH_CFRAME`) — `:312`. The stalk, the pill and
   *  its tip. CONFIRMED `#4671b2` in the frame. */
  playhead: '#4772b3',
  /** `TH_HEADER_TEXT_HI` — the pill's number (`draw_playhead_box`,
   *  `time_scrub_ui.cc:182`); `.space_action.header_text_hi` `:496`. */
  playheadText: '#ffffff',
  /** `.common.anim.preview_range` — `:313`, the preview-range curtains
   *  (`ANIM_draw_previewrange`, `anim_draw.cc:85-115`, shaded −25 / alpha
   *  −30). Drawn only when `use_preview_range`. */
  previewRange: '#a14d00',
  /** `.common.anim.long_key` / `long_key_selected` — `:332-333`, the HELD-key
   *  bar between two columns whose value does not change. */
  longKey: '#ffffff',
  longKeyAlpha: 0x1f / 255,
  longKeySelected: '#ff8c00',
  longKeySelectedAlpha: 0x99 / 255,
  /** `.space_action.keyborder` / `keyborder_select` — `:502-503`, BOTH black
   *  (confirmed off the running theme: `#000000ff` each). */
  keyBorder: '#000000',
} as const;

/**
 * THE SIX KEYFRAME TYPES, unselected / selected — `.common.anim`
 * (`userdef_default_theme.c:320-331`), keyed by `Keyframe.type`'s own
 * identifier so the door's answer indexes it directly.
 */
export const KEY_COLORS: Record<string, { readonly fill: string; readonly selected: string }> = {
  KEYFRAME: { fill: '#bfbfbf', selected: '#ffbe33' },
  EXTREME: { fill: '#e8b3cc', selected: '#f28080' },
  BREAKDOWN: { fill: '#b3dbe8', selected: '#54bfed' },
  JITTER: { fill: '#94e575', selected: '#61c042' },
  MOVING_HOLD: { fill: '#808080', selected: '#ffaf23' },
  GENERATED: { fill: '#585858', selected: '#a28962' },
};

/** Per-type SIZE multipliers — `keyframes_draw.cc:62-85`. */
export const KEY_SIZE_FACTOR: Record<string, number> = {
  KEYFRAME: 1,
  EXTREME: 1.2,
  MOVING_HOLD: 0.925,
  BREAKDOWN: 0.85,
  JITTER: 0.8,
  GENERATED: 0.75,
};

/**
 * THE DIAMOND, and this is the one number a lane must not re-derive by eye.
 *
 * `icon_size = widget_unit * 0.5 * yscale_fac` = 10 (`keyframes_draw.cc:218`),
 * and the SHAPE is the shader's arithmetic
 * (`gpu_shader_keyframe_shape_vert.glsl:46-66`, `outline_scale` 1 at its one
 * caller `keyframes_draw.cc:660`):
 *
 *     half_width = 0.06 + (size − 10) × 0.04        → 0.06
 *     line_width = half_width + line_falloff(1.0)   → 1.06
 *     thresholds = (max(0, line_width − 1), line_width) → (0.06, 1.06)
 *     ext_radius = round(0.5 × size) + thresholds.x → 5.06
 *     pointSize  = ceil(ext_radius + thresholds.y) × 2 + 1 → 15
 *
 * and the fragment's diamond test is an L1 ball: `radius = (|x| + |y|) ×
 * √0.5` against `radii[0] = ext_radius × √0.5`, with
 * `alpha = 1 − smoothstep(thresholds.x, thresholds.y, |outline_dist|)`. So the
 * OUTLINE is a band around L1 = 5.06 whose PERPENDICULAR half-extent is
 * `line_width` = 1.06 px, and the fill shows inside L1 ≈ 3.56.
 *
 * CONFIRMED PIXEL FOR PIXEL in Blender's frame: the sprite is 15 rows tall
 * (image rows 51…65 for a key centred at 58), the filled core is 7 rows
 * (55…61 — L1 ≤ 3.5), and the black band reaches L1 ≈ 6.5.
 *
 * WE DRAW IT as an SVG polygon of half-diagonal `DIAMOND_RADIUS` with a
 * `DIAMOND_STROKE`-wide stroke straddling it, which reproduces both extents
 * exactly — 3.56 for the fill's edge and 6.56 for the outline's. The stated
 * difference: Blender's band is a 0.06 → 1.06 smoothstep in each direction and
 * SVG has no such ramp, so the browser antialiases its own hard edges instead.
 * The INK-weighted equivalent would be 1.12 px (the integral of
 * `1 − smoothstep(0,1,u)` is exactly ½, so each side deposits 0.06 + 0.5), and
 * it would put the fill 0.7 px further out than Blender's — the extents are
 * what a parity read measures, so the extent is what is matched.
 */
export const KEY_ICON_SIZE = 10;
export const DIAMOND_RADIUS = 5.06;
export const DIAMOND_STROKE = 2.12;
/** `gl_PointSize` — the sprite Blender rasterises the shape into. Reported in
 *  the view's `state` so a parity reading can check it. */
export const DIAMOND_SPRITE = 15;

/**
 * THE PLAYHEAD — `get_playhead_dimensions` (`time_scrub_ui.cc:96-116`) and
 * `draw_playhead_box` / `draw_playhead_tip` (`:161-206`).
 *
 * CONFIRMED: a 24-px pill (22 px of flat `#4671b2` plus a pixel of
 * antialiasing each side) starting 2 px below the scrub strip's top, and a
 * 3-px stalk (`draw_playhead_stalk`'s `rect` at `UI_SCALE_FAC ≥ 0.91`:
 * `floor(x − 1) − 1` to `floor(x + 2) + 1`, of which the shadow is the outer
 * pixel on each side).
 */
export const PLAYHEAD = {
  /** `box_min_width = 24 * UI_SCALE_FAC` (`:109`); a wider number grows it to
   *  `text_width + 2 * text_padding`. */
  minPillWidth: 24,
  /** `text_padding = 4 * UI_SCALE_FAC` (`:107`). */
  textPadding: 4,
  /** `box_margin = 2 * UI_SCALE_FAC` (`:110`). */
  margin: 2,
  /** `box_corner_radius = 4 * UI_SCALE_FAC` (`draw_playhead_box:165`). */
  radius: 4,
  /** `tri_half_width` / `tri_height` = `6 * UI_SCALE_FAC` (`:113-114`). */
  tipHalfWidth: 6,
  tipHeight: 6,
  /** The stalk's drawn core, measured: 3 px. */
  stalkWidth: 3,
} as const;

/**
 * `ANIM_draw_framerange` — `anim_draw.cc:172-190`: the area OUTSIDE
 * `scene.frame_start … frame_end` takes `TH_BACK` shaded −25 with alpha −100.
 * With the running theme's `#303030ff` that resolves to
 * `48 + (23 − 48) × 155/255 = 32.8`, and the frame reads `#202020` (32).
 * Drawn here as one flat colour rather than a blend, because the blend has one
 * possible answer over the region's own clear.
 */
export const OUT_OF_RANGE = '#212121';

/** `.space_action.text` — `userdef_default_theme.c:492`, the status line's. */
export const TIMELINE_CHROME = {
  text: '#a6a6a6',
  textHi: '#ffffff',
  /** `ui.editor_border` — `#161616`, read back off the running theme. */
  rule: '#161616',
  /** `wcol_tool.inner` / `.text` / `.outline`, read back off the running
   *  theme: `#545454` / `#e6e6e6` / `#3d3d3d`, roundness 0.4. A 20-px widget
   *  therefore has a 4-px corner radius. */
  widget: '#545454',
  widgetText: '#e6e6e6',
  widgetOutline: '#3d3d3d',
  widgetRadius: 4,
  /** `UI_UNIT_X` / `UI_UNIT_Y` — one `widget_unit`. Confirmed: the six
   *  transport buttons span exactly 120 px. */
  unit: WIDGET_UNIT,
  refusal: '#ffaf23',
  /** The header's own padding and the gap between its widget groups —
   *  `space_time.py` builds it as a `layout.row(align=True)` per group with
   *  `separator_spacer()` between, and Blender's own header measures 8 px of
   *  lead-in. Held here rather than inline for the reason the UV view's
   *  `statusPadding` is: a drawing's numbers belong with its other numbers. */
  headerPadding: '0 8px',
  headerGap: 8,
  /** The refusal line under the ruler. */
  statusPadding: '2px 8px',
} as const;
