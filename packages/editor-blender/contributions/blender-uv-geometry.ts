/**
 * THE UV EDITOR'S GEOMETRY AND COLOUR, every constant read from Blender's own
 * source at the engine's pin (5.2.0, `fbe6228777e7`) — WORK.md §Blender in the
 * tab is Blender, "Inspection parity", I5; ARCHITECTURE-CORE §Blender north
 * star ("the reference is Blender's SOURCE as well as its frames").
 *
 * The drawing this describes is `MeshUVs` — the overlay class that REPLACED
 * the 5.2-era `overlay_edit_uv.cc`, which is why that filename does not exist
 * in the checkout — at `draw/engines/overlay/overlay_mesh.hh:483-760`, plus
 * the four shaders it binds
 * (`shaders/overlay_edit_uv_{edges_frag,verts_vert,verts_frag,faces_vert,face_dots_vert}.glsl`),
 * `space_image.cc`'s `image_create` for the space's own defaults and
 * `userdef_default_theme.c`'s `.space_image` for the colours.
 *
 * ## What is NOT mode-gated, and why every flag below reads "unselected"
 *
 * Blender draws UVs only when `show_uv_edit_ = space_mode_is_uv &&
 * object_mode_is_edit` (`overlay_mesh.hh:593`). Both halves belong to its UI
 * layer, which this editor never runs (orchestrator ruling 1, 2026-09-19:
 * "inspection is not mode-gated"). So the view reads the DATA in whatever mode
 * the engine is in and names the mode in its status line.
 *
 * The same ruling's second half decides the selection colours: "the view reads
 * the flags the data carries and draws everything unselected when the flags
 * are absent". MEASURED at this pin: `MeshUVLoopLayer`
 * (`makesrna/intern/rna_mesh.cc:2380-2456`) declares `uv`, `pin`, `name`,
 * `active`, `active_render` and `active_clone` — and NO vertex or edge
 * selection at all, because UV selection lives in the BMesh an edit-mode
 * session holds. `pin` IS declared, so pins are drawn; everything else takes
 * its unselected branch, and the SELECTED constants below are recorded beside
 * them rather than dropped, because a colour that is never reached is still
 * the specification of the one that is.
 */

// ------------------------------------------------------------------- colours

/**
 * `.space_image` (`release/datafiles/userdef/userdef_default_theme.c:578-608`),
 * whole. Alpha is carried where Blender carries it: `face` is `0x0a` and
 * `face_select` `0x3c` out of 255, which is what makes a UV island read as a
 * wash rather than a fill.
 */
export const UV_THEME = {
  /** `.back` `RGBA(0x30303000)` (`:580`) — alpha ZERO, so the space paints no
   *  backdrop of its own and the region's own surface shows. The node editor's
   *  `.back` is the same shape (`:661`), and U8's ruling 2 is what gives this
   *  view a surface colour of its own instead. */
  back: '#303030',
  backAlpha: 0,
  /** `.grid` `RGBA(0x303030ff)` (`:586`) — FULL alpha, unlike the node
   *  editor's. See `UV_GRID_OPEN` below for what that measures to. */
  grid: '#303030',
  /** `.wire_edit` (`:587`) — the unselected edge under the OUTLINE line style,
   *  halved by the shader when `use_edge_select` is on
   *  (`overlay_edit_uv_edges_frag.glsl:27`). */
  wireEdit: '#c0c0c0',
  /** `.vertex_select` (`:588`) — `theme.colors.vert_select`, the fill of a
   *  selected UV vertex (`overlay_edit_uv_verts_vert.glsl:20`). */
  vertexSelect: '#ff8500',
  /** `.edge_select` (`:589`) — mixed into every line style by
   *  `selection_fac` (`overlay_edit_uv_edges_frag.glsl:31,41,46,50`). */
  edgeSelect: '#ff8500',
  /** `.face` `RGBA(0xffffff0a)` (`:590`) — the unselected island wash. */
  face: '#ffffff',
  faceAlpha: 0x0a / 255,
  /** `.face_select` `RGBA(0xff85003c)` (`:591`). */
  faceSelect: '#ff8500',
  faceSelectAlpha: 0x3c / 255,
  /** `.editmesh_active` `RGBA(0xffffff40)` (`:596`) — the ACTIVE face, which
   *  `overlay_edit_uv_faces_vert.glsl:25` puts over the selected colour. */
  editmeshActive: '#ffffff',
  editmeshActiveAlpha: 0x40 / 255,
  /** `.uv_shadow` (`:606`) — the SHADOW line style, which is what the
   *  wireframe pass draws outside UV edit mode
   *  (`edit_uv_line_style_from_space_image`, `overlay_mesh.hh:1091-1111`).
   *  **That is this view's line style**, because this view is never in UV edit
   *  mode: `sima->mode == SI_MODE_UV` is a space flag, and there is no space. */
  uvShadow: '#707070',
  /** `.preview_back` (`:601`). Recorded whole because the theme block is, and
   *  named as NOT USED here: it is `TH_PREVIEW_BACK`, the backdrop behind a
   *  node/texture preview, not the UV tile's. */
  previewBack: '#727272',
  /** `TH_VERTEX` and `TH_FACEDOT` and `TH_WIRE` are NOT DECLARED in
   *  `.space_image` — checked key by key against `:578-608`. `resources.cc`
   *  resolves each straight off the active space's `ThemeSpace`
   *  (`:407-408`, `:361-362`, and the facedot case beside them), so the C
   *  struct's zero stands and all three are BLACK — the same reading I4
   *  recorded for `TH_VERTEX_UNREFERENCED`. Both shaders force alpha to 1 over
   *  that zero (`…verts_vert.glsl:19`: `float4(color.rgb, 1.0f)`;
   *  `…face_dots_vert.glsl:18`: `float4(theme.colors.wire.rgb, 1.0f)`), so an
   *  unselected UV vertex and an unselected face dot are opaque black. */
  vertex: '#000000',
  faceDot: '#000000',
  wire: '#000000',
} as const;

/** `.space_image`'s SIZES, the same block (`:592-595`). */
export const UV_SIZES = {
  /** `.vertex_size = 3` (`:592`). */
  vertexSize: 3,
  /** `.edge_width = 1` (`:593`). */
  edgeWidth: 1,
  /** `.outline_width = 1` (`:594`). */
  outlineWidth: 1,
  /** `.facedot_size = 3` (`:595`). */
  facedotSize: 3,
} as const;

// ------------------------------------------------------------------ geometry

/**
 * `UI_SCALE_FAC` is 1 here, for the reason I5's node work already measured:
 * `U.widget_unit` is `int(roundf(18 * scale_factor)) + 2 * pixelsize` = 20 at
 * scale 1 (`windowmanager/intern/wm_window.cc:779`), which is the value every
 * node constant divides by — so the session's scale factor is 1 and every
 * `* UI_SCALE_FAC` below is the identity.
 */
export const UI_SCALE_FAC = 1;

/**
 * A UV VERTEX DOT'S DIAMETER IN PIXELS.
 * `(TH_VERTEX_SIZE * UI_SCALE_FAC + 1.5) * √2` (`overlay_mesh.hh:709-712`) —
 * 3 → **6.364**. The `√2` is there because the point sprite is a SQUARE whose
 * inscribed circle must still hold the dot after the outline, and the 1.5 is
 * the outline's own room.
 */
export const UV_VERT_DOT_SIZE = (UV_SIZES.vertexSize * UI_SCALE_FAC + 1.5) * Math.SQRT2;

/**
 * The outline ring inside that dot: `outline_width` 0.75 pushed as a shader
 * constant (`overlay_mesh.hh:713`) — NOT the theme's `.outline_width` 1, which
 * is a different number for a different mark, and the two are recorded
 * together here because reading one for the other is the obvious mistake.
 * `…verts_vert.glsl:33-39` turns it into four concentric radii; at
 * `radius = dot_size/2` the pure fill ends at `radius - 0.75 - 1`.
 */
export const UV_VERT_OUTLINE_WIDTH = 0.75;

/** A FACE DOT'S DIAMETER: `TH_FACEDOT_SIZE * UI_SCALE_FAC`
 *  (`overlay_mesh.hh:727-729`) — 3, with no `√2` and no outline. */
export const UV_FACEDOT_SIZE = UV_SIZES.facedotSize * UI_SCALE_FAC;

/** A DASHED EDGE'S PERIOD: `4.0f * UI_SCALE_FAC` (`overlay_mesh.hh:670`) — 4
 *  pixels, of which the shader inks the first HALF
 *  (`…edges_frag.glsl:38`: `fract(line_distance / dash_length) < 0.5`). */
export const UV_DASH_LENGTH = 4 * UI_SCALE_FAC;

/**
 * THE THREE OPACITIES, and all three default to 1.0 —
 * `image_create` (`editors/space_image/space_image.cc:116-118`) sets
 * `uv_opacity`, `uv_face_opacity` and `uv_edge_opacity` to `1.0f` each.
 *
 * WHICH ONE APPLIES IS THE MODE QUESTION AGAIN: the face pass takes
 * `uv_opacity` when `object_mode_is_edit && space_mode_is_uv` and
 * `uv_face_opacity` otherwise (`overlay_mesh.hh:741-743`), and the wireframe
 * pass always takes `uv_edge_opacity` (`:672`). Since all three are 1.0 the
 * branch cannot change a pixel here, which is why the view takes the
 * NOT-in-edit-mode branch (the honest one) and the number is the same.
 *
 * The one thing the branch DOES change is the final multiply: an object that
 * is not the active edit-mode object has its alpha quartered
 * (`…edges_frag.glsl:71`, `…faces_vert.glsl:26`: `alpha * 0.25`). The view
 * draws ONE object — the active one — so it takes the full-alpha branch, and
 * says so.
 */
export const UV_OPACITY = 1;
export const UV_FACE_OPACITY = 1;
export const UV_EDGE_OPACITY = 1;

/**
 * THE TILE GRID. `image_create` (`space_image.cc:129-133`) sets
 * `tile_grid_shape` to `1, 1` and `custom_grid_subdiv` to `10, 10`, so the
 * stock drawing is the 0–1 tile with a ten-by-ten subdivision. The step is
 * `1 / custom_grid_subdiv[i]` under `SI_GRID_SHAPE_FIXED`
 * (`image_draw.cc:575-576`).
 */
export const UV_TILE_GRID: readonly [number, number] = [1, 1];
export const UV_GRID_SUBDIV: readonly [number, number] = [10, 10];

/**
 * THE GRID'S VISIBILITY IS THE ONE THING THE SOURCE HERE CANNOT SETTLE, and it
 * is named rather than guessed at.
 *
 * `.space_image.grid` is `#303030` at FULL alpha (`:586`) — unlike the node
 * editor's, whose alpha is zero, which is why that view draws no grid at all.
 * But the image region is cleared by `DRW_draw_view`
 * (`space_image.cc:758`), the overlay ENGINE's own clear, and
 * `draw/engines/overlay`'s grid pass is not in this checkout's sparse set. So
 * the source states the grid's colour and not the value it sits on, and
 * `#303030` on this view's own `#303030` surface is INVISIBLE — measured, not
 * assumed. The view draws the grid at the theme's colour anyway, because
 * drawing a different one would be inventing a mark; the contrast is the
 * first thing the owed sighted frame-beside-frame read settles.
 */
export const UV_GRID_OPEN =
  "Blender's `.space_image.grid` is #303030 at full alpha " +
  "(userdef_default_theme.c:586) and this view's surface is #303030, so the tile " +
  "grid draws at the theme's colour and is invisible against it. The image " +
  "region's own clear is the overlay engine's (DRW_draw_view, space_image.cc:758), " +
  'which is not in the source checkout — the sighted read settles the contrast.';

/**
 * THE LINE STYLE THIS VIEW DRAWS, and why it is not the default one.
 *
 * `edit_uv_line_style_from_space_image` (`overlay_mesh.hh:1091-1111`) returns
 * one of five: with `sima->mode == SI_MODE_UV` it maps `dt_uv` — whose enum is
 * `OUTLINE, DASH, BLACK, WHITE` in that order (`rna_space.cc:4010-4016`) and
 * whose `image_create` leaves it at 0, so Blender's stock UV editor draws
 * **OUTLINE** — and OTHERWISE it returns `SHADOW`.
 *
 * There is no `SpaceImage` here and therefore no `mode`, so the honest branch
 * is the else: **SHADOW**, `theme.colors.uv_shadow` `#707070`
 * (`…edges_frag.glsl:48-50`). The OUTLINE constants are carried beside it
 * because that is what the frame-beside-frame read will be against once a
 * mode-carrying surface exists.
 */
export const UV_LINE_STYLES = {
  outline: {
    /** `mix(wire_edit, edge_select, selection_fac)` with `use_edge_select`
     *  off (`…edges_frag.glsl:34`), over a black outer line (`:36`). */
    inner: UV_THEME.wireEdit,
    outer: '#000000',
  },
  dash: { inner: '#595959', outer: null, period: UV_DASH_LENGTH },
  black: { inner: '#000000', outer: null },
  white: { inner: '#ffffff', outer: null },
  shadow: { inner: UV_THEME.uvShadow, outer: null },
} as const;

/** `0.35` in the DASH style's `float4(float3(0.35f), 1.0f)`
 *  (`…edges_frag.glsl:39`) is a LINEAR value, and every other colour in that
 *  shader comes from the theme as sRGB — so the dash's grey is `0.35`
 *  linear = **#595959** sRGB, which is what `UV_LINE_STYLES.dash.inner`
 *  carries. (`0.35^(1/2.4)` with the sRGB knee: 0.3487 → 0.6236 → 159.) */
export const UV_DASH_LINEAR_GREY = 0.35;

/**
 * THE EDGE'S DRAWN WIDTH. `…edges_frag.glsl:53-54` inks out to
 * `max(theme.sizes.edge - 0.5, 0)` and fades over the next
 * `max(theme.sizes.edge, 1)` — with `.edge_width` 1 that is a 0.5-px core in a
 * 1-px falloff either side of the line's centre, so the mark reads as a
 * **1 px** line with a soft edge. The view draws 1 px.
 */
export const UV_EDGE_DRAWN_WIDTH = Math.max(UV_SIZES.edgeWidth, 1);

/** A PIN is not a theme colour: `…verts_vert.glsl:15` declares
 *  `constexpr float4 pinned_col = float4(1.0f, 0.0f, 0.0f, 1.0f)` with a
 *  `/* TODO: Theme? *\/` beside it, so a pinned UV vertex is a hard **red**,
 *  fill AND outline (`:20-21`). */
export const UV_PIN_COLOR = '#ff0000';

// -------------------------------------------------------------- the decoding

/** One base64 payload as bytes. The doors ship typed-array bytes because a UV
 *  layout is `loops` corners and JSON numbers would be four times the wire for
 *  the same values — the shape I4's weights already established. */
export function uvBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function uvFloat32(base64: string): Float32Array {
  const bytes = uvBytes(base64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

export function uvUint32(base64: string): Uint32Array {
  const bytes = uvBytes(base64);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

/** An `#rrggbb` plus an alpha as an `rgba()` — SVG's `fill-opacity` would do
 *  for a fill, but an alpha that belongs to the COLOUR (Blender's `face` is
 *  `0xffffff0a`, one value) is clearer carried with it. */
export function uvRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 1000) / 1000})`;
}

/** THE VIEW'S OWN CHROME, as named constants rather than inline literals —
 *  `.space_image.text` `#e6e6e6` (`userdef_default_theme.c:582`) for the
 *  status line, and Blender's selection orange `#ed5700` (the palette's
 *  `viewport.selection`, itself derived from `.space_view3d.select`) for a
 *  refusal, which is the same hue I2's rail already wears for "this is the
 *  one you are looking at". They live here because a `@volter/editor-blender` view may
 *  not import the editor's theme (the package's host-import pin is ZERO) and
 *  because the style-token ratchet counts LITERALS in a `.tsx`, which is
 *  exactly the right pressure: a colour with a citation is a constant. */
export const UV_CHROME = {
  text: '#e6e6e6',
  refusal: '#ed5700',
  /** `.space_image`'s own separator value: the palette's `region.outliner`
   *  neighbour, one level under the surface, which is what every other panel
   *  edge in this look already draws. */
  rule: '#232323',
  /** The status line's own box. Blender's editor footers are one text row in
   *  a `widget_unit`-tall strip; at `U.widget_unit` 20 (`wm_window.cc:779`)
   *  and 11-px text that is 3 px of padding either side of the row, and the
   *  12-px gap is the same `NODE_MARGIN_X/3` rhythm the node view's labels
   *  already use. Named here for the reason the colours are. */
  statusPadding: '3px 8px',
  statusGap: 12,
} as const;
