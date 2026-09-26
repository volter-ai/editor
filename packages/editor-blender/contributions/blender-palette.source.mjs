/**
 * THE SOURCE of `blender.palette.json` — Blender's own default theme, read
 * from Blender's own theme TABLE rather than eyedropped from a screenshot
 * (WORK.md §Blender in the tab is Blender, "Inspection parity", I2 decision 7;
 * ARCHITECTURE-CORE §Blender north star, "The reference is Blender's SOURCE as
 * well as its frames").
 *
 * Run `node packages/blender/contributions/blender-palette.source.mjs` to
 * rewrite the JSON; `--check` reports what would change and exits non-zero if
 * anything would. It reads
 * `release/datafiles/userdef/userdef_default_theme.c` from a Blender checkout
 * at the engine's pin (`$BLENDER_SRC`, default `~/volter/blender-src`; the
 * checkout recipe is in WORK.md §Blender in the tab is Blender, "Inspection
 * parity"). That file is itself generated — `tools/utils/blender_theme_as_c.py`
 * writes it from the shipped theme — so it is the closest thing Blender has to
 * a machine-readable palette.
 *
 * ## Why this exists
 *
 * Every value in `blender.palette.json` used to be eyedropped off a reference
 * frame, and I1 measured the drift that produces: `surface.panel` carried
 * `#2f2f2f` where `.space_properties.back` is `#303030`, and `content.primary`
 * `#e5e5e5` against `.text`'s `#e6e6e6`. One level each — invisible, and
 * exactly the kind of error an eyedropper makes (a screenshot is a COMPOSITE:
 * a panel fill sits under a hairline outline at 6.7% white, and a PNG's own
 * colour management can move a level besides). The source has no such
 * ambiguity.
 *
 * ## What is NOT derived, and why each one
 *
 * A key is derived only when its meaning is EXACTLY one theme member. The
 * rest are stated as literals with their reason, because a false citation is
 * worse than an honest measurement:
 *
 *  - a COMPOSITE Blender draws by blending two members (the viewport's axis
 *    lines) — the source value is an input to what you see, not what you see;
 *  - a member Blender declares with an ALPHA it composites over a surface the
 *    palette does not carry (a region header, a popover back);
 *  - a semantic colour Blender's theme has no member for at all (our
 *    danger/warning/success set, which is the editor's own vocabulary).
 *
 * Nothing here invents a colour: every literal below names where it came from.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

// ------------------------------------------------- Blender's theme table

const CHECKOUT = process.env['BLENDER_SRC'] ?? `${homedir()}/volter/blender-src`;
const THEME = 'release/datafiles/userdef/userdef_default_theme.c';

/**
 * `userdef_default_theme.c` as `{ 'tui.panel_header': { hex, alpha, line } }`.
 *
 * The file is machine-generated and utterly regular — one `.member = {` per
 * nesting level, one `.member = RGBA(0x…)` per colour — so this is a brace
 * walk rather than a C parser. A member the walk does not recognise is
 * skipped; a member the TABLE below names and the walk did not find is a hard
 * error, which is what keeps this honest when Blender renames one.
 */
function readTheme() {
  let text;
  try {
    text = readFileSync(`${CHECKOUT}/${THEME}`, 'utf8');
  } catch {
    throw new Error(
      `${THEME} is not in the Blender checkout at ${CHECKOUT}. Set BLENDER_SRC, or add the ` +
        'directory to the sparse checkout (`git sparse-checkout add release/datafiles/userdef`) ' +
        'and re-run the LFS-off checkout line in WORK.md §Blender in the tab is Blender.',
    );
  }
  const members = {};
  const stack = [];
  text.split('\n').forEach((line, index) => {
    const open = /^\s*\.(\w+)\s*=\s*\{\s*$/.exec(line);
    if (open !== null) {
      stack.push(open[1]);
      return;
    }
    if (/^\s*\},?\s*$/.test(line)) {
      stack.pop();
      return;
    }
    const value = /^\s*\.(\w+)\s*=\s*RGBA?\(0x([0-9a-fA-F]+)\)/.exec(line);
    if (value === null) return;
    const digits = value[2].padStart(8, '0');
    members[[...stack, value[1]].join('.')] = {
      hex: `#${digits.slice(0, 6).toLowerCase()}`,
      alpha: Number.parseInt(digits.slice(6, 8), 16) / 255,
      line: index + 1,
    };
  });
  return members;
}

// ------------------------------------------------------------ the mapping

/** A theme member, taken OPAQUE: Blender's `back` members carry an alpha byte
 *  that the region fill does not use (`.space_properties.back` is `0x30303000`
 *  and the properties editor is plainly not transparent), and a palette
 *  surface is one colour. */
const rgb = (member) => ({ member });
/** A theme member taken WITH its alpha — for the members whose alpha is the
 *  point (`.tui.widget_emboss`, `.tui.panel_outline`). */
const rgba = (member) => ({ member, alpha: true });
/** A value the theme has no single member for. `why` is mandatory. */
const held = (value, why) => ({ value, why });

/**
 * PALETTE KEY → THEME MEMBER. Dotted on both sides; the left is a path into
 * `theme.color`, the right a path into `U_theme_default`.
 */
const MAPPING = {
  'surface.shell': rgb('tui.editor_border'),
  'surface.panel': rgb('space_properties.back'),
  'surface.chrome': held(
    '#1c1c1c',
    'a region HEADER is `.header` at alpha 0xb3 (`space_properties.header`) composited over the ' +
      'window, and this palette carries ONE opaque colour for every header in the editor. ' +
      'Measured on the reference frames.',
  ),
  'surface.raised': rgb('tui.wcol_regular.inner'),
  'surface.inset': rgb('tui.wcol_text.inner'),
  'surface.overlay': held(
    'rgba(48,48,48,0.94)',
    'a popover in the source is `.tui.wcol_menu_back.inner` #181818 opaque; ours floats over the ' +
      'editor and the frames measure it as the properties back at 94%. Our own compositing, not ' +
      "Blender's.",
  ),

  'boundary.default': rgb('tui.wcol_regular.outline'),
  'boundary.strong': rgb('tui.wcol_regular.outline'),
  'boundary.area': rgb('tui.editor_border'),
  'boundary.indent': held(
    '#656565',
    "the Outliner's indent guides, which `outliner_draw.cc` draws as a shade of the row rather " +
      'than from a member of its own. Measured on `outliner.png`.',
  ),
  'boundary.divider': held(
    '#2e2e2e',
    'the rule inside one region, which Blender draws as a shade of the region back rather than ' +
      'from a member of its own. Measured on the reference frames.',
  ),

  'content.primary': rgb('tui.wcol_regular.text'),
  'content.muted': rgb('space_outliner.text'),
  'content.dim': held(
    '#969696',
    'Blender dims text by drawing the same `.text` at reduced alpha (`widget_alpha_factor`), not ' +
      'from a second member. #969696 is `.tui.wcol_regular.text` #e6e6e6 at 0.5 over ' +
      '`.space_properties.back` #303030.',
  ),
  'content.onAccent': rgb('tui.wcol_regular.text_sel'),
  'content.menu': rgb('tui.wcol_menu_item.text'),
  'content.status': rgb('space_statusbar.header_text'),
  'content.placeholder': held(
    '#5e5e5e',
    "Blender's fields draw no placeholder text at all; this is the editor's own affordance, set " +
      'between `.tui.wcol_text.inner` and `.text`.',
  ),
  'content.active': rgb('space_view3d.active'),
  'content.selected': rgb('space_outliner.selected_object'),
  'content.onBright.primary': held(
    '#1d1d1d',
    '`.tui.wcol_regular.item` #1d1d1d — the ink Blender puts ON a filled widget — read opaque.',
  ),
  'content.onBright.muted': held('rgba(29,29,29,0.82)', 'the same ink, our own two dim steps.'),
  'content.onBright.dim': held('rgba(29,29,29,0.7)', 'the same ink, our own two dim steps.'),

  'accent.default': rgb('tui.wcol_regular.inner_sel'),
  'accent.muted': rgb('tui.wcol_regular.inner_sel'),

  'widget.regular': rgb('tui.wcol_regular.inner'),
  'widget.menu': rgb('tui.wcol_menu.inner'),
  'widget.field': rgb('tui.wcol_text.inner'),
  'widget.emboss': rgba('tui.widget_emboss'),

  'viewport.background': rgb('space_view3d.back'),
  'viewport.grid': rgb('space_view3d.grid_major'),
  'viewport.axisX': held(
    '#cb293f',
    "the grid's axis line is a BLEND of `.space_view3d.grid_major` and `.tui.xaxis` #ff3352 " +
      '(the overlay engine blends them per line; `draw/engines/overlay` is outside the sparse ' +
      'checkout). The source value is an input to what is drawn, not what is drawn — measured.',
  ),
  'viewport.axisY': held(
    '#69aa15',
    'the same blend over `.tui.yaxis` #8bdc00 — measured, see axisX.',
  ),
  // There is no `viewport.axisZ`: the grid plane draws two axis lines. The
  // gizmos carry all three (`gizmo.*`).
  'viewport.selection': rgb('space_view3d.select'),
  'viewport.active': rgb('space_view3d.active'),

  // The transform gizmo draws the theme's axis colours as they are
  // (`transform_gizmo_3d.cc`, `gizmo_get_axis_color`), and so does the navigation gizmo, mixed
  // toward the viewport by each ball's depth as it draws (`view3d_gizmo_navigate_type.cc`; the
  // stage computes the mix, so the measured (245,54,81) of `modeling-object-none.png` is `.tui.xaxis`
  // at that ball's depth, not a colour of its own).
  'gizmo.x': rgb('tui.xaxis'),
  'gizmo.y': rgb('tui.yaxis'),
  'gizmo.z': rgb('tui.zaxis'),

  'region.outliner': rgb('space_outliner.back'),
  'region.properties': rgb('space_properties.back'),

  // The icon groups, `interface_icons.cc:126-132`'s `DEF_ICON_<GROUP>` macros
  // through `interface/resources.cc:1059-1078` to these members. The two new
  // names are I2's: `scene` for the Render/Output/View Layer/Scene tabs and
  // `collection` for the Collection tab.
  'category.object': rgb('tui.icon_object'),
  'category.modifier': rgb('tui.icon_modifier'),
  'category.material': rgb('tui.icon_shading'),
  'category.data': rgb('tui.icon_object_data'),
  'category.scene': rgb('tui.icon_scene'),
  'category.collection': rgb('tui.icon_collection'),
  'category.tool': held(
    '#cbcbcb',
    'Blender declares no icon group for the Tool tab — `ICON_TOOL_SETTINGS` is a plain ' +
      '`DEF_ICON`, drawn in `.text`. Measured on the reference frames, and a level below ' +
      '`.tui.icon_scene` #cccccc, which is what it sits beside.',
  ),
  'category.select': held(
    '#ffaf2a',
    "Blender's Select Box marquee, baked into the tool icon's geometry (`ops.generic.select_box`), " +
      'not a theme member. Measured on `gizmo-select-box.png`: (255,175,42).',
  ),
  'category.operator': held(
    '#95dab2',
    "Blender's edit-mode tool column tints its creating operators green; no theme member carries " +
      'it. Measured on `modeling-edit-none.png`.',
  ),

  // The editor's OWN vocabulary. Blender's theme has no danger/warning/success
  // group: a Blender error is a report banner, not a themed colour, so these
  // are ours and are stated as ours.
  'semantic.danger': held('#e0524a', "the editor's own; Blender's theme has no error colour."),
  'semantic.dangerMuted': held('rgba(224,82,74,0.28)', 'the same, at our own two alphas.'),
  'semantic.dangerFaint': held('rgba(224,82,74,0.12)', 'the same, at our own two alphas.'),
  'semantic.warning': held('#e5b83c', "the editor's own."),
  'semantic.warningMuted': held('rgba(229,184,60,0.28)', "the editor's own."),
  'semantic.success': held('#6fbf5f', "the editor's own."),
  'semantic.successMuted': held('rgba(111,191,95,0.28)', "the editor's own."),
  'semantic.dynamic': held('#e5b83c', "the editor's own."),
  'semantic.dynamicMuted': held('rgba(229,184,60,0.18)', "the editor's own."),
  'semantic.instance': held(
    '#ffa028',
    "`.space_view3d.active` #ffa028 — the editor's instance badge reuses Blender's active ink.",
  ),

  'neutralOverlay.hover': held(
    'rgba(255,255,255,0.08)',
    "Blender lightens a widget by SHADE (`widget_state`'s `+15` on the inner colour), not by " +
      'an overlay; ours is an overlay because our widgets are CSS. The alpha matches that shade.',
  ),
  'neutralOverlay.active': held('rgba(255,255,255,0.14)', 'the same shade rule, one step up.'),
  scrim: held('rgba(0,0,0,0.6)', 'a modal scrim is ours — Blender dims nothing behind a popup.'),
};

/** Groups the emitted document keeps verbatim: not colours. */
const TYPOGRAPHY = {
  sans: "'Inter', 'DejaVu Sans', system-ui, sans-serif",
  mono: "'DejaVu Sans Mono', Menlo, monospace",
};

// ------------------------------------------------------------------- emit

function set(target, path, value) {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)] = value;
}

function get(source, path) {
  return path.split('.').reduce((node, part) => node?.[part], source);
}

function cssOf(entry, withAlpha) {
  if (!withAlpha || entry.alpha === 1) return entry.hex;
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(entry.hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${Math.round(entry.alpha * 1000) / 1000})`;
}

const theme = readTheme();
const color = {};
const citations = {};
for (const [key, rule] of Object.entries(MAPPING)) {
  if (rule.member === undefined) {
    set(color, key, rule.value);
    citations[key] = `held — ${rule.why}`;
    continue;
  }
  const entry = theme[rule.member];
  if (entry === undefined)
    throw new Error(
      `${THEME} has no member \`${rule.member}\`, which \`${key}\` cites. Blender renamed or ` +
        'removed it; re-read the theme and update the mapping rather than dropping the key.',
    );
  set(color, key, cssOf(entry, rule.alpha === true));
  citations[key] = `${rule.member} (${THEME}:${entry.line})`;
}

const target = new URL('./blender.palette.json', import.meta.url);
const before = JSON.parse(readFileSync(target, 'utf8'));
const document = {
  schemaVersion: 3,
  name: 'Blender',
  theme: { id: 'blender', color, typography: TYPOGRAPHY },
};

const changes = [];
for (const key of Object.keys(MAPPING)) {
  const was = get(before.theme.color, key);
  const now = get(color, key);
  if (was !== now)
    changes.push(`  ${key.padEnd(28)} ${String(was)} -> ${now}   [${citations[key]}]`);
}
for (const line of changes) console.log(line);
console.log(
  `blender.palette.json — ${Object.keys(MAPPING).length} keys, ` +
    `${Object.values(MAPPING).filter((rule) => rule.member !== undefined).length} derived from ` +
    `${THEME}, ${changes.length} changed`,
);

if (process.argv.includes('--check')) {
  if (changes.length > 0) process.exit(1);
} else {
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
}
