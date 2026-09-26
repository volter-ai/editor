/**
 * THE LOOK POINTS — a workspace layout, a keymap and a style bundle as DATA a
 * package contributes (WORKBENCH.md §Contribution points: "Layouts, keymaps
 * and styles are DATA points: they need no code to load, which is what makes
 * a 'styled build' a manifest choice rather than a code change").
 *
 * A contribution module declares its point and exports ONE object:
 *
 *   `model.layout.ts`    export const point = 'workspace.layout';  export const layout: WorkspaceLayoutContribution
 *   `blender.keymap.ts`  export const point = 'workspace.keymap';  export const keymap: KeymapContribution
 *   `blender.style.ts`   export const point = 'workspace.style';   export const style: StyleContribution
 *
 * The editor registers what a project's declared packages contribute beside
 * its own built-ins — Look, Animate and Design as workspaces, the vgai keymap,
 * the Classic/Glass/Maya/Substance bundles — and never asks which package is
 * open: a build without the Blender look has no Model workspace.
 */
import type { WorkspaceArrangement } from './workspace-arrangement';

/**
 * Every keyboard action the editor's chrome binds. A keymap binds these and
 * nothing else; a game never reads this table (play-mode input isolation is a
 * different mechanism).
 */
export type EditorKeyActionId =
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copy'
  | 'edit.cut'
  | 'edit.paste'
  | 'edit.duplicate'
  | 'edit.group'
  | 'edit.wrap'
  | 'edit.unwrap'
  | 'edit.selectAll'
  | 'edit.deselectAll'
  | 'edit.save'
  | 'edit.delete'
  | 'edit.enterScope'
  | 'edit.exitScopeOrDeselect'
  | 'edit.nudgeUp'
  | 'edit.nudgeUpCoarse'
  | 'edit.nudgeDown'
  | 'edit.nudgeDownCoarse'
  | 'edit.nudgeLeft'
  | 'edit.nudgeLeftCoarse'
  | 'edit.nudgeRight'
  | 'edit.nudgeRightCoarse'
  | 'view.resetPan'
  | 'view.commandPalette'
  | 'view.toggleConsole'
  | 'view.focusMode'
  | 'workspace.cycleNext'
  | 'workspace.cyclePrevious'
  /** Arm the tool that draws NO transform gizmo — Blender's Select Box, whose
   *  3D View keymap puts it on `W` (`blender_default.py:1950-1955`,
   *  `op_tool_cycle("builtin.select_box", …)`). This editor's own keymap binds
   *  it to nothing: W/E/R/T are its four transform tools. */
  | 'transform.select'
  | 'transform.combined'
  | 'transform.translate'
  | 'transform.rotate'
  | 'transform.scale'
  | 'viewport.toggleSnap'
  | 'viewport.frameSelection'
  | 'viewport.cyclePivot'
  | 'viewport.vertexSnapHold'
  | 'viewport.snapToFloor'
  | 'view.top'
  | 'view.front'
  | 'view.right'
  | 'view.bottom'
  | 'view.back'
  | 'view.left'
  /** Step the view: orbit 15° about the world's up or the view's horizon, turn to the opposite
   *  side, or roll 15° (Blender's `view3d.view_orbit` and `view3d.view_roll` on the numpad). */
  | 'view.orbitLeft'
  | 'view.orbitRight'
  | 'view.orbitUp'
  | 'view.orbitDown'
  | 'view.opposite'
  | 'view.rollLeft'
  | 'view.rollRight'
  /** Frame everything in the view, selected or not (Blender's `view3d.view_all`, Home). */
  | 'view.all'
  /** Step the view nearer or farther by the keymap's zoom step (`view3d.zoom`, numpad +/-). */
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.perspective'
  /** Switch the view between perspective and orthographic, keeping where it looks from
   *  (Blender's `view3d.view_persportho`, numpad 5). */
  | 'view.projection'
  | 'view.camera';

/**
 * One chord. `key` is matched case-insensitively against `KeyboardEvent.key`;
 * `code` (when set) is matched against `KeyboardEvent.code` instead, for
 * chords whose typed character varies by layout or modifier (Option+letter on
 * macOS types a symbol). `mod` is ⌘ on macOS and Ctrl elsewhere.
 */
export interface KeyChord {
  readonly key: string;
  readonly code?: string;
  readonly mod?: boolean;
  /** The Control key itself on every platform, macOS included (Blender's Ctrl), where `mod`
   *  would be ⌘. */
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

/** The chords a keymap binds for the actions it names. An action a keymap
 *  omits keeps the editor's own binding; an EMPTY list unbinds it. */
export type KeymapBindings = Partial<Record<EditorKeyActionId, readonly KeyChord[]>>;

export interface KeymapContribution {
  /** The `keymap` settings value that selects it. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly bindings: KeymapBindings;
  /** Which mouse button orbits the viewport. Absent: the editor's own. */
  readonly navigation?: KeymapNavigation;
}

/**
 * THE VIEWPORT'S MOUSE, as a keymap states it: the button that orbits. The editor's own orbits
 * with the right button and pans with the middle; a keymap that orbits with the middle (Blender's
 * `view3d.rotate` on MIDDLEMOUSE) pans with Shift and the same button, as that keymap does.
 */
export interface KeymapNavigation {
  readonly orbit: 'middle' | 'right';
  /**
   * The orbit as a TURNTABLE that keeps the view's roll and may pass over the top (Blender's
   * `view3d.rotate` in Turntable mode): a sideways drag spins the view about the world's up, a
   * vertical one pitches it about the horizon, each at this angle per CSS pixel. Absent: the
   * editor's own orbit, which holds the view level and stops at the poles.
   */
  readonly turntable?: { readonly degreesPerPixel: number };
  /**
   * An orthographic view still down an axis turns perspective when a rotate starts, as Blender's
   * Auto Perspective does (`ED_view3d_persp_ensure`); the axis views themselves are orthographic.
   */
  readonly autoPerspective?: boolean;
  /**
   * ZOOM: `step` is the distance factor one zoom key moves by (Blender's `view_zoom_apply_step`,
   * 1.2); `drag: 'dolly'` makes a zoom drag Blender's Dolly style (`viewzoom_scale_value`: the
   * distance scales by `2 · (len / len₀ − 1) + 1`, `len` the pointer's height below the region's
   * top plus 5). Absent: the editor's own.
   */
  readonly zoom?: { readonly step: number; readonly drag?: 'dolly' };
}

export type WorkspaceLayoutRegions = NonNullable<WorkspaceArrangement['regions']>;

export interface WorkspaceLayoutContribution {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** What the workspace needs the project to DECLARE before it applies:
   *  `'mounts'` (at least one root that plays) or a document kind the
   *  project's table lists. Omitted: every project. */
  readonly requires?: 'mounts' | { readonly documentKind: string };
  /** Which chrome regions the workspace shows; absent means every region. */
  readonly regions?: WorkspaceLayoutRegions;
  /** The workspace's EDITOR AREAS beside the centre document — a second
   *  editor group holding a `workspace.document` contribution, the shape
   *  Blender's own screens have (`WorkspaceAreaContribution`). Absent: the
   *  centre document alone. */
  readonly areas?: WorkspaceArrangement['areas'];
}

/**
 * An OPAQUE material a style bundle carries: Classic's physics (opaque
 * surfaces, conventional bars and panels) under its own corner radii and
 * shadows. Chroma stays the palette's; Glass is the editor's own and is not
 * contributable.
 */
export interface MaterialContribution {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Corner radii, smallest to largest, and the pill. */
  readonly shape: {
    readonly small: string;
    readonly medium: string;
    readonly large: string;
    readonly full: string;
  };
  /** `box-shadow` values (`none` allowed) for raised widgets, menus, dialogs. */
  readonly elevation: {
    readonly small: string;
    readonly medium: string;
    readonly large: string;
  };
  /** How tight the chrome sits: control heights, the type scale and the
   *  chrome rows, in px. Every field is optional; absent ones keep the
   *  editor's own. */
  readonly density?: DensityContribution;
  /** What the look states about the 3D stage ({@link StageContribution}). */
  readonly stage?: StageContribution;
}

export interface DensityContribution {
  readonly control?: {
    readonly compact?: number;
    readonly default?: number;
    readonly comfortable?: number;
  };
  readonly font?: {
    readonly xs?: number;
    readonly sm?: number;
    readonly base?: number;
    readonly md?: number;
    readonly lg?: number;
    readonly xl?: number;
    readonly '2xl'?: number;
    readonly heading?: number;
  };
  /** Glyph sizes, independent of the type scale: Blender's chrome glyphs are
   *  14 px whatever the text around them measures. */
  readonly icon?: {
    readonly xs?: number;
    readonly sm?: number;
    readonly md?: number;
    readonly lg?: number;
    readonly xl?: number;
    readonly '2xl'?: number;
  };
  readonly chrome?: {
    readonly commandBar?: number;
    readonly panelHeader?: number;
    readonly localToolbar?: number;
    readonly treeRow?: number;
    /** How far one level of a tree steps right. Absent keeps the editor's own
     *  14; Blender's Outliner steps by its ROW HEIGHT — a square grid, 20 —
     *  with the chevron owning one cell and the type glyph the next. */
    readonly treeIndent?: number;
    readonly statusBar?: number;
    /** The tool rail: a tool's box, its width, the gap between groups. */
    readonly toolSize?: number;
    readonly toolWidth?: number;
    readonly toolGap?: number;
    /** How wide the seam between two docked AREAS is cut, in px. Absent
     *  keeps the editor's own hairline; Blender's groove measures 3.5. The
     *  colour is the palette's `color.boundary.area`. */
    readonly areaSeam?: number;
    /** THE EMBOSS beside that groove, as a percentage of WHITE mixed into the
     *  area's OWN fill — so it is one number and every area computes its own
     *  colour from it. Absent (or 0) paints nothing, which is what every skin
     *  but Blender does; Blender's measures 8.2. See `theme.ts`'s
     *  `areaEmbossValue` for the five fills it was solved against. */
    readonly areaEmboss?: number;
  };
}

/**
 * WHAT A LOOK STATES ABOUT THE 3D STAGE, as opposed to about the chrome around it: how the
 * stage's furniture is drawn (sizes, widths, the selection box's form). Absent members keep
 * the editor's own. What the stage DOES — its boot tool, its box-select rule, its world's up
 * axis — is its presentation's (`@volter/editor-sdk/kit/viewport-presentation`), never the
 * look's (ARCHITECTURE.md rule 7).
 */
export interface StageContribution {
  /**
   * THE TRANSFORM GIZMO'S SCREEN SIZE, in px per gizmo unit — Blender's
   * `U.gizmo_size` (`DNA_userdef_types.h:1095`, default 75; Preferences ▸
   * Viewport ▸ Gizmos ▸ Size, `rna_userdef.cc:5415-5419`).
   *
   * A gizmo is a CONSTANT SCREEN SIZE, never a fraction of the object or of
   * the viewport: `wm_gizmo.cc:450-474` computes
   * `scale_final = scale_basis · UI_SCALE_FAC · U.gizmo_size ·
   * ED_view3d_pixel_size_no_ui_scale(rv3d, origin)`, and that last term is
   * world units per device pixel while `UI_SCALE_FAC` is device pixels per
   * UI pixel — so one gizmo unit is exactly `U.gizmo_size` CSS px at any
   * display scale.
   *
   * Absent keeps the editor's own gizmo, which is a fraction of the
   * VIEWPORT (three's `TransformControls` at `size` 1). What the number
   * means on our side — three's handles are authored on a unit half
   * Blender's — is `editor-viewport.ts`'s to know, and it says so there.
   */
  readonly gizmoSize?: number;
  /**
   * THE GIZMO'S HANDLES AT REST AND HIGHLIGHTED. `gizmoOpacity` is a resting handle's opacity
   * (a highlighted one is opaque): Blender's 0.6 (`transform_gizmo_3d.cc`,
   * `gizmo_get_axis_color`), Godot's 0.9 (`editors/3d/manipulator_gizmo_opacity`), Unity's
   * 0.93 (`Handles.cs`, the axis colours' alpha). A handle with no fixed highlight colour
   * (`color.gizmo.hover`) highlights in its own axis colour with its saturation multiplied by
   * `gizmoHighlightSaturation` and its value set to `gizmoHighlightValue`, each kept when
   * absent: Blender keeps both, Godot's are 0.25 and 1 (`node_3d_editor_plugin.cpp`,
   * `col.from_hsv(col.get_h(), col.get_s() * 0.25, 1.0, 1)`).
   */
  readonly gizmoOpacity?: number;
  /**
   * THE MOVE ARROWS' SHAPE: `gizmoArrowLength` is how far an arrow's tip stands from the
   * centre, in rotation-ring radii (three's own 1.2; Godot's 1.6, measured on
   * `tuto_3d5.png` as a 142 px tip against a 90 px ring), and `gizmoArrowHead` scales its
   * head (three's own 1; Godot's about 1.5). Which handles the tool offers is the view's
   * (`interaction.transformHandles`), never the look's.
   */
  readonly gizmoArrowLength?: number;
  readonly gizmoArrowHead?: number;
  /** THE ROTATION RINGS' THICKNESS, as a multiple of three's own (Godot's rings are about
   *  twice as thick, `tuto_3d5.png`). */
  readonly gizmoRingWidth?: number;
  /**
   * THE NAVIGATION GIZMO'S FORM AND CORNER: lettered `balls` (the editor's own, Blender's and
   * Godot's), `cones` round a centre cube (Unity's scene gizmo) or a lettered axis `triad`
   * (Unreal's); `top-right` (the editor's own) or `bottom-left` (Unreal's). Whether a click on
   * it turns the view is the view's (`overlays.navigation`).
   */
  readonly navigationGizmo?: 'balls' | 'godot' | 'cones' | 'triad';
  readonly navigationCorner?: 'top-right' | 'bottom-left';
  /** The triad's size, a multiple of its own 24 px; line and letter stay inside the gizmo's
   *  90 px box up to about 1.3 (Unreal's triad, letters included, is about 40 px). */
  readonly navigationSize?: number;
  readonly gizmoHighlightSaturation?: number;
  readonly gizmoHighlightValue?: number;
  /**
   * THE FLOOR GRID'S LINES, in device pixels: the minor lines' width, the major lines' width,
   * and how far the major lines' colour is carried past the minor's from the backdrop (1 draws
   * both levels alike). A look that states none keeps the editor's own floor, one hairline
   * level — the grid the kit drew before its floor was fitted to Blender. Blender's are 1.5,
   * 2.25 and 39/21, measured across one scanline of `modeling-object-none.png`: the 1 m line
   * 4 px at half rise plateauing at 83, the 10 m line 6 px plateauing at 101
   * (`docs/VIEWPORT-STAGE.md`: widths are the look's, like colours).
   */
  readonly gridLineWidth?: number;
  readonly gridMajorWidth?: number;
  readonly gridMajorContrast?: number;
  /** THE AXIS LINES' WIDTH in device pixels (the editor's own and Blender's are 2, measured
   *  on `modeling-object-none.png`). Which axis lines show is the view's
   *  (`overlays.axes`), never the look's. */
  readonly axisLineWidth?: number;
  /**
   * HOW THE SELECTION BOX MARK IS DRAWN (the view's `overlays.selection.box`): `corners`, the
   * editor's own brackets, or `edges`, the full box (Godot's selection box); and its stroke in
   * CSS px (the editor's own is 3; Godot's box is a hairline).
   */
  readonly selectionBox?: 'corners' | 'edges';
  /** Which axes the box is measured along: the world's (the editor's own) or the object's,
   *  so it turns with a rotated object (Godot's). */
  readonly selectionBoxFrame?: 'world' | 'object';
  /**
   * THE SELECTION OUTLINE'S FORM: `soft`, the editor's own blurred halo, or `crisp`, a hard
   * line `outlineWidth` device pixels wide (Blender's, Unity's and Unreal's are crisp); and
   * whether the parts of the selection other objects hide are drawn too (`outlineHidden`,
   * the editor's own; Unity's and Blender's are not).
   */
  readonly outlineStyle?: 'soft' | 'crisp';
  readonly outlineWidth?: number;
  readonly outlineHidden?: boolean;
  /** THE SELECTION WIRE'S OPACITY (the editor's own 0.5; Unity's blue wire is about 0.25,
   *  `SceneVisExVisible.png`). Its colour is the palette's `color.viewport.wire`. */
  readonly wireOpacity?: number;
  readonly selectionBoxWidth?: number;
  /** THE STAGE'S OWN CHROME: which overlay controls the viewport carries and where. See
   *  {@link StageChromeContribution}; absent keeps the editor's own set. */
  readonly chrome?: StageChromeContribution;
}

/**
 * THE VIEWPORT'S OWN CHROME, as each target's viewport arranges it (read from the reference
 * frames, `docs/VIEWPORT-STAGE.md`): a look places the stage's controls, it never adds one.
 * Each member is independently optional; absent keeps the editor's own arrangement (Blender's:
 * the view text top-left, the tool shelf, the display controls in the top-right corner, the
 * zoom and pan cluster, the camera readout).
 *
 * - `bar`: a row across the stage's top. `strip` is a flush panel band (Godot's 3D toolbar,
 *   Unity's Scene view toolbar); `pills` is a row of rounded pills floating over the view
 *   (Unreal's level viewport toolbar). Absent, there is no bar.
 * - `viewName`: where the view's name is. `text` is Blender's lines at the top-left; `menu`
 *   a pill at the top-left that opens the view menu (Godot's "⋮ Perspective"); `gizmo` a label
 *   under the navigation gizmo that toggles the projection (Unity's "Persp"); `bar` the first
 *   pill of the bar, opening the view menu (Unreal's "Perspective").
 * - `tools`: the transform tools on the `shelf` (Blender's, Unity's Tools overlay) or at the
 *   bar's `bar-start` (Godot) or `bar-end` (Unreal).
 * - `display`: the display controls (shading, grid, helpers, lights) in the top-right
 *   `corner` or at the bar's `bar-start` (Unity, Unreal) or `bar-end` (Godot).
 * - `navigation`: whether the zoom and pan cluster under the navigation gizmo is drawn
 *   (Blender's only).
 * - `readout`: whether the camera's position and target are drawn at the bottom-left (the
 *   editor's own; no reference draws one).
 */
export interface StageChromeContribution {
  readonly bar?: 'strip' | 'pills';
  readonly viewName?: 'text' | 'menu' | 'gizmo' | 'bar';
  readonly tools?: 'shelf' | 'bar-start' | 'bar-end';
  readonly display?: 'corner' | 'bar-start' | 'bar-end';
  readonly navigation?: boolean;
  readonly readout?: boolean;
}

/**
 * A glyph's CATEGORY — the colour channel a set may carry per glyph, painted
 * as `var(--vgai-category-<tone>, currentColor)` so a palette that names no
 * `color.category` group paints the glyph exactly as a monochrome one.
 *
 * The vocabulary is Blender's Properties-tab rail read as data: that rail
 * groups by HUE, and at 14 px the hue is what tells one tab from another
 * (`properties-object.png` — the shapes are near-indistinguishable). Each
 * member is a MEASURED ink; see `EditorTheme.color.category` for the values
 * and their source coordinates.
 */
export type IconCategoryTone =
  | 'object'
  | 'modifier'
  | 'material'
  | 'tool'
  | 'operator'
  | 'data'
  // Blender's SCENE group and its COLLECTION, added 2026-09-19 (WORK.md
  // §Blender in the tab is Blender, "Inspection parity", I2 decision 3). They
  // are not a reading of the rail: every Blender icon declares its group in
  // `UI_icons.hh` through a `DEF_ICON_<GROUP>` macro, and
  // `interface_icons.cc:126-132` maps those onto the theme members
  // `interface/resources.cc:1059-1078` reads — `DEF_ICON_SCENE` →
  // `TH_ICON_SCENE` → `.tui.icon_scene` #cccccc
  // (`userdef_default_theme.c:272`), `DEF_ICON_COLLECTION` →
  // `.tui.icon_collection` #ffffff (`:273`). The Render, Output, View Layer
  // and Scene tabs are `DEF_ICON_SCENE`; the Collection tab is
  // `DEF_ICON_COLLECTION(GROUP)` (`UI_icons.hh:248`).
  | 'scene'
  | 'collection'
  // The SELECTION TOOLS' marquee, which Blender bakes into their tool icons' geometry
  // (`ops.generic.select_box`) rather than reading from a theme member.
  | 'select';

/**
 * An ICON SET a style bundle carries: glyphs keyed by the Font Awesome icon
 * name each editor site names (`plus`, `xmark`, `trash`, `gear`, …), each one
 * `path` painted with `currentColor` in its `viewBox` (default `0 0 16 16`).
 * A set may be partial — a glyph it lacks paints the editor's own.
 *
 * `tone` and `tonedPath` are the COLOUR channel, and they are two shapes of
 * one idea because Blender draws two shapes of it:
 *
 *  - `tone` alone tints the WHOLE glyph — the Properties rail's category
 *    tabs and the outliner's type glyphs, where the mark IS the category.
 *  - `tone` with `tonedPath` splits the glyph in two: `path` stays neutral
 *    (`currentColor`) and `tonedPath` takes the category ink. That is
 *    exactly how an operator mark reads in `modeling-edit-none.png` — the
 *    cube stays white and only the OPERATED element is tinted — and a
 *    single per-glyph tone cannot express it.
 *
 * Either way an explicit `tone` prop at the SITE wins, so a de-emphasized
 * (`dim`/`muted`) glyph stays de-emphasized.
 */
export interface IconSetContribution {
  readonly id: string;
  readonly title: string;
  readonly glyphs: Readonly<
    Record<
      string,
      {
        readonly viewBox?: string;
        readonly path: string;
        readonly tone?: IconCategoryTone;
        readonly tonedPath?: string;
      }
    >
  >;
}

export interface StyleContribution {
  readonly id: string;
  readonly title: string;
  /** A palette id the editor knows — a built-in, or the `palette` document
   *  this contribution carries. */
  readonly paletteId: string;
  /** A material id the editor knows — `classic`, `glass`, or the `material`
   *  this contribution carries. */
  readonly materialId: string;
  readonly material?: MaterialContribution;
  /** The icon set this bundle applies — the `icons` it carries, or one the
   *  editor knows. Absent: the editor's own glyphs. */
  readonly iconSetId?: string;
  readonly icons?: IconSetContribution;
  /** A v3 palette DOCUMENT (the same shape a person imports), registered into
   *  the editor's theme library with this bundle. */
  readonly palette?: unknown;
}
