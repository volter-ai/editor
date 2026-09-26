/**
 * THE SOURCE of `blender.icons.json`, which is PART OURS AND PART BLENDER'S.
 * 197 of the 346 glyphs it emits are machine-TRACED from Blender's own vector
 * sources and are GPL-2.0-or-later artwork (see "GPL PATHS, DELIBERATELY"
 * below, `blender-icon-trace.mjs`, and the provenance file
 * `blender.icons.traced.json`); the other 149 are drawn HERE in Blender's
 * IDIOM. That mixture is why `@vgai/blender` is
 * `AGPL-3.0-only AND GPL-3.0-or-later` (`packages/blender/LICENSE`).
 * The idiom is what a screenshot conveys: a 16-unit grid, monochrome filled
 * silhouettes, ~1.3-unit strokes rendered as filled capsules with round ends,
 * no outline around a fill, optical size ~12 units inside the 16 box.
 *
 * Run `node packages/blender/contributions/blender-icons.source.mjs` to rewrite
 * the JSON. The JSON is the artifact the style bundle imports; THIS is where a
 * glyph is edited, because a path `d` is not a thing a person edits by hand.
 *
 * Keys are Font Awesome icon NAMES (`icon.iconName`) — the editor's one icon
 * primitive swaps a glyph in per name and falls through to its own for any
 * name absent here, so this set is partial by design.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { traceBlenderIcon } from './blender-icon-trace.mjs';

/**
 * WHICH OF BLENDER'S ICONS EACH PROPERTIES TAB DRAWS, and the file each one
 * is. The `ICON_*` per tab is `buttons_context_items`
 * (`makesrna/intern/rna_space.cc:579-611`); the Data tab's is dynamic
 * (`buttons_context_compute`, `space_buttons/buttons_context.cc:795-810`:
 * `RNA_struct_ui_icon(ptr->type)`, with Light special-cased to
 * `ICON_OUTLINER_DATA_LIGHT`), so it has one entry per object data type,
 * each icon read from that type's own `RNA_def_struct_ui_icon` call.
 * An icon's file is its name lowercased.
 */
const TAB_ICON_SOURCES = {
  // The scene group, `ED_buttons_tabs_list`'s first block after the tool tab.
  'properties-render': 'scene', // ICON_SCENE
  'properties-output': 'output', // ICON_OUTPUT
  'properties-view-layer': 'render_result', // ICON_RENDER_RESULT
  'properties-scene': 'scene_data', // ICON_SCENE_DATA
  'properties-world': 'world', // ICON_WORLD
  // Its own block.
  'properties-collection': 'group', // ICON_GROUP
  // The object group.
  'properties-object': 'object_data', // ICON_OBJECT_DATA
  'properties-modifiers': 'modifier', // ICON_MODIFIER
  'properties-particles': 'particles', // ICON_PARTICLES
  'properties-physics': 'physics', // ICON_PHYSICS
  'properties-constraints': 'constraint', // ICON_CONSTRAINT
  'properties-bone': 'bone_data', // ICON_BONE_DATA
  'properties-bone-constraints': 'constraint_bone', // ICON_CONSTRAINT_BONE
  'properties-material': 'material', // ICON_MATERIAL
  // Its own block.
  'properties-texture': 'texture', // ICON_TEXTURE
  // The Data tab, per object type. `properties-data` is the fallback and is
  // MESH_DATA, which is what Blender shows for the starter cube.
  'properties-data': 'mesh_data',
  'properties-data-mesh': 'mesh_data', // Mesh        → ICON_MESH_DATA
  'properties-data-armature': 'armature_data', // Armature    → ICON_ARMATURE_DATA
  'properties-data-curve': 'curve_data', // Curve       → ICON_CURVE_DATA
  'properties-data-surface': 'surface_data', // SurfaceCurve→ ICON_SURFACE_DATA
  'properties-data-meta': 'meta_data', // MetaBall    → ICON_META_DATA
  'properties-data-font': 'font_data', // TextCurve   → ICON_FONT_DATA
  'properties-data-lattice': 'lattice_data', // Lattice     → ICON_LATTICE_DATA
  'properties-data-camera': 'camera_data', // Camera      → ICON_CAMERA_DATA
  'properties-data-light': 'outliner_data_light', // Light, special-cased
  'properties-data-speaker': 'speaker', // Speaker     → ICON_SPEAKER
  'properties-data-pointcloud': 'pointcloud_data', // PointCloud  → ICON_POINTCLOUD_DATA
  'properties-data-volume': 'volume_data', // Volume      → ICON_VOLUME_DATA
  'properties-data-empty': 'empty_data', // no data     → ICON_EMPTY_DATA
};

/**
 * THE OUTLINER'S MARKS — every icon `tree_element_get_icon`
 * (`outliner_draw.cc:2619-2945`) and `tree_element_get_icon_from_id`
 * (`:2479-2610`) can pick for a row of Blender's View Layer tree, by FAMILY
 * rather than one line per mark (WORK.md §Blender in the tab is Blender,
 * "Inspection parity", I3).
 *
 * A FAMILY AND NOT A LIST, deliberately. The door reports whatever `ICON_*`
 * Blender picked, and the two places that pick are a `switch` over ID codes and
 * `RNA`'s own enum items (`rna_enum_object_type_items`,
 * `rna_enum_object_modifier_type_items`, `rna_enum_constraint_type_items`) —
 * sixty-three modifier marks and twenty-eight constraint marks among them. A
 * table of names here would be a transcription of those enums maintained in a
 * second place, and the first mark it fell behind on would draw a Font Awesome
 * circle in the middle of Blender's tree. The prefix is what the enums
 * themselves are named by, so tracing the prefix traces the enum.
 *
 * Each traced glyph is named `blender-<file>` with dashes — which is exactly
 * what `blender-outliner-authoring.ts`'s `blenderOutlinerKind` spells from the
 * icon name the door sends, so the two meet with no table at all.
 */
const OUTLINER_ICON_FAMILIES = [
  // `icon_from_object_type` and `tree_element_get_icon_from_id`'s data marks.
  'outliner_',
  // A light's lamp type and a probe's — the two sub-switches.
  'light_',
  'lightprobe_',
  // `ModifierTypeInfo::icon` and the constraint switch.
  'mod_',
  'con_',
];

/** The marks the Outliner draws that belong to no family above — the base
 *  rows' labels ("Modifiers", "Vertex Groups", "Pose"), the datablock marks a
 *  non-object ID answers, and the two restriction-column glyphs. */
const OUTLINER_ICON_NAMES = [
  'modifier_data',
  'constraint',
  'constraint_bone',
  'group_vertex',
  'group_bone',
  'bone_data',
  'armature_data',
  'shapekey_data',
  'anim_data',
  'particles',
  'material_data',
  'texture_data',
  'image_data',
  'world_data',
  'scene_data',
  'object_data',
  'nodetree',
  'action',
  'line_data',
  'brush_data',
  'mod_mask',
  'file_text',
  'file_font',
  'sequence',
  'color',
  'workspace',
  'library_data_direct',
  'dot',
  // The Disable in Renders column (`outliner_draw.cc:1363-1384`), under names
  // of OURS so the bare `camera` glyph — the viewport header's camera menu —
  // is not repainted. `hierarchy-kind-icon.ts` mints the same two names.
  ['outliner-render-on', 'restrict_render_off'],
  ['outliner-render-off', 'restrict_render_on'],
  // The EXCLUDE column (`outliner_draw.cc:1634-1653`). Blender asks for
  // `ICON_NONE` there, which makes the icon toggle draw the widget's own
  // checkbox — `checkbox_hlt` / `checkbox_dehlt` — so those are the two marks,
  // under names of OURS for the same reason the render pair has them.
  ['outliner-exclude-on', 'checkbox_hlt'],
  ['outliner-exclude-off', 'checkbox_dehlt'],
];

const TRACED = new URL('./blender.icons.traced.json', import.meta.url);

/**
 * `--trace` — RE-DERIVE the traced paths from a Blender checkout. Separate
 * from the ordinary run on purpose: the checkout is a developer's local clone
 * of Blender at the engine's pin (the recipe is in WORK.md §Blender in the
 * tab is Blender, "Inspection parity"), and a generator that silently emits
 * different glyphs depending on whether a sibling directory happens to exist
 * is worse than one that needs a flag. The JSON it writes is checked in and
 * records each glyph's source path and sha256, so a later trace that disagrees
 * is a visible diff rather than a mystery.
 */
if (process.argv.includes('--trace')) {
  const checkout = process.env['BLENDER_SRC'] ?? `${homedir()}/volter/blender-src`;
  const out = {};
  // WHICH THEME COLOUR EACH MARK TAKES, read rather than assigned by eye. An
  // icon's `DEF_ICON_<GROUP>` macro in `editors/include/UI_icons.hh` is what
  // `interface_icons.cc:120-134` turns into a `TH_ICON_*`, which
  // `resources.cc:1059-1078` resolves against `.tui` — so the macro IS the
  // tone, and this reads it per icon at trace time instead of keeping a second
  // table of sixty-odd assignments in sync by hand. A plain `DEF_ICON` (and
  // `DEF_ICON_COLOR`, which is an SVG drawn in its own colours) takes none.
  const MACRO_TONE = {
    DEF_ICON_SCENE: 'scene',
    DEF_ICON_COLLECTION: 'collection',
    DEF_ICON_OBJECT: 'object',
    DEF_ICON_OBJECT_DATA: 'data',
    DEF_ICON_MODIFIER: 'modifier',
    DEF_ICON_SHADING: 'material',
  };
  const iconsHeader = readFileSync(
    `${checkout}/source/blender/editors/include/UI_icons.hh`,
    'utf8',
  );
  const toneByIcon = new Map();
  for (const match of iconsHeader.matchAll(/^DEF_ICON(?:_([A-Z_]+))?\(([A-Z0-9_]+)\)/gm)) {
    const tone = MACRO_TONE[`DEF_ICON_${match[1] ?? ''}`];
    if (tone) toneByIcon.set(match[2], tone);
  }
  if (toneByIcon.size === 0)
    throw new Error(
      'UI_icons.hh yielded no DEF_ICON_<GROUP> lines — the tone read is the source of every ' +
        "glyph's colour, so an empty read is a silent grey rail, not a missing nicety.",
    );
  // The Outliner's families, resolved against the checkout's own icon
  // directory so a family is traced whole (see OUTLINER_ICON_FAMILIES).
  const available = readdirSync(`${checkout}/release/datafiles/icons_svg`)
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -4))
    .sort();
  const outlinerSources = {};
  for (const family of OUTLINER_ICON_FAMILIES) {
    const members = available.filter((icon) => icon.startsWith(family));
    if (members.length === 0)
      throw new Error(
        `No icon in the checkout starts with "${family}". A family that traces to nothing is ` +
          'how the Outliner silently falls back to Font Awesome circles.',
      );
    for (const icon of members) outlinerSources[`blender-${icon.replace(/_/g, '-')}`] = icon;
  }
  for (const entry of OUTLINER_ICON_NAMES) {
    const [name, icon] = Array.isArray(entry)
      ? entry
      : [`blender-${entry.replace(/_/g, '-')}`, entry];
    outlinerSources[name] = icon;
  }
  for (const [name, icon] of Object.entries({ ...TAB_ICON_SOURCES, ...outlinerSources })) {
    const relative = `release/datafiles/icons_svg/${icon}.svg`;
    let svg;
    try {
      svg = readFileSync(`${checkout}/${relative}`, 'utf8');
    } catch {
      throw new Error(
        `${relative} is not in the Blender checkout at ${checkout}. Set BLENDER_SRC, or add ` +
          `the directory to the sparse checkout: \`git sparse-checkout add release/datafiles/icons_svg\` ` +
          'followed by the LFS-off checkout line in WORK.md.',
      );
    }
    if (svg.startsWith('version https://git-lfs')) {
      throw new Error(
        `${relative} is an LFS POINTER, not an SVG. Fetch it: ` +
          `\`git lfs pull -I ${relative}\` in ${checkout}.`,
      );
    }
    const { path, box } = traceBlenderIcon(svg);
    const tone = toneByIcon.get(icon.toUpperCase());
    out[name] = {
      icon: `ICON_${icon.toUpperCase()}`,
      source: relative,
      sha256: createHash('sha256').update(svg).digest('hex'),
      box,
      ...(tone ? { tone } : {}),
      path,
    };
  }
  writeFileSync(TRACED, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`blender.icons.traced.json — ${Object.keys(out).length} glyphs traced`);
  process.exit(0);
}

/** The traced marks, keyed by this set's glyph name. See the Properties-rail
 *  block near the bottom of this file for what they are and why. */
const traced = JSON.parse(readFileSync(TRACED, 'utf8'));

// ---------------------------------------------------------------- primitives

const f = (n) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * TWO GLOBAL DIALS, set against the running chrome rather than guessed. The
 * editor paints a glyph at the ACTIVE font size — an 11px hierarchy row, a
 * 10px status bar — where a 1.3-unit stroke in a 16-unit box lands at 0.9
 * device pixels and greys out. `S` grows the optical size to ~14.5 units
 * inside the 16 box — Blender's glyphs FILL their box where Font Awesome's
 * carry padding, and measured against the reference frames that ratio (ink
 * over row height) is what makes a row read as Blender's; `W` fattens every
 * stroke so it still covers a pixel in an 11px row. Geometry below is
 * authored on the plain 16 grid and both dials are applied here, once.
 */
const S = 1.22;
const W = 1.12;
const p = (x, y) => `${f(8 + (x - 8) * S)} ${f(8 + (y - 8) * S)}`;
/** A radius, in the same scaled space `p` emits into. */
const rr = (r) => f(r * S);

/**
 * A straight stroke with round ends: the capsule its outline encloses.
 *
 * THE SWEEP FLAG IS 0, AND IT WAS 1 UNTIL 2026-09-19 — a one-character defect
 * under every open stroke end in this set. With sweep 1 each end arc bulges
 * INWARD instead of outward, so the path is the rectangle MINUS two
 * half-discs: every open end came out with a crescent bitten out of it, and
 * at a polyline's joint the two bites ate a round notch out of the corner.
 * Nothing reported it because at the 14 px chrome size the bite is one device
 * pixel; it was found at 6x in the editor-type well, whose chevron drew as
 * two arrowheads with a hole where they meet (rendered side by side, sweep 1
 * against sweep 0, before the flag was touched).
 *
 * Closed shapes change too, and toward this docblock's own words: `line(…,
 * closed)` and `rframe` corners were each losing a notch to the same bites,
 * half-covered by the neighbouring capsule.
 *
 * THE BLAST RADIUS, MEASURED rather than reasoned (every glyph rasterized at
 * 64 px both ways and the masks differenced): 97 of the 146 paths move. 96 of
 * them ONLY GAIN ink, at an end or a corner — a knockout that is not there
 * can take nothing. The 97th, `layer-group`, gains 199 px and loses one, on an
 * antialiased boundary. Nothing here was tuned against the bitten rendering:
 * the two glyphs this set fits pixel-by-pixel to a reference frame
 * (`properties-modifiers`, and `outliner`/`properties` below) are built from
 * `poly` and `rrect` and do not move at all.
 */
function cap(x1, y1, x2, y2, width = 1.3) {
  const w = width * W;
  const r = w / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return dot(x1, y1, r);
  const nx = -dy / L;
  const ny = dx / L;
  return (
    `M${p(x1 + nx * r, y1 + ny * r)}L${p(x2 + nx * r, y2 + ny * r)}` +
    `A${rr(r)} ${rr(r)} 0 0 0 ${p(x2 - nx * r, y2 - ny * r)}` +
    `L${p(x1 - nx * r, y1 - ny * r)}` +
    `A${rr(r)} ${rr(r)} 0 0 0 ${p(x1 + nx * r, y1 + ny * r)}Z`
  );
}

/** A filled disc. `ccw` winds it backwards so it punches a hole (nonzero). */
function dot(cx, cy, r, ccw = false) {
  const s = ccw ? 1 : 0;
  return (
    `M${p(cx - r, cy)}A${rr(r)} ${rr(r)} 0 1 ${s} ${p(cx + r, cy)}` +
    `A${rr(r)} ${rr(r)} 0 1 ${s} ${p(cx - r, cy)}Z`
  );
}

/** A circular outline of thickness `w` — a disc with a disc punched out. */
function ring(cx, cy, r, width = 1.3) {
  const w = width * W;
  return dot(cx, cy, r + w / 2) + dot(cx, cy, Math.max(r - w / 2, 0.01), true);
}

/**
 * A polyline stroked with round ends and round joins.
 *
 * THE JOINS NEED NO EXTRA DISC, and stamping one was actively destructive.
 * Each `cap` ends in a full semicircle of radius w/2 centred on the join, so
 * the union of two capsules already contains the whole join disc — the joins
 * are round for free. The disc this used to add at every interior vertex had
 * the opposite winding to the capsules it landed in, so under
 * `fill-rule: nonzero` it PUNCHED A HOLE: render `line([[3,3],[3,13],[13,13]])`
 * at 24x and the corner is a white ring around a black core, where the same
 * two `cap` calls alone give a solid corner. At 14px that hole is a sub-pixel
 * dark pip on every corner of every stroked glyph in the set — the
 * "greys out at a small size" symptom, dropped here for all 130 at once.
 */
function line(pts, w = 1.3, closed = false) {
  let d = '';
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    d += cap(a[0], a[1], b[0], b[1], w);
  }
  return d;
}

/** Twice the signed area — the sign IS the winding, and under `fill-rule:
 *  nonzero` the winding is the whole difference between ink and a hole. */
function area2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

/** A filled polygon, wound the way `dot` winds a disc so the two union. */
function poly(pts, hole = false) {
  const wound = area2(pts) > 0 === hole ? pts : [...pts].reverse();
  return `M${wound.map(([x, y]) => p(x, y)).join('L')}Z`;
}

/**
 * A filled rectangle with equal corner radii.
 *
 * IT WINDS THE WAY `poly` AND `cap` WIND, and that is load-bearing, not a
 * detail: for most of this file's life the rounded branch ran the other way
 * round the corners, so under `fill-rule: nonzero` every `holeBar`/`dot(ccw)`
 * aimed at a rounded rect UNIONED instead of punching, and every ordinary
 * `poly`/`dot` drawn over one punched a hole instead of adding ink. Nothing
 * reported it — a knockout that does nothing just looks like a solid glyph.
 * It silently ate the collection box's pull slot, the wrench's fork and the
 * bulb's screw thread, and it is why the pan hand carried a bite out of its
 * palm where its thumb should be. Measured, not reasoned: render
 * `rrect(r) + holeBar` and read the centre pixel.
 */
function rrect(x, y, w, h, r = 0) {
  const rad = Math.min(r, w / 2, h / 2);
  if (rad <= 0.01)
    return poly([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ]);
  const a = (px, py) => `A${rr(rad)} ${rr(rad)} 0 0 0 ${p(px, py)}`;
  return (
    `M${p(x + rad, y)}${a(x, y + rad)}L${p(x, y + h - rad)}${a(x + rad, y + h)}` +
    `L${p(x + w - rad, y + h)}${a(x + w, y + h - rad)}` +
    `L${p(x + w, y + rad)}${a(x + w - rad, y)}Z`
  );
}

/**
 * A rectangular outline of thickness `w`, corners rounded by the joins.
 *
 * A corner radius SMALLER than the stroke's own round end is not a corner
 * radius, it is a defect: the bevel becomes a segment shorter than the capsule
 * is wide, its capsule overlaps both neighbours almost entirely, and the
 * overlap cancels under `fill-rule: nonzero` — at 12x, `border-all` (r 0.4,
 * t 1) and `object-group` (r 0.3, t 2.1) both showed a hollow pip at every
 * corner. Below `t/2` the caps already round the corner by more than `r`
 * asked for, so the plain four-point path is both cleaner and closer to the
 * request.
 */
function rframe(x, y, w, h, t = 1.3, r = 0) {
  const inset = t / 2;
  if (r <= inset) {
    return line(
      [
        [x + inset, y + inset],
        [x + w - inset, y + inset],
        [x + w - inset, y + h - inset],
        [x + inset, y + h - inset],
      ],
      t,
      true,
    );
  }
  const pts = [
    [x + inset + r, y + inset],
    [x + w - inset - r, y + inset],
    [x + w - inset, y + inset + r],
    [x + w - inset, y + h - inset - r],
    [x + w - inset - r, y + h - inset],
    [x + inset + r, y + h - inset],
    [x + inset, y + h - inset - r],
    [x + inset, y + inset + r],
  ];
  return line(r > 0 ? pts : [pts[0], pts[1], pts[3], pts[5]], t, true);
}

/**
 * A stroked arc, angles in degrees, 0 = +x, growing clockwise on screen.
 *
 * ONE annulus band, not a chain of capsules. Built as `line()` over sampled
 * points, each segment's capsule is shorter than it is wide, consecutive
 * capsules overlap almost entirely, and the overlaps cancel under
 * `fill-rule: nonzero` — rendered at 24x, `rotate`'s arc and `lock`'s shackle
 * came out as a row of hollow circles rather than a stroke. A band has no
 * overlaps to cancel: out along the outer radius, back along the inner.
 */
function arc(cx, cy, r, a0, a1, w = 1.3, steps = 0) {
  const t = (w * W) / 2;
  const n = steps || Math.max(6, Math.ceil(Math.abs(a1 - a0) / 9));
  const at = (i, rad) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
  };
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(at(i, r + t));
  for (let i = n; i >= 0; i--) pts.push(at(i, Math.max(r - t, 0.01)));
  // Round the two ends so the band still reads as a stroke, not a ribbon.
  return poly(pts) + dot(...at(0, r), t) + dot(...at(n, r), t);
}

/** A stroked elliptical arc — cylinder lips, cloud shoulders, orbits. */
function ellipseArc(cx, cy, rx, ry, a0, a1, w = 1.15, rot = 0, closed = false) {
  const t = (rot * Math.PI) / 180;
  const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 15));
  const pts = [];
  for (let i = 0; i <= (closed ? n - 1 : n); i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push([cx + x * Math.cos(t) - y * Math.sin(t), cy + x * Math.sin(t) + y * Math.cos(t)]);
  }
  return line(pts, w, closed);
}

/** A filled half-disc, `a0`..`a1` swept — the lit half of a shading toggle. */
function wedge(cx, cy, r, a0, a1) {
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 12));
  const pts = [[cx, cy]];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return poly(pts);
}

/**
 * A HOLE — the same bar or wedge, wound backwards so `fill-rule: nonzero`
 * knocks it out of a solid silhouette underneath. This is how the status
 * family survives the 10px status bar: at that size a thin ring with a mark
 * inside it fills in and every glyph becomes a disc, where a SOLID disc with
 * its mark knocked out keeps the mark's contrast at one device pixel. It is
 * also Blender's own construction — the collection box's slot and the
 * camera's lens are knocked out of their silhouettes, not drawn on them.
 */
function holeBar(x1, y1, x2, y2, w) {
  const r = w / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * r;
  const ny = (dx / L) * r;
  return poly(
    [
      [x1 + nx, y1 + ny],
      [x1 - nx, y1 - ny],
      [x2 - nx, y2 - ny],
      [x2 + nx, y2 + ny],
    ],
    true,
  );
}

/** A polygon wound backwards — a knocked-out shape. */
function holePoly(pts) {
  return poly(pts, true);
}

/** Blender's chevron: a thin V, the outliner's disclosure and every menu arrow. */
function chevron(cx, cy, s, dir) {
  const v = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[dir];
  const perp = [-v[1], v[0]];
  const tip = [cx + v[0] * s * 0.55, cy + v[1] * s * 0.55];
  const back = -s * 0.55;
  return line(
    [
      [cx + v[0] * back + perp[0] * s, cy + v[1] * back + perp[1] * s],
      tip,
      [cx + v[0] * back - perp[0] * s, cy + v[1] * back - perp[1] * s],
    ],
    1.3,
  );
}

/**
 * Blender's isometric cube — a SOLID hexagonal silhouette with its three
 * interior seams knocked out, never a wire box. `outliner.png` at matched
 * scale settles it: every object mark in a row is a filled silhouette with its
 * detail punched through, and the wire version of this glyph collapsed into an
 * undifferentiated grey circle at the 14px row size (its three 1.15-unit
 * spokes merged and the hexagon's corners rounded away).
 */
function isoCube(cx = 8, cy = 8, s = 5.4, seam = 1.05) {
  const top = [cx, cy - s];
  const tr = [cx + s * 0.87, cy - s * 0.5];
  const br = [cx + s * 0.87, cy + s * 0.5];
  const bot = [cx, cy + s];
  const bl = [cx - s * 0.87, cy + s * 0.5];
  const tl = [cx - s * 0.87, cy - s * 0.5];
  return (
    poly([tl, top, tr, br, bot, bl]) +
    holeBar(tl[0], tl[1], cx, cy, seam) +
    holeBar(tr[0], tr[1], cx, cy, seam) +
    holeBar(bot[0], bot[1], cx, cy, seam)
  );
}

// ------------------------------------------------------------------- glyphs
// Keyed by Font Awesome icon name. Grouped the way the chrome reads them.

const glyphs = {};
/**
 * `meta` is the glyph's COLOUR channel (`IconSetContribution`): `tone` names
 * a category the palette inks, and `tonedPath` splits the drawing so only
 * that second path takes it. Whole-glyph tones are assigned from one table
 * further down, next to the frames they were measured in; `tonedPath` has to
 * be authored HERE, because it is a division of the geometry.
 */
const g = (name, d, meta) => {
  glyphs[name] = { path: d, ...(meta ?? {}) };
};

// -- disclosure, carets, arrows ------------------------------------------
g('chevron-right', chevron(7.4, 8, 3.1, 'right'));
g('chevron-left', chevron(8.6, 8, 3.1, 'left'));
g('chevron-down', chevron(8, 7.4, 3.1, 'down'));
// BLENDER HAS NO SOLID CARET. Both places the editor spends one — a dropdown
// trigger's disclosure and a tree row's expander — Blender draws an open
// CHEVRON, measured in two frames: `modeling.png` at its native 2x, the
// orientation well's mark at x 1304..1316, y 76..83 (13x8 device px = 6.5x4
// CSS, peak 216); and `outliner.png` (also native 2x), the collapsed Camera
// row's mark at x 96..105, y 146..163 (10x18 = 5x9 CSS) and the expanded
// Collection row's at x 52..69, y 110..119 (18x10 = 9x5 CSS), peak 194. Both
// are a 1 CSS px stroke and both run 1.8:1, which is exactly what `chevron()`
// draws. The names stay `caret-*` — a set draws the editor's names its own
// way, and Font Awesome's filled triangle is still what every other skin gets.
// `s` is 4.4 rather than `chevron-*`'s 3.1 so the mark keeps the EXTENT the
// filled caret had here (8.8 of 16 units, ~7 CSS px against Blender's 6.5).
g('caret-right', chevron(7.4, 8, 4.4, 'right'));
g('caret-down', chevron(8, 7.4, 4.4, 'down'));
g(
  'arrow-right',
  cap(2.6, 8, 12.4, 8) +
    line([
      [9.2, 4.8],
      [12.6, 8],
      [9.2, 11.2],
    ]),
);
g(
  'arrow-left',
  cap(3.6, 8, 13.4, 8) +
    line([
      [6.8, 4.8],
      [3.4, 8],
      [6.8, 11.2],
    ]),
);
g(
  'arrow-up',
  cap(8, 3.6, 8, 13.4) +
    line([
      [4.8, 6.8],
      [8, 3.4],
      [11.2, 6.8],
    ]),
);
g(
  'arrow-down',
  cap(8, 2.6, 8, 12.4) +
    line([
      [4.8, 9.2],
      [8, 12.6],
      [11.2, 9.2],
    ]),
);

// -- the primary actions --------------------------------------------------
g('plus', cap(8, 3, 8, 13) + cap(3, 8, 13, 8));
g('minus', cap(3, 8, 13, 8));
g('xmark', cap(4.2, 4.2, 11.8, 11.8) + cap(11.8, 4.2, 4.2, 11.8));
g(
  'check',
  line(
    [
      [3.4, 8.4],
      [6.6, 11.6],
      [12.8, 4.6],
    ],
    1.5,
  ),
);
g(
  'trash',
  rrect(3.3, 4.2, 9.4, 1.5, 0.5) +
    line(
      [
        [6.2, 4.2],
        [6.2, 3.1],
        [9.8, 3.1],
        [9.8, 4.2],
      ],
      1.2,
    ) +
    line(
      [
        [4.5, 6.1],
        [5.1, 13.1],
        [10.9, 13.1],
        [11.5, 6.1],
      ],
      1.25,
    ) +
    cap(6.7, 7.4, 6.9, 11.5, 1.1) +
    cap(9.3, 7.4, 9.1, 11.5, 1.1),
);
g('magnifying-glass', ring(7.1, 7.1, 3.7, 1.3) + cap(9.9, 9.9, 13.2, 13.2, 1.4));
/**
 * ZOOM is not SEARCH, and Blender draws the two differently — both frames
 * agree: the Search field's magnifier (`outliner.png`, `properties-object.png`)
 * is a thin RING with a handle, while the viewport navigation cluster's zoom
 * (`modeling-object-none.png`) is a SOLID lens disc with the sign knocked
 * through it and a short fat handle. So `magnifying-glass` keeps its ring and
 * the two signed ones become lenses; drawn as rings, their 1.1-unit sign
 * strokes were the faintest ink on the whole navigation cluster.
 */
// The handle STARTS INSIDE the lens (9.3,9.3 is 3.1 from the centre of a
// 4.25 disc): begun at 10.2 it cleared the disc's edge by a tenth of a unit
// and the round cap floated off as a separate lozenge at 16px — measured in
// round 1's frame, where the navigation cluster showed a disc and a diamond.
const zoomLens = (sign) => dot(7.1, 7.1, 4.25) + sign + cap(9.3, 9.3, 13.4, 13.4, 2);
// THE PLUS IS ONE HOLE, a cross outline: two crossing hole bars wind the crossing twice, and
// under nonzero fill that square paints lens-coloured again (the frame showed a pale centre).
// Its arms are Blender's on `gizmo-select-box.png`'s cluster: 14 device px across a 26 px
// lens, 2.2 px thick.
const plusHole = (cx, cy, a, t) =>
  poly(
    [
      [cx - t, cy - a],
      [cx + t, cy - a],
      [cx + t, cy - t],
      [cx + a, cy - t],
      [cx + a, cy + t],
      [cx + t, cy + t],
      [cx + t, cy + a],
      [cx - t, cy + a],
      [cx - t, cy + t],
      [cx - a, cy + t],
      [cx - a, cy - t],
      [cx - t, cy - t],
    ],
    true,
  );
g('magnifying-glass-plus', zoomLens(plusHole(7.1, 7.1, 2.3, 0.36)));
g('magnifying-glass-minus', zoomLens(holeBar(4.8, 7.1, 9.4, 7.1, 0.72)));
g('ellipsis', dot(3.6, 8, 1.15) + dot(8, 8, 1.15) + dot(12.4, 8, 1.15));
g('grip-lines', cap(3, 6.3, 13, 6.3, 1.2) + cap(3, 9.7, 13, 9.7, 1.2));
g('grip-lines-vertical', cap(6.3, 3, 6.3, 13, 1.2) + cap(9.7, 3, 9.7, 13, 1.2));
g('copy', rframe(2.4, 2.4, 8.4, 8.4, 1.2, 1) + rframe(5.9, 5.9, 8.4, 8.4, 1.2, 1));

// -- visibility, the outliner's right column ------------------------------
/**
 * The eye is the KNOCKOUT construction the header describes, and it is what
 * `outliner.png` shows at matched scale: one solid almond, a dark iris punched
 * out of it, a bright pupil inside the iris — white / dark / white, three
 * bands that survive a 14px row. Drawn instead as two thin lid strokes with a
 * dot between them (what this was through round 0), every band is a
 * partial-coverage stroke: measured against its own row, the glyph peaked at
 * p95 145 where the label beside it peaked at 185, while Blender's peaks
 * ABOVE its label (151 vs 129). A silhouette reaches full ink; a hairline
 * cannot.
 */
const eyeLid = [
  [1.8, 8],
  [3.6, 5.3],
  [5.9, 4],
  [8, 3.7],
  [10.1, 4],
  [12.4, 5.3],
  [14.2, 8],
];
const eyeAlmond = [...eyeLid, ...eyeLid.map(([x, y]) => [x, 16 - y]).reverse()];
const eye = poly(eyeAlmond) + dot(8, 8, 2.9, true) + dot(8, 8, 1.5);
g('eye', eye);
g('eye-slash', eye + cap(3.4, 12.6, 12.6, 3.4, 1.35));
g('lock', rrect(3.4, 7.2, 9.2, 6.4, 1.1) + arc(8, 7.1, 2.75, 180, 360, 1.25) + dot(8, 10.4, 1.1));
g(
  'lock-open',
  rrect(3.4, 7.2, 9.2, 6.4, 1.1) + arc(11.1, 7.1, 2.75, 180, 330, 1.25) + dot(8, 10.4, 1.1),
);

// -- content kinds --------------------------------------------------------
g('cube', isoCube());
g('cubes', isoCube(5.1, 5.6, 3.5, 0.8) + isoCube(10.9, 10.4, 3.5, 0.8));
g('cubes-stacked', isoCube(8, 4.6, 3.3, 0.8) + isoCube(8, 11.4, 3.3, 0.8));
g('square', rframe(3, 3, 10, 10, 1.3));
g('circle', ring(8, 8, 4.4, 1.3));
g('circle-dot', dot(8, 8, 6) + dot(8, 8, 3.9, true) + dot(8, 8, 2));
// Blender's collection: a lidded box with a pull slot.
// Filled body, filled lid band, and the pull slot KNOCKED OUT of the body —
// exactly what `outliner.png` shows at matched scale, where Blender's
// Collection is the brightest mark in the row. Drawn as a 1.25-unit frame
// under a filled lid, it read as a hairline rectangle no heavier than the
// label beside it.
const box =
  rrect(2.6, 5.4, 10.8, 8, 0.6) + rrect(2, 2.4, 12, 2.6, 0.5) + holeBar(6.2, 8.6, 9.8, 8.6, 1.6);
g('box-archive', box);
g(
  'folder',
  line(
    [
      [2.2, 12.9],
      [2.2, 4.1],
      [6.4, 4.1],
      [7.6, 5.7],
      [13.8, 5.7],
      [13.8, 12.9],
    ],
    1.3,
    true,
  ),
);
g(
  'folder-open',
  line(
    [
      [2.2, 12.9],
      [2.2, 4.1],
      [6.4, 4.1],
      [7.6, 5.7],
      [12.4, 5.7],
      [12.4, 7.6],
    ],
    1.3,
  ) +
    line(
      [
        [2.2, 12.9],
        [4.4, 7.6],
        [15, 7.6],
        [12.8, 12.9],
      ],
      1.3,
      true,
    ),
);
g(
  'folder-tree',
  rframe(2, 2.6, 5.6, 4.2, 1.2, 0.5) +
    rframe(8.4, 9.2, 5.6, 4.2, 1.2, 0.5) +
    line(
      [
        [4.8, 6.8],
        [4.8, 11.3],
        [8.4, 11.3],
      ],
      1.15,
    ),
);
const page =
  line(
    [
      [3.4, 1.9],
      [9.2, 1.9],
      [12.6, 5.3],
      [12.6, 14.1],
      [3.4, 14.1],
    ],
    1.25,
    true,
  ) +
  line(
    [
      [9, 2.1],
      [9, 5.5],
      [12.4, 5.5],
    ],
    1.15,
  );
g('file', page);
g('file-lines', page + cap(5.6, 8, 10.4, 8, 1.1) + cap(5.6, 10.6, 10.4, 10.6, 1.1));
g(
  'file-code',
  page +
    line(
      [
        [7.2, 8],
        [5.6, 9.8],
        [7.2, 11.6],
      ],
      1.1,
    ) +
    line(
      [
        [9.4, 8],
        [11, 9.8],
        [9.4, 11.6],
      ],
      1.1,
    ),
);
g(
  'file-image',
  page +
    dot(6.6, 8.2, 1) +
    line(
      [
        [5.2, 12.1],
        [7.6, 9.4],
        [9.2, 11.2],
        [10.4, 10.1],
        [12, 12.1],
      ],
      1.1,
    ),
);
g(
  'file-export',
  page +
    cap(8.4, 10.4, 14.4, 10.4, 1.2) +
    line(
      [
        [12.2, 8.4],
        [14.6, 10.4],
        [12.2, 12.4],
      ],
      1.2,
    ),
);
g(
  'image',
  rframe(2, 3, 12, 10, 1.25, 0.8) +
    dot(5.8, 6.6, 1.15) +
    line(
      [
        [3.4, 11.6],
        [6.8, 8.1],
        [8.8, 10.2],
        [10.6, 8.4],
        [12.9, 11.2],
      ],
      1.15,
    ),
);
g(
  'film',
  rframe(1.8, 3, 12.4, 10, 1.25, 0.6) +
    cap(4.6, 3.6, 4.6, 12.4, 1.15) +
    cap(11.4, 3.6, 11.4, 12.4, 1.15) +
    cap(4.6, 8, 11.4, 8, 1.15),
);
g(
  'code',
  line(
    [
      [6, 3.4],
      [2.2, 8],
      [6, 12.6],
    ],
    1.3,
  ) +
    line(
      [
        [10, 3.4],
        [13.8, 8],
        [10, 12.6],
      ],
      1.3,
    ),
);
g(
  'terminal',
  line(
    [
      [3, 4.2],
      [7, 8],
      [3, 11.8],
    ],
    1.3,
  ) + cap(8.4, 12.2, 13.4, 12.2, 1.25),
);
g(
  'table',
  rframe(2, 3, 12, 10, 1.2, 0.5) +
    cap(2.6, 6.4, 13.4, 6.4, 1.15) +
    cap(7.2, 6.4, 7.2, 12.4, 1.15) +
    cap(2.6, 9.6, 13.4, 9.6, 1.15),
);
g(
  'table-cells',
  rframe(2, 3, 12, 10, 1.2, 0.5) +
    cap(2.6, 6.4, 13.4, 6.4, 1.1) +
    cap(2.6, 9.6, 13.4, 9.6, 1.1) +
    cap(6.2, 3.4, 6.2, 12.6, 1.1) +
    cap(9.8, 3.4, 9.8, 12.6, 1.1),
);
g(
  'table-cells-large',
  rframe(2, 3, 12, 10, 1.2, 0.5) + cap(2.6, 8, 13.4, 8, 1.15) + cap(8, 3.4, 8, 12.6, 1.15),
);
/**
 * A FLAT 3x3 grid, and it STAYS FLAT. Four sites ask for `border-all` and
 * three of them mean a flat grid — the canvas viewport's grid toggle, the
 * 3D viewport overlay's, and the CSS border editor's "all borders" — so the
 * trapezoid Blender draws on the navigation cluster's projection toggle is
 * NOT this glyph's to become. It gets its own name below, which is the same
 * ruling `editorIcons.modeling`'s docblock already records for the mesh
 * operators: a glyph that IS an operation owns its own name.
 */
g(
  'border-all',
  rframe(3.2, 3.2, 9.6, 9.6, 1, 0.4) +
    cap(6.4, 3.7, 6.4, 12.3, 0.85) +
    cap(9.6, 3.7, 9.6, 12.3, 0.85) +
    cap(3.7, 6.4, 12.3, 6.4, 0.85) +
    cap(3.7, 9.6, 12.3, 9.6, 0.85),
);
/**
 * THE PROJECTION TOGGLE at the foot of the navigation cluster — Blender's
 * fourth cell, and it is a PERSPECTIVE grid, not a square one. Read off
 * `modeling-edit-none.png` (device x 2774..2805, y 541..572): a symmetric
 * trapezoid 32 device wide by 26 tall, four horizontal rules whose spacing
 * OPENS downward (6, 8, 10 device) and four verticals converging upward, the
 * outer pair running x 6.8 -> 1.5 on the left and 24.2 -> 29.5 on the right.
 * Ours was a flat square 27x26 — the height was already Blender's and the
 * width was 5 device short, because a square cannot be as wide at its foot as
 * a trapezoid.
 *
 * The prior cut said so itself and stopped there, for the right reason: it
 * shared `border-all` with three flat-grid sites. The name is what was in the
 * way, so the name is what moved (`editorIcons.viewport.projection` is now
 * `viewport-projection`, carrying Font Awesome's `border-all` drawing as its
 * fallback, so a set without this key paints exactly what it painted before).
 * THE PRIOR CUT ALSO MIS-COUNTED IT as "four cells across": it is three, in
 * both axes — four rules bound three columns.
 *
 * Every constant below was seeded off that character map and then settled
 * against the cell's own half-coverage mask, the same instrument the wrench
 * and the hand use. Seeded 150, settled 7 of 374 reference ink px (the old
 * square: 316). No constant moved as much as one device pixel from its
 * reading, and the four rows moved by ONE SHARED half-pixel, which is the
 * cell's own centring rather than a fit.
 */
const perspectiveGrid = () => {
  const cx = 8.01; // the trapezoid's axis
  const yTop = 3.71; // its near and far rules
  const yBot = 12.38;
  const rows = [yTop, 5.78, 8.73, yBot]; // spacing opens toward the viewer
  const hOuterTop = 3.17; // half-widths at each end, outer pair and inner
  const hOuterBot = 5.4;
  const hInnerTop = 0.89;
  const hInnerBot = 1.86;
  const w = 0.74;
  /** A vertical's half-width at depth `y`, linear between the two ends. */
  const at = (h0, h1, y) => h0 + ((h1 - h0) * (y - yTop)) / (yBot - yTop);
  return (
    rows
      .map((y) => cap(cx - at(hOuterTop, hOuterBot, y), y, cx + at(hOuterTop, hOuterBot, y), y, w))
      .join('') +
    [
      [hOuterTop, hOuterBot],
      [hInnerTop, hInnerBot],
    ]
      .flatMap(([h0, h1]) => [-1, 1].map((s) => cap(cx + s * h0, yTop, cx + s * h1, yBot, w)))
      .join('')
  );
};
g('viewport-projection', perspectiveGrid());
/*
 * VIEW_ORTHO, the same toggle in an orthographic view: a flat square grid of three by three
 * cells, as wide as the perspective trapezoid (32 device px on `gizmo-select-box.png`'s
 * navigation capsule at 2x) and centred with it, its rules the trapezoid's weight.
 */
const orthographicGrid = () => {
  const lo = 2.61;
  const hi = 13.41;
  const w = 0.74;
  const at = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  return at.map((v) => cap(lo, v, hi, v, w) + cap(v, lo, v, hi, w)).join('');
};
g('viewport-orthographic', orthographicGrid());
g(
  'list',
  dot(3.2, 4.4, 1) +
    dot(3.2, 8, 1) +
    dot(3.2, 11.6, 1) +
    cap(6.2, 4.4, 13.2, 4.4, 1.15) +
    cap(6.2, 8, 13.2, 8, 1.15) +
    cap(6.2, 11.6, 13.2, 11.6, 1.15),
);

// -- scene objects: Blender's outliner glyphs ------------------------------
g(
  'camera',
  rrect(1.8, 5.2, 8.2, 6.6, 0.9) +
    poly([
      [10.4, 8.5],
      [14.2, 5.4],
      [14.2, 11.6],
    ]) +
    dot(3.9, 3.2, 1.25) +
    dot(7.3, 3.2, 1.25),
);
g(
  'camera-rotate',
  rrect(1.6, 4.4, 7.4, 6, 0.9) +
    poly([
      [9.4, 7.4],
      [12.8, 4.6],
      [12.8, 10.2],
    ]) +
    dot(3.5, 2.6, 1.15) +
    dot(6.6, 2.6, 1.15) +
    arc(10.4, 11.6, 2.7, 110, 400, 1.2) +
    poly([
      [8.4, 9.2],
      [10.4, 9.4],
      [8.8, 11.4],
    ]),
);
// The Light row in `outliner.png`: the bulb FILLS its 14px slot — a big head,
// a wide screw base, a foot. At the old 3.5 head it rendered ~7px of ink in a
// 14px row and read as a dim pebble beside its own label.
g(
  'lightbulb',
  dot(8, 5.7, 4.3) +
    rrect(5.7, 8.6, 4.6, 3.1, 0.5) +
    holeBar(5.9, 9.6, 10.1, 9.6, 0.7) +
    cap(6.2, 13.1, 9.8, 13.1, 1.5),
);
g(
  'sun',
  dot(8, 8, 2.9) +
    [0, 45, 90, 135, 180, 225, 270, 315]
      .map((a) => {
        const r = (a * Math.PI) / 180;
        return cap(
          8 + Math.cos(r) * 3,
          8 + Math.sin(r) * 3,
          8 + Math.cos(r) * 6,
          8 + Math.sin(r) * 6,
          1.5,
        );
      })
      .join(''),
);
g(
  'cloud-sun',
  dot(10.6, 4.4, 2.1) +
    [215, 270, 325, 20]
      .map((a) => {
        const r = (a * Math.PI) / 180;
        return cap(
          10.6 + Math.cos(r) * 3,
          4.4 + Math.sin(r) * 3,
          10.6 + Math.cos(r) * 4.4,
          4.4 + Math.sin(r) * 4.4,
          1.15,
        );
      })
      .join('') +
    dot(4.8, 10.2, 2.4) +
    dot(7.6, 9.4, 2.9) +
    dot(10, 10.8, 2) +
    rrect(3.8, 10.2, 7.6, 2.6, 1.2),
);
g(
  'globe',
  ring(8, 8, 5.3, 1.25) +
    cap(2.7, 8, 13.3, 8, 1.1) +
    ellipseArc(8, 8, 2.6, 5.3, 0, 360, 1.1, 0, true),
);
g(
  'person',
  dot(8, 3.4, 1.9) +
    cap(8, 5.6, 8, 9.6, 1.4) +
    cap(4.4, 6.8, 11.6, 6.8, 1.25) +
    cap(8, 9.4, 5.4, 13.4, 1.3) +
    cap(8, 9.4, 10.6, 13.4, 1.3),
);
g(
  'person-running',
  dot(10, 3.2, 1.8) +
    cap(10.4, 5.4, 7.2, 8.4, 1.5) +
    cap(7.2, 8.4, 8.8, 10.8, 1.4) +
    cap(8.8, 10.8, 8.4, 14, 1.4) +
    cap(7.2, 8.4, 3.4, 9.6, 1.35) +
    cap(3.4, 9.6, 2.8, 12.8, 1.3) +
    cap(10.6, 5.8, 13.6, 7.8, 1.3),
);
g(
  'person-falling',
  dot(11.8, 3.4, 1.8) +
    cap(10.8, 5.6, 6, 7.4, 1.5) +
    cap(6, 7.4, 2.4, 5.4, 1.35) +
    cap(6, 7.4, 7.6, 10.8, 1.4) +
    cap(7.6, 10.8, 4.6, 13.2, 1.35) +
    cap(7.6, 10.8, 12.4, 12, 1.35),
);
g(
  'bone',
  poly([
    [8, 1.6],
    [10.6, 5],
    [8, 8],
    [5.4, 5],
  ]) +
    line(
      [
        [8, 8],
        [10.6, 5],
        [8, 1.6],
        [5.4, 5],
        [8, 8],
        [8, 14.4],
      ],
      1.2,
    ) +
    line(
      [
        [10.6, 5],
        [8, 14.4],
        [5.4, 5],
      ],
      1.2,
    ) +
    dot(8, 14.4, 1.1),
);

// -- status ----------------------------------------------------------------
g('circle-info', dot(8, 8, 6) + dot(8, 4.4, 1.05, true) + holeBar(8, 6.6, 8, 11.6, 1.9));
g(
  'circle-check',
  dot(8, 8, 6) + holeBar(4.8, 8.1, 7, 10.4, 1.9) + holeBar(6.6, 10.4, 11.2, 5.5, 1.9),
);
g('circle-exclamation', dot(8, 8, 6) + holeBar(8, 4.2, 8, 9.4, 1.9) + dot(8, 11.5, 1.05, true));
g(
  'circle-xmark',
  dot(8, 8, 6) + holeBar(5.4, 5.4, 10.6, 10.6, 1.9) + holeBar(10.6, 5.4, 5.4, 10.6, 1.9),
);
g('circle-minus', dot(8, 8, 6) + holeBar(4.8, 8, 11.2, 8, 1.9));
g(
  'circle-play',
  dot(8, 8, 6) +
    holePoly([
      [6.2, 4.8],
      [11.4, 8],
      [6.2, 11.2],
    ]),
);
g('circle-half-stroke', ring(8, 8, 5.4, 1.2) + wedge(8, 8, 4.9, 90, 270));
g(
  'triangle-exclamation',
  poly([
    [8, 1.9],
    [15, 13.8],
    [1, 13.8],
  ]) +
    holeBar(8, 6.2, 8, 10, 1.9) +
    dot(8, 11.9, 1.05, true),
);
g(
  'spinner',
  [0, 45, 90, 135, 180, 225, 270, 315]
    .map((a, i) => {
      const r = (a * Math.PI) / 180;
      return dot(8 + Math.cos(r) * 5.1, 8 + Math.sin(r) * 5.1, 0.85 + i * 0.11);
    })
    .join(''),
);

// -- transport -------------------------------------------------------------
g(
  'play',
  poly([
    [4.4, 2.8],
    [13.2, 8],
    [4.4, 13.2],
  ]),
);
g('pause', rrect(4, 3, 3, 10, 0.4) + rrect(9, 3, 3, 10, 0.4));
g('stop', rrect(3.4, 3.4, 9.2, 9.2, 0.5));
g(
  'forward-step',
  poly([
    [3.6, 3.2],
    [11, 8],
    [3.6, 12.8],
  ]) + rrect(11.4, 3.2, 2.2, 9.6, 0.4),
);

// -- tools -----------------------------------------------------------------
g(
  'arrow-pointer',
  poly([
    [4.2, 1.9],
    [4.2, 12.4],
    [6.9, 9.9],
    [8.7, 14.1],
    [10.9, 13.1],
    [9.1, 9],
    [12.6, 8.6],
  ]),
);
// Blender's pan hand (`modeling-object-none.png`) is COMPACT: ~13 px of ink in
// the cluster's 16 px slot. Ours spanned 1.8..14.2, which the scale dial pushes
// to ~15 px rendered — a hand a full size larger than the zoom beside it.
g(
  'hand-pointer',
  // Blender's pan hand measures 15x15 in the cluster at matched scale — SQUARE.
  // Round 2's shrink left ours 18x20: right width, three pixels too tall,
  // because the middle finger still reached the top of the box.
  rrect(6.7, 3.9, 2.8, 5.8, 1.4) + rrect(4.9, 8, 8.2, 5.1, 2) + dot(5.2, 9.3, 1.3),
);
/**
 * THE PAN TOOL'S OWN GLYPH. `editorIcons.viewport.pan` is `faHand`, whose
 * iconName is `hand` — a name this set did not carry, so the navigation
 * cluster drew Font Awesome's hand and nothing else on the Model workspace
 * did (checked by resolving every `fa*` identifier in `packages/editor/src`
 * and `packages/mesh/contributions` to its `iconName` and differencing
 * against these keys: `hand` was the only genuine miss; `faExclamationTriangle`
 * and `faTimesCircle` are FA-5 aliases that resolve to `triangle-exclamation`
 * and `circle-xmark`, both present).
 *
 * RE-MEASURED 2026-09-19 against the capsule's SECOND CELL on
 * `modeling-edit-none.png` (device x 2774..2805, y 421..452 — the cluster's
 * cells are 32x32 device and this one's glyph FILLS it, 32x32 of ink). Ours
 * inked 28x27: "15x15 in a 16 px slot" was a reading of an earlier frame and
 * of the wrong pixels; Blender's pan hand is 16.0 x 16.0 CSS, the same box its
 * magnifier fills, which is the whole point — the cluster's glyphs are one
 * size. Three things were wrong besides the size and each is visible at 8x:
 * the fingers were PARALLEL and touching where Blender SPLAYS them with a
 * clear gap (the index leans right going down, the ring leans left, only the
 * middle is vertical); the thumb was a horizontal block at the palm's waist
 * where Blender's points LEFT and DOWN out of the palm's lower third; and the
 * palm was a flat-bottomed box where Blender's bottom is a wide dome. Together
 * they read as a mitten.
 *
 * FITTED THE WAY `modifierWrench` WAS: the structure read off the cell as a
 * character map first (four splayed finger capsules, a domed palm, a thumb),
 * then every constant settled by rendering at the reference's own scale and
 * counting the pixels where the two HALF-COVERAGE masks disagree. Seeded from
 * the map alone it scored 106 of 534 reference ink px against the old glyph's
 * 277; settled, 39, of which seven are the dome's last row. Every finger constant stayed within a device pixel of its
 * own reading. THE PALM'S DID NOT, and that is honest rather than hidden: an
 * axis-aligned rounded rect cannot be Blender's asymmetric dome (the thumb's
 * mass makes its bottom-left tighter than its bottom-right), so the fit moved
 * the palm 2 device px left to trade that error against the thumb's. The one
 * run of reference ink we do not cover is the dome's last row.
 *
 * THE INSTRUMENT, stated because it decides every number here: our render box
 * is the `2xl` rung, 18 CSS = 36 device, while Blender's cell is 32 — so a
 * comparison crops our 36 px raster to its central 32, and a glyph that FILLS
 * Blender's cell occupies only 32/36 of our own viewBox. Reading ours at a
 * loose coverage cut instead of half makes it measure a pixel wider than it
 * is, which is the trap the mesh-data glyph's note already records.
 */
g(
  'hand',
  // Four fingers, each a capsule from its own cap centre down into the palm.
  cap(5.81, 3.63, 6.4, 8.76, 1.33) + // index, leaning right going down
    cap(8.73, 2.9, 8.73, 8.36, 1.33) + // middle — the tallest, and the only vertical one
    cap(11.64, 3.63, 10.81, 7.96, 1.33) + // ring, leaning the other way
    cap(13.28, 6.34, 12.34, 8.76, 1.33) + // pinky, starting well below the rest
    rrect(4.65, 7.6, 7.62, 5.83, 2.95) + // the palm
    cap(3.3, 8.99, 5.38, 10.82, 2.0), // the thumb, out of the palm's lower third
);
g(
  /**
   * The MOVE tool. Blender's (`modeling-edit-none.png`, tool shelf) is four
   * SOLID arrowheads standing apart on short stubs around an empty centre —
   * not a crosshair. Ours was one continuous 1.2-unit cross with 1.15-unit
   * chevrons on its ends, which at matched scale is a thin plus sign with
   * ticks: a different mark, and the lightest thing on the rail.
   *
   * RE-MEASURED 2026-09-19 off the same frame, this time as an ASCII map in
   * AUTHORED units (0.5/char) rather than by eye: the previous fit was RIGHT
   * IN FORM AND WRONG IN SIZE AND PARTS. Ours inked 35x34 device px against
   * Blender's 46x46 — 74% — because the heads stopped at radius 6.4 where
   * Blender's tips reach the box edge (radius 8, base at 5.5, half-width
   * 2.4); the STUBS were missing entirely (a 1.0-unit bar from radius 2.5 to
   * 4.6 under each head); and a 1.35 centre dot was drawn where Blender's
   * centre is empty. Size is not a detail on this rail — the same frame's
   * inset and bevel marks ink 40x40 and ours match them to a pixel, so the
   * transform group was the odd one out in its own column.
   */
  'up-down-left-right',
  [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]
    .map(
      ([dx, dy]) =>
        poly([
          [8 + dx * 5.4 - dy * 2.45, 8 + dy * 5.4 + dx * 2.45],
          [8 + dx * 5.4 + dy * 2.45, 8 + dy * 5.4 - dx * 2.45],
          [8 + dx * 8.4, 8 + dy * 8.4],
        ]) + cap(8 + dx * 2.6, 8 + dy * 2.6, 8 + dx * 5.05, 8 + dy * 5.05, 0.96),
    )
    .join(''),
);
g('arrows-up-down-left-right', glyphs['up-down-left-right'].path);
g(
  /**
   * The ROTATE tool. Blender draws a heavy arc with a SOLID arrowhead at each
   * end and a solid diamond at the pivot; ours was a 1.3-unit open circle with
   * one small tick, which at matched scale is an empty ring — the pivot, the
   * direction and the weight all missing.
   *
   * RE-MEASURED 2026-09-19 (ASCII map in authored units, and the cell read at
   * 8x): it is TWO arcs, not one — the top arc ends at the LEFT in a
   * DOWN-pointing triangle and the bottom arc ends at the RIGHT in an
   * UP-pointing one, the ordinary two-headed circular arrow, where the
   * previous fit drew one dome with both heads under its ends and no bottom
   * arc at all. And it was 72% of Blender's size (33x29 device against
   * 46x38): the ring's radius is 6.5 of the 16 box, not 4.3.
   */
  'rotate',
  arc(8, 7.8, 7.0, 200, 336, 0.8) +
    arc(8, 7.8, 7.0, 20, 156, 0.8) +
    // The head SITS ON the arc's end and points across it, so the two read as
    // one stroke that turns into a point rather than as an arc with a dart
    // beside it.
    poly([
      [0, 6.7],
      [3.3, 6.7],
      [1.65, 9.9],
    ]) +
    poly([
      [12.6, 9.3],
      [15.9, 9.3],
      [14.25, 6.1],
    ]) +
    poly([
      [7.75, 4.9],
      [10.05, 7.65],
      [7.75, 10.4],
      [5.45, 7.65],
    ]),
);
g(
  'rotate-left',
  arc(8, 8, 5, 240, -60, 1.3) +
    poly([
      [5.4, 1.6],
      [2.4, 4.8],
      [6.6, 5.8],
    ]),
);
g(
  'rotate-right',
  arc(8, 8, 5, -60, 240, 1.3) +
    poly([
      [10.6, 1.6],
      [13.6, 4.8],
      [9.4, 5.8],
    ]),
);
g(
  'arrows-rotate',
  arc(8, 8, 5, 150, 330, 1.25) +
    arc(8, 8, 5, -30, 150, 1.25) +
    poly([
      [11.2, 1.8],
      [13.8, 5.4],
      [9.6, 5.6],
    ]) +
    poly([
      [4.8, 14.2],
      [2.2, 10.6],
      [6.4, 10.4],
    ]),
);
g(
  'crosshairs',
  ring(8, 8, 4.2, 1.2) +
    cap(8, 1.6, 8, 5, 1.2) +
    cap(8, 11, 8, 14.4, 1.2) +
    cap(1.6, 8, 5, 8, 1.2) +
    cap(11, 8, 14.4, 8, 1.2),
);
g('bullseye', ring(8, 8, 5.4, 1.2) + ring(8, 8, 2.9, 1.2) + dot(8, 8, 1.2));
g(
  'arrows-to-dot',
  dot(8, 8, 1.4) +
    cap(8, 1.8, 8, 4.4, 1.2) +
    cap(8, 11.6, 8, 14.2, 1.2) +
    cap(1.8, 8, 4.4, 8, 1.2) +
    cap(11.6, 8, 14.2, 8, 1.2) +
    line(
      [
        [6.6, 3.2],
        [8, 4.6],
        [9.4, 3.2],
      ],
      1.1,
    ) +
    line(
      [
        [6.6, 12.8],
        [8, 11.4],
        [9.4, 12.8],
      ],
      1.1,
    ) +
    line(
      [
        [3.2, 6.6],
        [4.6, 8],
        [3.2, 9.4],
      ],
      1.1,
    ) +
    line(
      [
        [12.8, 6.6],
        [11.4, 8],
        [12.8, 9.4],
      ],
      1.1,
    ),
);

/**
 * THE OTHER TWO TOOLS OF BLENDER'S TRANSFORM GROUP, under names of ours.
 *
 * Move and Rotate above are shared Font Awesome names (`up-down-left-right`,
 * `rotate`) and their Blender drawings say the same thing everywhere they
 * appear, so those stay keyed to the shared name. Scale and Transform do not:
 * the host's Scale tool asked for `maximize` (Font Awesome's window-expand
 * cross) and its Transform tool for `arrows-to-dot` (a crosshair), and
 * Blender's marks for the two — a small square growing into a bigger one, and
 * a square inside a broken ring of arrows — are meaningless under those
 * generic meanings. Same reasoning as `editorIcons.modeling`'s `mesh-*`:
 * a glyph that IS an operation needs its own name or it recuts every other
 * site that asked for the generic one.
 */
g(
  /**
   * SCALE. Measured on `modeling-edit-none.png` (button 5) as an ASCII map in
   * authored units: a 1-unit square OUTLINE from (2.0, 1.5) to (14.0, 13.5),
   * a SOLID square from (1.5, 7.5) to (8.0, 14.0) overlapping its lower-left
   * corner, and a diagonal arrow inside the frame running up-and-right from
   * (8.6, 6.9) to a head whose apex is (12.4, 3.1).
   */
  'tool-scale',
  rframe(2, 1.5, 12, 12, 0.8) +
    rrect(1.5, 7.6, 6.3, 6.3, 0.2) +
    cap(8.6, 6.9, 10.7, 4.8, 0.95) +
    poly([
      [12.4, 3.1],
      [11.5, 6.2],
      [9.3, 4],
    ]),
);
/*
 * SELECT BOX. Measured on `gizmo-select-box.png` (the lit first button, native 2x) and mapped onto
 * the 16-unit grid with the marquee spanning 1..15: a dashed square, 0.7 units thick, dashes about
 * 2.3 units with 1.1-unit gaps and an L at each corner, in the selection tools' orange (the
 * `select` tone, `tonedPath`); inside it a pointer from its tip (6.1, 4.5) down to (6.2, 11.5),
 * notched at (8.2, 9.4), to (11.2, 9.4).
 */
const MARQUEE_T = 0.7;
const marquee =
  // corners: an L each
  rrect(1, 1, 2.7, MARQUEE_T) + rrect(1, 1, MARQUEE_T, 2.5) +
  rrect(12.3, 1, 2.7, MARQUEE_T) + rrect(14.3, 1, MARQUEE_T, 2.4) +
  rrect(1, 14.3, 2.5, MARQUEE_T) + rrect(1, 12.4, MARQUEE_T, 2.6) +
  rrect(12.3, 14.3, 2.7, MARQUEE_T) + rrect(14.3, 12.4, MARQUEE_T, 2.6) +
  // the dashes between
  rrect(5, 1, 2.2, MARQUEE_T) + rrect(8.4, 1, 2.3, MARQUEE_T) +
  rrect(5.5, 14.3, 2.4, MARQUEE_T) + rrect(9, 14.3, 2.4, MARQUEE_T) +
  rrect(1, 4.6, MARQUEE_T, 2.1) + rrect(1, 8, MARQUEE_T, 2.1) +
  rrect(14.3, 4.6, MARQUEE_T, 2.1) + rrect(14.3, 8, MARQUEE_T, 2.1);
g(
  'tool-select-box',
  poly([
    [6.1, 4.5],
    [11.2, 9.4],
    [8.2, 9.4],
    [6.2, 11.5],
  ]),
  { tone: 'select', tonedPath: marquee },
);
g(
  /**
   * TRANSFORM (all handles). Blender's (button 6): a solid square from
   * (5.0, 5.0) to (10.5, 10.5), four solid arrowheads whose tips touch the
   * box edge with bases 3.0 units in and half-width 1.6, and FOUR ARCS on a
   * radius-7.0 circle filling the 50° between one head and the next — the
   * ring is what says "all of them at once", and it is why this is not the
   * Move mark with a box in it.
   */
  'tool-transform',
  rrect(5.15, 5.15, 5.7, 5.7, 0.25) +
    [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]
      .map(([dx, dy]) =>
        poly([
          [8 + dx * 5.4 - dy * 1.7, 8 + dy * 5.4 + dx * 1.7],
          [8 + dx * 5.4 + dy * 1.7, 8 + dy * 5.4 - dx * 1.7],
          [8 + dx * 7.9, 8 + dy * 7.9],
        ]),
      )
      .join('') +
    [20, 110, 200, 290].map((a) => arc(8, 8, 7.1, a, a + 48, 0.92)).join(''),
);
g(
  'magnet',
  arc(8, 7.6, 4.7, 180, 360, 1.5) +
    cap(3.3, 7.6, 3.3, 11.4, 1.5) +
    cap(12.7, 7.6, 12.7, 11.4, 1.5) +
    cap(1.9, 12.6, 4.7, 12.6, 1.7) +
    cap(11.3, 12.6, 14.1, 12.6, 1.7),
);
g(
  'expand',
  line(
    [
      [6.2, 2.4],
      [2.4, 2.4],
      [2.4, 6.2],
    ],
    1.3,
  ) +
    line(
      [
        [9.8, 2.4],
        [13.6, 2.4],
        [13.6, 6.2],
      ],
      1.3,
    ) +
    line(
      [
        [6.2, 13.6],
        [2.4, 13.6],
        [2.4, 9.8],
      ],
      1.3,
    ) +
    line(
      [
        [9.8, 13.6],
        [13.6, 13.6],
        [13.6, 9.8],
      ],
      1.3,
    ),
);
g(
  'compress',
  line(
    [
      [2.4, 6.2],
      [6.2, 6.2],
      [6.2, 2.4],
    ],
    1.3,
  ) +
    line(
      [
        [13.6, 6.2],
        [9.8, 6.2],
        [9.8, 2.4],
      ],
      1.3,
    ) +
    line(
      [
        [2.4, 9.8],
        [6.2, 9.8],
        [6.2, 13.6],
      ],
      1.3,
    ) +
    line(
      [
        [13.6, 9.8],
        [9.8, 9.8],
        [9.8, 13.6],
      ],
      1.3,
    ),
);
g('maximize', glyphs['expand'].path);
g(
  'up-right-and-down-left-from-center',
  cap(3.2, 12.8, 12.8, 3.2, 1.25) +
    line(
      [
        [9, 2.6],
        [13.4, 2.6],
        [13.4, 7],
      ],
      1.25,
    ) +
    line(
      [
        [7, 13.4],
        [2.6, 13.4],
        [2.6, 9],
      ],
      1.25,
    ),
);
g('window-minimize', cap(3, 11.4, 13, 11.4, 1.4));
g(
  'window-restore',
  rframe(2.2, 5.4, 8.4, 8.4, 1.2, 0.5) +
    line(
      [
        [5.8, 5],
        [5.8, 2.4],
        [13.8, 2.4],
        [13.8, 10.2],
        [11.2, 10.2],
      ],
      1.2,
    ),
);

// -- modeling operators ----------------------------------------------------
g(
  'arrow-up-from-bracket',
  cap(8, 2.4, 8, 10, 1.35) +
    line(
      [
        [4.8, 5.4],
        [8, 2.2],
        [11.2, 5.4],
      ],
      1.3,
    ) +
    line(
      [
        [3, 9.6],
        [3, 13.6],
        [13, 13.6],
        [13, 9.6],
      ],
      1.25,
    ),
);
g(
  'border-top-left',
  line(
    [
      [2.4, 13.6],
      [2.4, 2.4],
      [13.6, 2.4],
    ],
    1.5,
  ) +
    dot(6.6, 9.4, 0.95) +
    dot(9.4, 6.6, 0.95) +
    dot(9.4, 9.4, 0.95) +
    dot(12.9, 9.4, 0.95) +
    dot(9.4, 12.9, 0.95) +
    dot(12.9, 12.9, 0.95),
);
g(
  'scissors',
  ring(4.1, 12, 1.9, 1.15) +
    ring(11.9, 12, 1.9, 1.15) +
    cap(3.4, 2.2, 10.9, 10.4, 1.25) +
    cap(12.6, 2.2, 5.1, 10.4, 1.25),
);
g(
  'hammer',
  cap(3, 13.8, 9, 7.2, 1.9) +
    poly([
      [7.6, 5.8],
      [10.4, 2.2],
      [14.2, 5.2],
      [11.4, 8.8],
    ]),
);
g(
  /**
   * The Properties TOOL tab. Blender's (`properties-object.png`, top of the
   * tab rail, 14x14 at matched scale) is two tools standing UPRIGHT side by
   * side — a screwdriver and an open-end wrench, both solid. Ours was one
   * diagonal shaft with a ring at one end and a wedge at the other: at 14px it
   * reads as a single key, and the ring is an outline that greys out.
   */
  'screwdriver-wrench',
  // screwdriver: blade, collar, handle
  rrect(3.5, 2.6, 1.4, 4.6, 0.3) +
    rrect(2.9, 7.2, 2.6, 1.2, 0.3) +
    rrect(3.1, 8.4, 2.2, 5, 0.8) +
    // wrench: a forked head over a shaft. The fork must be WIDE enough to
    // survive 14px — at 1.7 units it closed up and the head read as a block.
    rrect(9.6, 6.6, 2.8, 6.8, 0.9) +
    rrect(8.4, 2.6, 5.2, 4.6, 0.5) +
    holeBar(11, 2, 11, 4.9, 2.2),
);
g('puzzle-piece', rrect(2.6, 2.6, 10.8, 10.8, 1) + dot(13.6, 6.5, 1.9) + dot(8, 2.6, 1.9, true));
g(
  'sliders',
  cap(2.4, 4.4, 13.6, 4.4, 1.2) +
    cap(2.4, 8, 13.6, 8, 1.2) +
    cap(2.4, 11.6, 13.6, 11.6, 1.2) +
    dot(5.4, 4.4, 1.6) +
    dot(10.4, 8, 1.6) +
    dot(6.6, 11.6, 1.6),
);
g(
  'pen-ruler',
  cap(3, 13, 10.6, 5.4, 2.1) +
    poly([
      [1.2, 14.8],
      [2.9, 10.8],
      [5.2, 13.1],
    ]) +
    poly([
      [10.2, 4.6],
      [12.2, 2.6],
      [13.4, 3.8],
      [11.4, 5.8],
    ]) +
    cap(11.6, 2, 14, 4.4, 1.6),
);
g(
  /**
   * The MATERIAL section's mark (`inspection/compose.ts` maps /material/ here).
   * Blender's Material tab is a SOLID disc with quadrants knocked out of it;
   * ours was a 1.3-unit outline with three dots inside, and at the 14px rail
   * the outline greyed and the dots merged — it read as a cookie. Same
   * palette silhouette, drawn Blender's way: one filled blob, wells and thumb
   * hole punched THROUGH it.
   */
  'palette',
  // One blob with the wells and the thumb hole punched THROUGH it. Round 3
  // grew a handle off the bottom to sell the palette's notch and the glyph came
  // back a mushroom; Blender's Material tab is a compact rounded mass and this
  // matches that silhouette.
  poly(
    Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      return [8 + Math.cos(a) * 6, 8.2 + Math.sin(a) * 5.4];
    }),
  ) +
    dot(5.2, 6, 1.3, true) +
    dot(8.4, 4.9, 1.3, true) +
    dot(11.3, 6.6, 1.3, true) +
    dot(10.4, 10.7, 2, true),
);
g(
  // A stack of plates: the top one SOLID (the silhouette that carries the
  // glyph at a 14px row), the two beneath it strokes that read as its shadow.
  // Drawn as three outlines it was three grey lozenges with nothing solid in
  // any of them — the same failure the Collection box had.
  'layer-group',
  poly([
    [8, 2],
    [14.2, 5.3],
    [8, 8.6],
    [1.8, 5.3],
  ]) +
    line(
      [
        [2.6, 8.1],
        [8, 10.9],
        [13.4, 8.1],
      ],
      1.35,
    ) +
    line(
      [
        [2.6, 11],
        [8, 13.8],
        [13.4, 11],
      ],
      1.35,
    ),
);
g(
  // The GROUP row's mark. Beside Blender's Collection box in `outliner.png` at
  // matched scale, a 1.1-unit frame with four nubs was indistinguishable from
  // the letterforms of its own label — same weight, same grey. Blender's is a
  // solid box: a filled band for the frame, and solid corner handles.
  'object-group',
  rframe(2.4, 3.8, 11.2, 8.4, 2.1, 0.3) +
    rrect(0.6, 2, 3.1, 3.1, 0.3) +
    rrect(12.3, 2, 3.1, 3.1, 0.3) +
    rrect(0.6, 10.9, 3.1, 3.1, 0.3) +
    rrect(12.3, 10.9, 3.1, 3.1, 0.3),
);

// -- the mesh operators: THE OPERATION, ON A CUBE ---------------------------
/**
 * `editorIcons.modeling.*` asks for `mesh-*` (see that file's header), so these
 * six are free to be what Blender's toolbar draws: not an abstraction of the
 * verb (an up-arrow for Extrude, scissors for Knife) but THE OPERATION PERFORMED
 * ON A CUBE — a cube with one face pulled out, a cube with an inset face, a cube
 * with a chamfered edge, a cube with a cut running round it. Measured in
 * `modeling-edit-none.png` (2x, halved): each glyph inks ~20x20 CSS px in a
 * 38x34 button (Extrude 20x23 — its lifted slab is taller), the cube is a
 * ~2 px wire with the operated element FILLED, and the cube sits in three-quarter
 * view: a front square with a top and a right face receding up-and-right.
 *
 * MONOCHROME, which is this set's contract (`blender.style.ts`) and a real
 * difference from the reference: Blender tints the operated element (green for
 * these six, purple for Smooth) and reads the operation by COLOUR as much as by
 * shape. Here the same job is done by FILL — the operated face is solid against
 * the wire — and whether the set gains an accent channel is its own decision,
 * not one to smuggle in through six glyphs.
 */

/**
 * THE OPERATOR CUBE, once. `P(u, v, k)` is a point in the cube's own axes: `u`
 * across the front face, `v` up it, `k` back along the depth the top and right
 * faces recede along. Every one of the six is authored in those three, so the
 * cube can be re-measured in one place and all six follow.
 *
 * It fills the 16 grid corner to corner (~14 units of extent), because the
 * toolbar's glyph is the biggest in the chrome: that is the ~20 CSS px of ink
 * Blender's 38x34 button carries, once the file's `S` dial is applied.
 */
const CUBE = { x0: 1.1, x1: 10.9, yb: 14.9, yt: 5.1, dx: 3.9, dy: -3.9 };
const P = (u, v, k = 0) => [
  CUBE.x0 + (CUBE.x1 - CUBE.x0) * u + CUBE.dx * k,
  CUBE.yb + (CUBE.yt - CUBE.yb) * v + CUBE.dy * k,
];

/**
 * The cube as WIRE — the nine edges a cube shows from here, named so an
 * operator can drop the one it replaces (Bevel replaces the top-front edge,
 * Extrude takes the whole top away with the face it pulled out). `top` is the
 * v the box stops at, so Extrude's body can be shorter than the others' and
 * still leave the glyph the same total ink.
 */
function cubeWire({ top = 1, w = 1.15, omit = [], u0 = 0, u1 = 1 } = {}) {
  const edges = {
    frontBottom: [P(u0, 0), P(u1, 0)],
    frontRight: [P(u1, 0), P(u1, top)],
    frontTop: [P(u0, top), P(u1, top)],
    frontLeft: [P(u0, 0), P(u0, top)],
    topLeft: [P(u0, top), P(u0, top, 1)],
    topBack: [P(u0, top, 1), P(u1, top, 1)],
    rightBack: [P(u1, top, 1), P(u1, 0, 1)],
    rightBottom: [P(u1, 0), P(u1, 0, 1)],
    seam: [P(u1, top), P(u1, top, 1)],
  };
  return Object.entries(edges)
    .filter(([name]) => !omit.includes(name))
    .map(([, [a, b]]) => cap(a[0], a[1], b[0], b[1], w))
    .join('');
}

/** A SOLID slab between two v levels — the piece an operation adds: its top
 *  face, the band down its front, the band down its right. */
function slab(vLow, vHigh) {
  return (
    poly([P(0, vHigh), P(1, vHigh), P(1, vHigh, 1), P(0, vHigh, 1)]) +
    poly([P(0, vLow), P(1, vLow), P(1, vHigh), P(0, vHigh)]) +
    poly([P(1, vLow), P(1, vHigh), P(1, vHigh, 1), P(1, vLow, 1)])
  );
}

/** EXTRUDE — the top face PULLED OUT: the cube left open at the top, and the
 *  face floating above it as a solid slab with its own three faces. */
g(
  'mesh-extrude',
  // The body is OPEN at the top — it lost that face, and Blender's glyph says
  // so by letting the verticals run up and vanish behind the slab rather than
  // closing a rim under it (round 2 closed the rim and the pair read as a
  // crate with a lid; round 1 stopped the verticals short and read as a
  // bracket). So: full-height verticals to the slab's underside, no top rim.
  cubeWire({ top: 0.74, omit: ['frontTop', 'topLeft', 'topBack', 'seam'] }),
  { tone: 'operator', tonedPath: slab(0.74, 1) },
);

/** INSET — the front face INSET: the rim it leaves is solid, the smaller face
 *  inside it is knocked back out, and the four WALLS between them are knocked
 *  apart by their own seams. Blender's inset glyph is that funnel — four
 *  trapezoids converging on a small dark square — and round 4's flat frame
 *  (no seams) read as a picture frame instead of a recess. */
g('mesh-inset', cubeWire(), {
  tone: 'operator',
  tonedPath:
    poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)]) +
    holePoly([P(0.3, 0.3), P(0.7, 0.3), P(0.7, 0.7), P(0.3, 0.7)]) +
    holeBar(...P(0, 0), ...P(0.3, 0.3), 0.7) +
    holeBar(...P(1, 0), ...P(0.7, 0.3), 0.7) +
    holeBar(...P(1, 1), ...P(0.7, 0.7), 0.7) +
    holeBar(...P(0, 1), ...P(0.3, 0.7), 0.7),
});

/** BEVEL — one edge CHAMFERED. RE-READ at 8x against the reference: the edge
 *  Blender cuts is the TOP-RIGHT one (the seam between the top face and the
 *  right face), and the glyph shows the top face solid with a second facet
 *  flapping off it along that seam, a hairline of background between the two.
 *  Rounds 2-4 chamfered the top-FRONT edge and the result read as a solid top,
 *  which is Extrude's answer, not Bevel's. */
g('mesh-bevel', cubeWire({ omit: ['seam'] }), {
  tone: 'operator',
  tonedPath:
    poly([P(0, 1), P(0.56, 1), P(0.56, 1, 1), P(0, 1, 1)]) +
    poly([P(0.56, 1), P(1, 0.56), P(1, 0.56, 1), P(0.56, 1, 1)]) +
    holeBar(...P(0.56, 1), ...P(0.56, 1, 1), 0.7),
});

/** LOOP CUT — the cube CUT IN TWO. Blender's glyph is not a stripe on a cube:
 *  it is two half-boxes standing apart with the cut itself, a solid bar, in the
 *  gap between them, so the new edge loop is the subject. Round 4 drew a line
 *  across an intact cube and read as decoration on the face. */
g('mesh-loop-cut', cubeWire(), {
  tone: 'operator',
  tonedPath:
    poly([P(0.44, 0), P(0.56, 0), P(0.56, 1), P(0.44, 1)]) +
    poly([P(0.44, 1), P(0.56, 1), P(0.56, 1, 1), P(0.44, 1, 1)]),
});

/** KNIFE — a cut drawn ACROSS a face rather than round the cube: a stroke that
 *  turns at a vertex, its ends pinned by the points a knife sets. */
g('mesh-knife', cubeWire(), {
  tone: 'operator',
  // A RISING cut with its turn on the front face and its far end up on the
  // top face. Round 1 fell to the right and read as a droop.
  tonedPath:
    line([P(0.16, 0.06), P(0.52, 0.72), P(0.78, 1, 0.5)], 1.5) +
    dot(...P(0.16, 0.06), 1.45) +
    dot(...P(0.52, 0.72), 1.15) +
    dot(...P(0.78, 1, 0.5), 1.45),
});

/** SUBDIVIDE — the cube GRIDDED: every visible face cut once each way, in a
 *  lighter stroke than the cube's own edges so the cut reads as new geometry
 *  rather than as the silhouette. */
g('mesh-subdivide', cubeWire(), {
  tone: 'operator',
  tonedPath:
    // front face
    cap(...P(0.5, 0), ...P(0.5, 1), 1.05) +
    cap(...P(0, 0.5), ...P(1, 0.5), 1.05) +
    // top face
    cap(...P(0.5, 1), ...P(0.5, 1, 1), 1.05) +
    cap(...P(0, 1, 0.5), ...P(1, 1, 0.5), 1.05) +
    // right face
    cap(...P(1, 0.5), ...P(1, 0.5, 1), 1.05) +
    cap(...P(1, 0, 0.5), ...P(1, 1, 0.5), 1.05),
});

/** SMOOTH — not an operation on the operator CUBE: Blender draws this one (and
 *  only this one of the shelf's marks) on a BALL, because smoothing is what
 *  turns the cage into one. Measured on `modeling-edit-none.png` (button 17)
 *  as an ASCII map in authored units: a faceted sphere ~6.3 units of radius
 *  centred at (8.2, 6.6), its quads separated by seams KNOCKED OUT of the
 *  fill — an equator across the full width, two meridians, and a latitude
 *  seam near the top. The seams are holes, not strokes: drawn as strokes over
 *  the ball they would be the same ink as the ball and vanish. */
g(
  'mesh-smooth',
  poly(
    // ELEVEN vertices, not a smooth circle: Blender's silhouette is faceted
    // and that is half of what says "quads" before the seams are read.
    Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2 + 0.34;
      return [7.8 + Math.cos(a) * 7.1, 6.4 + Math.sin(a) * 7.1];
    }),
  ) +
    // equator, meridians, and the top latitude — each a bar-shaped hole.
    holeBar(0.8, 7.6, 15, 7.6, 0.62) +
    // The meridians and the top latitude BOW, two segments each — a sphere's
    // seams are not straight, and drawn straight the ball read as a beach
    // ball with a grid printed on it rather than as faceted geometry.
    holeBar(6.9, -0.7, 5.9, 6.4, 0.52) +
    holeBar(5.9, 6.4, 6.7, 13.5, 0.52) +
    holeBar(12.7, 1.1, 12.2, 6.4, 0.48) +
    holeBar(12.2, 6.4, 11.5, 11.7, 0.48) +
    holeBar(2.2, 3.5, 8, 1.8, 0.48) +
    holeBar(8, 1.8, 13.8, 3.3, 0.48),
  { tone: 'operator' },
);

/** SHRINK/FATTEN — the selection moved ALONG ITS NORMALS, in either direction,
 *  which is why Blender's mark (button 19) carries eight arrowheads: four
 *  outside the cube pointing out and four inside pointing in. The cube here is
 *  a pair of offset squares rather than the operator CUBE's three-quarter box
 *  — measured, the front square is (3.5, 3.5)-(12, 11) and the back one is
 *  offset up-and-right by 1.2 — because the arrows need the box read from the
 *  front to be legible through it. */
g(
  'mesh-shrink-fatten',
  // The BOX, front square plus the two BACK edges the front does not hide
  // (drawing the whole back frame adds two interior lines Blender has not
  // got) and the three short connectors between them.
  rframe(3.5, 3.5, 8.5, 7.5, 0.8) +
    line(
      [
        [5, 2.5],
        [13.5, 2.5],
        [13.5, 10.5],
      ],
      0.7,
    ) +
    cap(3.5, 3.5, 5, 2.5, 0.7) +
    cap(12, 3.5, 13.5, 2.5, 0.7) +
    cap(12, 11, 13.5, 10.5, 0.7),
  {
    tone: 'operator',
    // FOUR OUT and FOUR IN, about the mark's own centre (8, 7) — the box sits
    // a little high in the box because the outer heads need the room.
    tonedPath: [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]
      .map(
        ([dx, dy]) =>
          poly([
            [8 + dx * 6.3 - dy * 1.85, 7 + dy * 6.3 + dx * 1.85],
            [8 + dx * 6.3 + dy * 1.85, 7 + dy * 6.3 - dx * 1.85],
            [8 + dx * 8.3, 7 + dy * 8.3],
          ]) +
          poly([
            [8 + dx * 3 - dy * 1.5, 7 + dy * 3 + dx * 1.5],
            [8 + dx * 3 + dy * 1.5, 7 + dy * 3 - dx * 1.5],
            [8 + dx * 0.9, 7 + dy * 0.9],
          ]),
      )
      .join(''),
  },
);

// -- panels / apps ---------------------------------------------------------
g(
  'book-open',
  cap(8, 4.2, 8, 13.2, 1.2) +
    line(
      [
        [8, 4.2],
        [5.2, 2.6],
        [1.8, 2.6],
        [1.8, 11.6],
        [5.2, 11.6],
        [8, 13.2],
      ],
      1.2,
    ) +
    line(
      [
        [8, 4.2],
        [10.8, 2.6],
        [14.2, 2.6],
        [14.2, 11.6],
        [10.8, 11.6],
        [8, 13.2],
      ],
      1.2,
    ),
);
g(
  'book-bookmark',
  line(
    [
      [3.6, 2.2],
      [12.6, 2.2],
      [12.6, 13.8],
      [3.6, 13.8],
    ],
    1.2,
    true,
  ) +
    cap(5.8, 2.8, 5.8, 13.2, 1.1) +
    poly([
      [8.4, 2.8],
      [10.8, 2.8],
      [10.8, 7.8],
      [9.6, 6.6],
      [8.4, 7.8],
    ]),
);
g(
  'graduation-cap',
  poly([
    [8, 2.4],
    [15, 5.8],
    [8, 9.2],
    [1, 5.8],
  ]) +
    line(
      [
        [4.2, 7.4],
        [4.2, 11.6],
      ],
      1.2,
    ) +
    line(
      [
        [11.8, 7.4],
        [11.8, 11.6],
      ],
      1.2,
    ) +
    arc(8, 9.6, 3.9, 10, 170, 1.2),
);
g(
  'chart-simple',
  rrect(2.4, 9, 2.6, 4.8, 0.4) + rrect(6.7, 5.4, 2.6, 8.4, 0.4) + rrect(11, 2.4, 2.6, 11.4, 0.4),
);
g(
  'diagram-project',
  rframe(1.8, 2.2, 5.2, 3.8, 1.15, 0.3) +
    rframe(9, 10, 5.2, 3.8, 1.15, 0.3) +
    line(
      [
        [4.4, 6.4],
        [4.4, 11.9],
        [8.6, 11.9],
      ],
      1.15,
    ),
);
g(
  'circle-nodes',
  ring(3.6, 11.6, 1.9, 1.15) +
    ring(12.4, 12, 1.9, 1.15) +
    ring(9.2, 3.8, 1.9, 1.15) +
    cap(4.9, 10.3, 8.2, 5.4, 1) +
    cap(5.5, 11.8, 10.5, 11.9, 1) +
    cap(10.6, 5.4, 11.8, 10.2, 1),
);
g(
  'database',
  ellipseArc(8, 4.4, 5.2, 2.2, 0, 360, 1.15, 0, true) +
    cap(2.8, 4.4, 2.8, 11.6, 1.15) +
    cap(13.2, 4.4, 13.2, 11.6, 1.15) +
    ellipseArc(8, 11.6, 5.2, 2.2, 0, 180, 1.15) +
    ellipseArc(8, 8, 5.2, 2.2, 10, 170, 1.05),
);
g(
  'desktop',
  rframe(1.8, 2.6, 12.4, 8.6, 1.2, 0.5) +
    cap(5.4, 13.6, 10.6, 13.6, 1.2) +
    cap(8, 11.4, 8, 13.4, 1.2),
);
g(
  'mobile-screen-button',
  rframe(4.2, 1.6, 7.6, 12.8, 1.2, 1) + dot(8, 12.4, 0.8) + cap(6.4, 3.6, 9.6, 3.6, 1),
);
g(
  'users',
  dot(5.4, 5, 2.5) +
    arc(5.4, 12.6, 4.4, 180, 360, 1.25) +
    arc(11.4, 5.4, 2.1, 250, 470, 1.15) +
    arc(11.6, 12, 3.6, 200, 340, 1.2),
);
g(
  'circle-user',
  dot(8, 8, 6) +
    dot(8, 6, 2.1, true) +
    holePoly([
      [4.2, 13.3],
      [5, 11.2],
      [11, 11.2],
      [11.8, 13.3],
    ]),
);
g(
  'thumbtack',
  cap(8, 9.4, 8, 14, 1.2) +
    poly([
      [5, 2.2],
      [11, 2.2],
      [10, 4],
      [10.6, 7.2],
      [12.2, 9],
      [3.8, 9],
      [5.4, 7.2],
      [6, 4],
    ]),
);
g(
  'link',
  arc(5.6, 10.4, 3, 45, 315, 1.35) +
    arc(10.4, 5.6, 3, 225, 495, 1.35) +
    cap(5.8, 10.2, 10.2, 5.8, 1.35),
);
g(
  'code-branch',
  ring(4.4, 3.6, 1.8, 1.2) +
    ring(4.4, 12.4, 1.8, 1.2) +
    ring(11.6, 5.6, 1.8, 1.2) +
    cap(4.4, 5.4, 4.4, 10.6, 1.15) +
    line(
      [
        [11.6, 7.4],
        [11.6, 9],
        [4.4, 9],
      ],
      1.15,
    ),
);
g(
  'hashtag',
  cap(5.8, 2.4, 4.4, 13.6, 1.2) +
    cap(11.2, 2.4, 9.8, 13.6, 1.2) +
    cap(2.6, 5.6, 13.4, 5.6, 1.2) +
    cap(2.2, 10.4, 13, 10.4, 1.2),
);
g(
  'font',
  line(
    [
      [3, 13.4],
      [8, 2.4],
      [13, 13.4],
    ],
    1.3,
  ) + cap(5.2, 9.4, 10.8, 9.4, 1.2),
);
g(
  'tags',
  poly([
    [1.6, 8.2],
    [7.4, 2.4],
    [13.2, 2.4],
    [13.2, 8.2],
    [7.4, 14],
  ]),
);
g(
  'align-left',
  cap(2.4, 3.6, 13.6, 3.6, 1.2) + cap(2.4, 8, 9.4, 8, 1.2) + cap(2.4, 12.4, 12, 12.4, 1.2),
);
g(
  'align-center',
  cap(2.4, 3.6, 13.6, 3.6, 1.2) + cap(4.6, 8, 11.4, 8, 1.2) + cap(3.2, 12.4, 12.8, 12.4, 1.2),
);
g(
  'align-right',
  cap(2.4, 3.6, 13.6, 3.6, 1.2) + cap(6.6, 8, 13.6, 8, 1.2) + cap(4, 12.4, 13.6, 12.4, 1.2),
);
g(
  'volume-high',
  poly([
    [1.8, 6],
    [4.6, 6],
    [8, 2.8],
    [8, 13.2],
    [4.6, 10],
    [1.8, 10],
  ]) +
    arc(8.4, 8, 2.8, -55, 55, 1.15) +
    arc(8.4, 8, 5.2, -50, 50, 1.15),
);
g(
  'volume-xmark',
  poly([
    [1.8, 6],
    [4.6, 6],
    [8, 2.8],
    [8, 13.2],
    [4.6, 10],
    [1.8, 10],
  ]) +
    cap(10, 6, 14.2, 10, 1.25) +
    cap(14.2, 6, 10, 10, 1.25),
);
g(
  'music',
  cap(6.2, 4.2, 6.2, 11.6, 1.2) +
    cap(13, 2.6, 13, 10, 1.2) +
    poly([
      [5.6, 2.4],
      [13.6, 1.4],
      [13.6, 4],
      [5.6, 5],
    ]) +
    ring(4.2, 11.6, 2, 1.2) +
    ring(11, 10, 2, 1.2),
);
g(
  'atom',
  dot(8, 8, 1.4) +
    ellipseArc(8, 8, 6.2, 2.1, 0, 360, 0.9, 30, true) +
    ellipseArc(8, 8, 6.2, 2.1, 0, 360, 0.9, -30, true) +
    ellipseArc(8, 8, 6.2, 2.1, 0, 360, 0.9, 90, true),
);
g(
  'brain',
  line(
    [
      [8, 2.4],
      [11.6, 3],
      [13.5, 6],
      [12.6, 9.8],
      [9.8, 13.4],
      [6, 13.5],
      [3, 11.2],
      [2.5, 7.4],
      [4.4, 4],
    ],
    1.3,
    true,
  ) +
    cap(8, 3.2, 8, 13, 1.15) +
    cap(5.2, 6, 8, 7.4, 1.05) +
    cap(10.8, 9.6, 8, 8.6, 1.05),
);
g(
  'shield-halved',
  line(
    [
      [8, 1.8],
      [13.6, 4.2],
      [13.6, 8.4],
      [8, 14.2],
      [2.4, 8.4],
      [2.4, 4.2],
    ],
    1.3,
    true,
  ) + cap(8, 2.6, 8, 13.4, 1.15),
);
g('boxes-placeholder', '');
delete glyphs['boxes-placeholder'];
g(
  'download',
  cap(8, 2.2, 8, 9.8, 1.3) +
    line(
      [
        [4.8, 6.8],
        [8, 10.2],
        [11.2, 6.8],
      ],
      1.25,
    ) +
    line(
      [
        [2.8, 11],
        [2.8, 13.8],
        [13.2, 13.8],
        [13.2, 11],
      ],
      1.25,
    ),
);
g(
  'cloud-arrow-down',
  dot(5.5, 6.6, 2.5) +
    dot(9, 5.6, 3.1) +
    dot(11.6, 7.3, 2.2) +
    rrect(4.4, 6.6, 8.4, 2.6, 1.3) +
    cap(8, 9, 8, 13.4, 1.25) +
    line(
      [
        [5.9, 11.2],
        [8, 13.6],
        [10.1, 11.2],
      ],
      1.2,
    ),
);
g(
  'arrow-up-right-from-square',
  line(
    [
      [7.4, 3],
      [3, 3],
      [3, 13],
      [13, 13],
      [13, 8.6],
    ],
    1.25,
  ) +
    cap(7.6, 8.4, 13.2, 2.8, 1.25) +
    line(
      [
        [9.4, 2.6],
        [13.4, 2.6],
        [13.4, 6.6],
      ],
      1.25,
    ),
);

// ------------------------------------------------------- category tones
/**
 * COLOUR AS A GLYPH'S OWN CHANNEL. Blender's Properties-tab rail groups by
 * HUE — in `properties-object.png` at 14 px the tab shapes are near
 * indistinguishable and the ink is what says which group a tab belongs to —
 * and the outliner tints a row's type glyph the same way. Each name below is
 * a category the palette inks (`EditorTheme.color.category`, where every
 * value's source coordinates are recorded); a glyph paints
 * `var(--vgai-category-<tone>, currentColor)`, so under a palette that names
 * no category group it paints exactly as it did monochrome.
 *
 * A NAME, NOT A SITE. A tone here tints EVERY site that asks for this icon
 * name, so a name is toned only when its meaning is the category at every
 * one of them. Measured live, that is not a hypothetical: the first cut
 * toned `cube`, `camera`, `lightbulb` and `globe`, and the running editor
 * painted the Perspective/Orthographic dropdown orange and the world-space
 * toggle red — both are viewport CONTROLS that happen to reuse the drawing.
 * The fix is `editorIcons.modeling`'s: a meaning that needs its own ink gets
 * its own name. `hierarchy-kind-icon.ts` now asks for `outliner-object`,
 * `outliner-light` and `outliner-camera`, which no other site asks for, and
 * they are aliased to the same drawings below.
 *
 *  - `outliner-object`, `outliner-light`, `outliner-camera` → `object`.
 *    `outliner.png`: the Camera, Cube and Light rows' type glyphs all
 *    measure #bb7f4d over the row's #272727 — ONE orange for all three,
 *    because Blender's outliner discriminates OBJECT from DATA, not camera
 *    from light. The same ink is the Object tab's in `properties-object.png`.
 *  - `atom` → `modifier`. Its only site is the inspector's physics/rigid-
 *    body/collider group (`inspection/compose.ts`'s `GROUP_ICON_RULES`);
 *    `properties-object.png` paints Physics — with Modifier, Particles and
 *    Constraints — one blue.
 *  - `palette` → `material`. Its product sites are all material sections
 *    (the same `GROUP_ICON_RULES`, the model-asset and react inspectors);
 *    the Material tab of the same rail.
 *  - `screwdriver-wrench` → `tool`. Its only site is a project tool's own
 *    glyph (`tool-loader.ts`); the Tool tab of the same rail.
 *
 * The six `mesh-*` operator marks carry their tone at the glyph instead,
 * with a `tonedPath`, because an operator mark tints only the element it
 * operates on and leaves the cube neutral.
 *
 * NOT toned, each for a measured reason rather than an oversight:
 *  - `globe` — Blender's World tab is red, but no site in this editor draws
 *    a globe to mean a World datablock: the two are the transform-SPACE
 *    toggle and a build profile. A red globe there reads as an error state.
 *  - `table` — its one product site is the mesh inspector's Vertex Groups
 *    panel, which is Blender's green `DATA_PT_vertex_groups`, but it renders
 *    through `SectionHeader`, which passes `tone="dim"` to every section
 *    glyph — and an explicit site tone wins by contract. A tone there would
 *    never paint.
 */
/** The union `IconCategoryTone` declares (`@vgai/editor-sdk/looks`), and the
 *  reason `blender.style.ts` may narrow this JSON with an assertion: a tone
 *  outside it never reaches the artifact. */
const TONES = ['object', 'modifier', 'material', 'tool', 'operator', 'data', 'scene', 'collection', 'select'];

// The outliner's three names, aliased onto the drawings they share with the
// generic glyphs. Same picture, its own name, so only the outliner is tinted.
g('outliner-object', glyphs['cube'].path);
// A MESH OBJECT's row mark is not a cube. Measured on the native 2x
// `outliner.png` (the Cube row, src x 127-154, y 179-206): Blender draws an
// APEX-DOWN triangle, heavily stroked, with a triangular knockout in its upper
// half — the object-type sibling of the datablock's `properties-data` mark, in
// the object orange rather than the data green. On the set's 16-unit grid the
// outer triangle is (1.25,1.25)-(14.75,1.25)-(8,14.75) and the knockout
// (4.75,4.25)-(11.25,4.25)-(8,9.75). `outliner-object` keeps the cube for the
// generic three-object row, which has no mesh to name.
g(
  'outliner-mesh',
  poly([
    [1.25, 1.25],
    [14.75, 1.25],
    [8, 14.75],
  ]) +
    holePoly([
      [4.75, 4.25],
      [11.25, 4.25],
      [8, 9.75],
    ]),
);
g('outliner-light', glyphs.lightbulb.path);
g('outliner-camera', glyphs.camera.path);

// The Properties editor's two package tabs, each its own name so only the
// rail is tinted. `properties-modifiers` is the wrench Blender draws for the
// Modifiers tab, in the modifier blue. `properties-data` is Blender's
// MESH_DATA mark — a triangle with a vertex dot at each corner — drawn on
// the set's own grid at its own stroke, measured from `properties-object.png`'s
// Object Data tab (src x 10-56, y 802-830).
/**
 * BLENDER'S MODIFIER TAB IS ONE OPEN-END WRENCH, and this glyph used to be
 * `screwdriver-wrench` — the TOOL tab's two-tool silhouette — reused under a
 * second name. At the 14px rail the two read as different marks, and the rail
 * paints them side by side, so the reuse was the loudest thing left in it.
 *
 * MEASURED off `modeling-edit-none.png` at its native 2x (the rail's OPEN
 * Modifier tab, ink x 2861..2888, y 1004..1031 — 28x28 device px, exactly the
 * box the Data tab's mark fills two cells below, which is what calibrates the
 * scale: `properties-data` spans 16.6 viewBox units, so this does too).
 * Row-by-row ink runs, thresholded at half coverage and mapped onto the set's
 * plain 16 grid, give a shape with four parts:
 *
 *  - a HEAD. Not a stroke of constant width: the outer boundary is a circle
 *    (5.08 left, 14.81 right at the head's own centre line) and the bore is a
 *    SMALLER, concentric circle, so the ring is ~2.9 thick where the handle
 *    leaves it and the jaw's flats eat into it from the other side.
 *  - a JAW cut as a SLOT WITH PARALLEL FLATS, not a wedge and not a wider
 *    bore. Both inner faces measure dx/dy = -1.00 over their whole length
 *    (left face x+y = 12.84, right face x+y = 19.41) - parallel, ~4.3 apart,
 *    on an axis at -45 degrees, opposite the handle. That parallelism is the
 *    one fact that makes the mark read as a WRENCH rather than a C: a
 *    radial-ended annulus puts the jaw's inner corner 3.8 device px off.
 *  - the slot STOPS about a unit short of the head's centre, which is what
 *    keeps the ring closed across the bottom (the frame's row y 1018 is one
 *    unbroken run, 5.08..14.57).
 *  - a HANDLE at exactly 45 degrees - its right boundary moves one device
 *    pixel per row for nine rows - ~3.7 wide, ending in a round cap whose
 *    extremes ARE the glyph's left and bottom edges.
 *
 * THE CONSTANTS BELOW ARE THE FIT, NOT THE RAW READING. Every feature above
 * is a boundary read at a 50% threshold on a 28px glyph, so each carries about
 * half a device pixel of slack, and the rim's apparent radius swings 4.5..5.0
 * depending on which row it is read from (near the top the circle is almost
 * horizontal, so half a pixel of radius moves x by two). The reading fixed the
 * STRUCTURE; the numbers were then settled by rendering the path at the
 * reference's own scale and counting the pixels where the two half-coverage
 * masks disagree. Every constant stayed inside its own reading's error bar and
 * the count came down 18 -> 5 of 298 ref ink pixels, which is the floor this
 * instrument has: the five are single pixels on antialiased diagonals.
 *
 * DRAWN AS ONE CLOSED BOUNDARY, NO KNOCKOUT AT ALL — and that is the whole
 * reason this glyph is a traced outline rather than the file's usual pile of
 * primitives. Two knockout constructions were tried and both are impossible
 * here, which is worth stating so the third attempt does not repeat them:
 *  - disc + handle capsule, then bore and slot punched. The handle has to
 *    reach PAST the bore to cover the head (its cap would need to sit at
 *    radius >4.04 to clear the bore and <3.11 to stay inside the outer
 *    circle — no such radius), so the head is DOUBLY covered exactly where
 *    the punches land: winding 2 - 1 = 1, and every knockout fills back in.
 *  - one outer polygon with the bore and the slot as holes. The slot has to
 *    run PAST the rim to cut the jaw open, and a hole outside its fill is not
 *    a hole — it is ink (winding +1), which is what it drew: a blue bar
 *    across the top-right corner. The bore and the slot also overlap, and two
 *    overlapping holes cancel to ink in their intersection.
 * The material is SIMPLY CONNECTED — the bore opens into the jaw, which opens
 * to the outside — so its boundary is one walk: the rim from the upper arm's
 * tip round to the handle, the handle's two sides and its cap, the rim again
 * to the lower jaw's tip, in along one flat, across the jaw's stop, round the
 * BACK of the bore, and out along the other flat.
 */
const modifierWrench = () => {
  const cx = 10.28; // the head's centre
  const cy = 5.84;
  const rOut = 4.78; // its outer rim
  const rIn = 1.85; // its bore
  const hw = 2.15; // half the jaw's opening
  const off = -0.12; // the jaw's midline, off the head's centre
  const stop = -1.1; // where the jaw stops, along its own axis
  const hx = 3.2; // the handle's end cap
  const hy = 12.75;
  const hr = 1.87;
  const A = [Math.SQRT1_2, -Math.SQRT1_2]; // jaw/handle axis, up-right
  const N = [Math.SQRT1_2, Math.SQRT1_2]; // its perpendicular, down-right
  /** A point in the jaw's own frame: `s` along the axis, `f` across it. */
  const at = (s, f) => [cx + A[0] * s + N[0] * f, cy + A[1] * s + N[1] * f];
  const ang = ([x, y]) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  const sweep = (r, a0, a1, ox = cx, oy = cy) => {
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 6));
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
      return [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
    });
  };
  const rim = (f) => Math.sqrt(Math.max(rOut * rOut - f * f, 0));
  const fUp = off - hw; // the jaw's two flats, across its axis
  const fLo = off + hw;
  const t1 = at(rim(fUp), fUp); // the upper arm's tip
  const t2 = at(rim(fLo), fLo); // the lower jaw's tip
  // Where each side of the handle runs into the rim, in the same frame.
  const offAxis = (cx - hx) * N[0] + (cy - hy) * N[1];
  const pUp = at(-rim(-hr - offAxis), -hr - offAxis);
  const pLo = at(-rim(hr - offAxis), hr - offAxis);
  // BOTH FLATS CLEAR THE BORE (2.32 out against a 2.07 radius) and the jaw's
  // stop crosses it, so the bore meets the jaw at the STOP, never at a flat.
  const b = Math.sqrt(Math.max(rIn * rIn - stop * stop, 0));
  const v1 = at(stop, b);
  const v2 = at(stop, -b);
  return poly([
    ...sweep(rOut, ang(t1), ang(pUp) - 360), // the rim, over the top, to the handle
    ...sweep(hr, 225, 45, hx, hy), // the handle: its two sides and its cap
    ...sweep(rOut, ang(pLo) - 360, ang(t2) - 360), // the rim again, to the jaw
    at(stop, fLo), // in along the jaw's lower flat, then across its stop
    ...sweep(rIn, ang(v1), ang(v2) + 360), // round the BACK of the bore
    at(stop, fUp), // across the stop again, and out along the upper flat
  ]);
};
g('properties-modifiers', modifierWrench());
/**
 * RE-MEASURED 2026-09-19 EDGE BY EDGE, and the mark is not a triangle drawn
 * THROUGH three vertex marks. The 2026-09-18 cut got the orientation and the
 * square vertices right and then drew the triangle as one closed `line`
 * running vertex-centre to vertex-centre, which fills each square's hollow
 * from the inside: at the 14 px the Outliner paints it the three squares
 * closed to blobs and the whole glyph read as a fat stem with two legs — a
 * Y — where Blender's reads as a clean triangle with three open boxes on it.
 *
 * The frames are NOT ANTIALIASED here (every ink pixel is the full
 * `#07b189`/`#05ae87` and every background pixel the full row), so these are
 * EXACT EDGES, not fits. Read down `modeling-object-none.png`'s Cube row (src
 * x 269..296, y 179..206 — the Outliner crop `[x2843..3452, y53..419]`'s
 * x 269..296, y 179..206), confirmed identical in `modeling-object-selected.png`
 * and `outliner.png`, and the same mark at the same size in
 * `properties-object.png`'s Data tab:
 *
 *   three squares, OUTER 8 device px, WALL 2, HOLLOW 4 — at [0,8), [20,28)
 *     and [10,18) of the mark's own 28 px box
 *   a top BAR x [6,22)  y [2,4)   — it runs wall to wall between the two top
 *     squares and stops dead at each hollow; it does NOT cross them, and it
 *     sits in the UPPER half of the hollow band, not on the squares' centre
 *   two DIAGONALS, 2 px wide, living only in y [8,20) — the gap between the
 *     top squares' bottom edge and the bottom square's top edge. The left
 *     one's centre runs x 273.04 → 279.44 down that span (a subpixel fit over
 *     twelve rows, residual under 0.1 px), which is the top square's own
 *     centre-x at the top and the bottom square's LEFT edge at the bottom;
 *     the right one is its mirror about the box's centre.
 *
 * So the three edges are drawn BETWEEN the squares and the squares are
 * FILLED-WITH-A-KNOCKOUT rather than stroked outlines — which is also why
 * their corners are square where `rframe`'s round joins gave ours a dot.
 * `poly`/`rrect` take no `W` fattening, which is what this mark wants: it is
 * fitted to pixels, like `properties-modifiers` and the editor-type wells.
 *
 * PROVED, the way the wrench was: the path rasterized at the reference's own
 * scale (28x28, 4x4 supersampled, inked at half coverage) and differenced
 * against the frame's mask — 1 of 222 reference ink pixels disagrees, a
 * single antialiased pixel on the right diagonal's edge.
 *
 * A NOTE ON THE THRESHOLD, because it nearly cost this glyph its geometry:
 * the mark is crisp everywhere EXCEPT the diagonals' edges, and read at a
 * 0.44-coverage cut those two bars mask one pixel wider than they are. Fitted
 * to that mask the diagonals want 2.35 device px; fitted to the frame's own
 * subpixel MASS (2.26 px per row across twelve rows, times cos 28.06 deg)
 * they measure 1.99, and at the honest half-coverage cut the measured width
 * is the one that scores 1/222 where the fitted width scores 3. A shape
 * tuned to a rasterizer's threshold is tuned to the rasterizer.
 */
/** One device px of the reference, in this file's plain 16 units: the mark
 *  inks exactly 28x28 device px, which is 13.5 units once `S` has scaled it
 *  (1.25..14.75) — the same calibration the wells below use. */
const DATA_PX = 13.5 / 28;
/** A measured edge, counted from the mark's own first ink pixel. */
const dpx = (px) => 1.25 + px * DATA_PX;
/** A bar with SQUARE ends. `cap`'s round ends would push ink past the square
 *  each diagonal dies against, into its hollow, where Blender draws none. */
const dataBar = (x1, y1, x2, y2, w) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  const nx = (-dy / L) * (w / 2);
  const ny = (dx / L) * (w / 2);
  return poly([
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  ]);
};
/** A vertex mark: an 8-px square with its 4-px middle punched out. */
const dataVertex = (px, py) => {
  const side = 8 * DATA_PX;
  const wall = 2 * DATA_PX;
  const hole = 4 * DATA_PX;
  const x = dpx(px);
  const y = dpx(py);
  return (
    rrect(x, y, side, side) +
    holePoly([
      [x + wall, y + wall],
      [x + wall + hole, y + wall],
      [x + wall + hole, y + wall + hole],
      [x + wall, y + wall + hole],
    ])
  );
};
g(
  'properties-data',
  // the bar between the two top squares
  rrect(dpx(6), dpx(2), 16 * DATA_PX, 2 * DATA_PX) +
    // the two diagonals, square-ended, spanning only the gap between squares
    dataBar(dpx(4.04), dpx(8), dpx(10.44), dpx(20), 2 * DATA_PX) +
    dataBar(dpx(23.96), dpx(8), dpx(17.56), dpx(20), 2 * DATA_PX) +
    dataVertex(0, 0) +
    dataVertex(20, 0) +
    dataVertex(10, 20),
);

// The Outliner's DATABLOCK row (`@vgai/blender`'s datablock hierarchy) —
// the same MESH_DATA mark the Properties rail's Data tab draws, under its own
// name because the two sites composite differently: `outliner.png`'s data
// glyph is #07b189 over the row's #272727 and `properties-object.png`'s tab is
// #05ae87 over the rail's #1c1c1c, one ink at α 0.791 in both — while our rail
// paints its tab at full alpha, so the two will not stay one value.
g('outliner-data', glyphs['properties-data'].path);

/**
 * BLENDER'S PROPERTIES RAIL, TRACED FROM BLENDER'S OWN ICON SOURCES.
 *
 * `ED_buttons_tabs_list` (`space_buttons.cc:201-255`) draws up to sixteen tabs
 * and each one's mark is named in `buttons_context_items`
 * (`makesrna/intern/rna_space.cc:579-611`) — `ICON_SCENE` for Render,
 * `ICON_SCENE_DATA` for Scene, `ICON_OBJECT_DATA` for Object, and so on. Each
 * of those icons IS A FILE in the Blender checkout at the engine's pin:
 * `release/datafiles/icons_svg/<lowercase name>.svg`, authored on a 16-unit
 * grid inside a 1600 viewBox. The compiled `.dat` sheets under
 * `release/datafiles/icons/` are that file's BUILD PRODUCT, not its source,
 * and Blender 5.x has no combined `blender_icons.svg` master.
 *
 * WHAT I1 LEFT AND THIS REPLACES: thirteen of the sixteen were a distinct NAME
 * over a neighbouring silhouette this set already drew — a globe for World, a
 * magnet for Constraints, a palette for Material — and the remaining two
 * (`properties-modifiers`, `properties-data`) were measured pixel-by-pixel off
 * a screenshot. All sixteen are now traced from the vector source, which is
 * both more exact than a screenshot reading and far less code: the two
 * hand-measured marks above this line took two paragraphs of prose each to
 * justify one shape.
 *
 * GPL PATHS, DELIBERATELY — AND THE PACKAGE'S SPDX SAYS SO. Blender's icon
 * sources are GPL-2.0-or-later, and `@vgai/blender` is
 * `AGPL-3.0-only AND GPL-3.0-or-later` (`packages/blender/LICENSE`, whose
 * notice block names this set, its provenance file and the §13 combination):
 * our code is AGPL, these 197 paths are Blender's artwork conveyed as GPL-3.0,
 * and both licences' §13 permit the combination. Nothing traced may be copied
 * into an Apache/MIT part of this repo; `packages/editor`'s own icon set in
 * particular stays free of it.
 *
 * NO `S` AND NO `W`. Those two dials exist to bring OUR drawings up to
 * Blender's ink ratio (see their note at the top of this file); a traced mark
 * already has it. Measured over the traced set, Blender's marks ink 14 of the
 * 16 units (x and y both 1..15 in almost every file), against the ~14.5 the
 * dialled geometry above produces — within 3.5%, so the rail reads as one set
 * while every traced glyph keeps Blender's own proportions exactly.
 *
 * Re-derive `blender.icons.traced.json` with
 * `node blender-icons.source.mjs --trace`, which reads the checkout at
 * `$BLENDER_SRC` (default `~/volter/blender-src`; the recipe is in WORK.md
 * §Blender in the tab is Blender, "Inspection parity") and records each
 * glyph's source file and sha256 beside its path. The ordinary run consumes
 * that JSON and needs no checkout.
 */
// The TONE rides with the traced glyph, read from that icon's own
// `DEF_ICON_<GROUP>` macro at trace time (see the `--trace` block). The
// Properties rail's sixteen keep their assignments in `CATEGORY_TONE` below,
// which is where they were measured; a traced entry that carries `tone` is
// answering for itself and that table names none of them.
for (const [name, entry] of Object.entries(traced))
  g(name, entry.path, entry.tone ? { tone: entry.tone } : undefined);

// -- the EDITOR-TYPE WELLS -------------------------------------------------
/**
 * THE TWO MARKS BLENDER PUTS IN AN AREA'S EDITOR-TYPE WELL, in the two areas
 * the reference frames photograph. Every Blender area begins with that well —
 * a 32x20 CSS rounded box, 1 px `#3c3c3c` over a constant `#272727` inner —
 * and the glyph inside it is what says which editor the area is
 * (`workspace-regions.ts`'s `groupTabs`).
 *
 * BOTH ARE READ AT NATIVE 2x AND BOTH INK EXACTLY 28x28 DEVICE PX, which is
 * the same box `properties-data` and the modifier wrench fill two paragraphs
 * up — so the same calibration carries over unchanged: 28 device px of ink is
 * 13.5 units on this file's plain 16 grid (1 unit = 2.074 device px), and the
 * ink lands at 1.25..14.75 in both axes once `S` has scaled it. Every constant
 * below is a measured pixel edge divided by that one number; none is a taste
 * call.
 *
 * Neither is antialiased in the frame — the runs are the same at a 60 and a
 * 120 threshold — so every edge quoted is exact rather than a fit.
 *
 * THE OTHER FIVE PANELS OF THIS EDITOR GET NO GLYPH HERE, and the reason is
 * that there is nothing to measure: the reference set photographs the Layout,
 * Modeling, Sculpting and Texture Paint workspaces, whose areas are the 3D
 * View, the Outliner, the Properties editor, the Timeline, the Image Editor
 * and the asset shelf. No frame contains a File Browser or an Asset Browser,
 * and Blender's editor-type dropdown is closed in all of them, so the Content
 * browser's and the Asset Library's wells have NO Blender reading at all.
 * They reuse names this set already draws (`workspace-static-panels.ts` says
 * which, and says that the choice is ours).
 */

// `outliner.png`, the Outliner area's own well: ink x 27..54, y 11..38 device.
// Six parts, each a pixel-exact rectangle with SQUARE corners (no corner in
// this glyph loses a pixel at either threshold):
//   the collection box   x [27,37)  y [11,17)
//   the tree's stem      x [31,33)  y [19,37)
//   its upper arm        x [31,39)  y [25,27)
//   its lower arm        x [31,39)  y [35,37)
//   the upper child box  x [41,55)  y [23,29)
//   the lower child box  x [41,55)  y [33,39)
// The two GAPS are the mark's own: 2 device px between the collection box and
// the stem's top, and 2 more between each arm's end and its child box. Closing
// either — which is what a tree icon drawn from memory does — turns three
// separated rows into one connected bracket.
g(
  'outliner',
  rrect(1.25, 1.25, 4.82, 2.89) +
    rrect(3.18, 5.11, 0.96, 8.68) +
    rrect(3.18, 8.0, 3.86, 0.96) +
    rrect(3.18, 12.82, 3.86, 0.96) +
    rrect(8.0, 7.04, 6.75, 2.89) +
    rrect(8.0, 11.86, 6.75, 2.89),
);

/**
 * `modeling-edit-none.png`, the Properties area's own well: ink x 2870..2897,
 * y 437..464 device. TWO SOLID STADIUMS, each 28x12 device (radius = half the
 * height), stacked with 4 device px between them — and each carries a
 * KNOCKOUT, which is what makes the pair read as two sliders at different
 * settings rather than as two blank pills:
 *   stadium rows     y [437,449) and y [453,465), both x [2870,2898)
 *   upper knockout   x [2882,2896)  y [439,447)
 *   lower knockout   x [2888,2896)  y [455,463)
 * Each knockout is FLAT ON ITS LEFT and semicircular on its right: the right
 * boundary reads 2893/2894/2895/2895 down its four half-rows, which fits a
 * radius of exactly 4 device px (= half the knockout's own height) and nothing
 * else; the left boundary is one x for all eight rows. The two differ only in
 * where that flat left edge sits, and that difference is the whole picture.
 *
 * The knockouts are strictly INSIDE their stadiums (2 device px of ink on
 * every side), so the nonzero winding is well posed — unlike the wrench's two
 * failed constructions recorded above, nothing here is punched outside its own
 * fill or punched twice.
 */
const sliderSlot = (xL, y, xR, h) => {
  const r = h / 2;
  const cy = y + r;
  const cx = xR - r;
  const cap = Array.from({ length: 13 }, (_, i) => {
    const a = ((-90 + 15 * i) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  return holePoly([[xL, y], ...cap, [xL, y + h]]);
};
g(
  'properties',
  rrect(1.25, 1.25, 13.5, 5.79, 2.41) +
    sliderSlot(7.04, 2.21, 13.79, 3.86) +
    rrect(1.25, 8.96, 13.5, 5.79, 2.41) +
    sliderSlot(9.93, 9.92, 13.79, 3.86),
);

/**
 * BLENDER HUE-GROUPS ITS RAIL, AND THE SOURCE SAYS WHICH GROUP EACH MARK IS
 * IN. Every icon in `UI_icons.hh` is declared through a `DEF_ICON_<GROUP>`
 * macro, and `interface_icons.cc:126-132` maps those macros onto the theme
 * members `interface/resources.cc:1059-1078` reads:
 *
 *   DEF_ICON_SCENE       → TH_ICON_SCENE       `.tui.icon_scene`       #cccccc
 *   DEF_ICON_COLLECTION  → TH_ICON_COLLECTION  `.tui.icon_collection`  #ffffff
 *   DEF_ICON_OBJECT      → TH_ICON_OBJECT      `.tui.icon_object`      #e19658
 *   DEF_ICON_OBJECT_DATA → TH_ICON_OBJECT_DATA `.tui.icon_object_data` #00d4a3
 *   DEF_ICON_MODIFIER    → TH_ICON_MODIFIER    `.tui.icon_modifier`    #74a2ff
 *   DEF_ICON_SHADING     → TH_ICON_SHADING     `.tui.icon_shading`     #cc6670
 *
 * (`userdef_default_theme.c:272-277`.) So the assignments below are READ, not
 * matched by eye — and reading them corrected two guesses I1 recorded as open:
 * WORLD is `DEF_ICON_SHADING(WORLD)` (`UI_icons.hh:193`), the same red as
 * Material and Texture, NOT the scene grey; and GROUP — the Collection tab —
 * is `DEF_ICON_COLLECTION(GROUP)` (`:248`), a white of its own rather than
 * that grey either. The scene group is exactly four tabs: Render
 * (`DEF_ICON_SCENE(SCENE)`, `:188`), Output (`:187`), View Layer
 * (`DEF_ICON_SCENE(RENDER_RESULT)`, `:265`) and Scene
 * (`DEF_ICON_SCENE(SCENE_DATA)`, `:267`).
 *
 * Every object-data mark — MESH_DATA, ARMATURE_DATA, BONE_DATA and the rest of
 * the per-type set the Data tab draws — is `DEF_ICON_OBJECT_DATA`
 * (`:251-263`), which is why they share one tone rather than list one each.
 */
const CATEGORY_TONE = {
  'properties-render': 'scene',
  'properties-output': 'scene',
  'properties-view-layer': 'scene',
  'properties-scene': 'scene',
  'properties-collection': 'collection',
  'properties-world': 'material',
  'properties-object': 'object',
  'properties-physics': 'modifier',
  'properties-particles': 'modifier',
  'properties-constraints': 'modifier',
  'properties-bone-constraints': 'modifier',
  'properties-bone': 'data',
  'properties-material': 'material',
  'properties-texture': 'material',
  'outliner-object': 'object',
  'outliner-mesh': 'object',
  'outliner-light': 'object',
  'outliner-camera': 'object',
  'outliner-data': 'data',
  atom: 'modifier',
  palette: 'material',
  'screwdriver-wrench': 'tool',
  'properties-modifiers': 'modifier',
  'properties-data': 'data',
  // The Data tab's per-object-type marks (`buttons_context_compute` sets
  // `sbuts->dataicon` from `RNA_struct_ui_icon`) — all one group.
  ...Object.fromEntries(
    Object.keys(traced)
      .filter((name) => name.startsWith('properties-data-'))
      .map((name) => [name, 'data']),
  ),
};
for (const [name, tone] of Object.entries(CATEGORY_TONE)) {
  // A table that names a glyph this set no longer draws is a silent no-op,
  // and a tone assignment that silently stops applying is exactly the kind
  // of thing nobody notices until the rail goes grey.
  if (!glyphs[name]) throw new Error(`CATEGORY_TONE names a glyph this set does not draw: ${name}`);
  glyphs[name] = { ...glyphs[name], tone };
}
for (const [name, glyph] of Object.entries(glyphs)) {
  if (glyph.tone !== undefined && !TONES.includes(glyph.tone))
    throw new Error(
      `glyph "${name}" carries tone "${glyph.tone}", which is not an IconCategoryTone`,
    );
  if (glyph.tonedPath !== undefined && glyph.tone === undefined)
    throw new Error(
      `glyph "${name}" has a tonedPath and no tone — the second path would paint currentColor`,
    );
}

// ---------------------------------------------------------------- emit

const ordered = {};
for (const key of Object.keys(glyphs).sort()) ordered[key] = glyphs[key];

const out = { id: 'blender', title: 'Blender', glyphs: ordered };
const target = new URL('./blender.icons.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`blender.icons.json — ${Object.keys(ordered).length} glyphs`);
