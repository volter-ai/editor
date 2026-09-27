import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/control';
import * as L from '../../capabilities/catalog/project-source/src/lib/godot-compat/label';
import * as LS from '../../capabilities/catalog/project-source/src/lib/godot-compat/label-settings';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as COLOR from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { drawn } from './canvas-draw';
import { TEXTS } from './text-samples';
import { int, type Op, type Pair, ref, type Segment, uiCase, v2 } from './ui-tree';

const VIEWPORT: Pair = [640, 360];
const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = uiCase(VIEWPORT, segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Label', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

/** Every character's rectangle: each glyph's advance and position, not only the rounded width. */
const BOUNDS = (tag: string, text: string): Op[] => Array.from(text, (_, i): Op => ({ read: 'get_character_bounds', on: tag, args: [int(i)] }));
const READS = (tag: string, text: string): Op[] => [
  { read: 'get_minimum_size', on: tag },
  { read: 'get_line_count', on: tag },
  { read: 'get_visible_line_count', on: tag },
  { read: 'get_line_height', on: tag },
  { read: 'get_size', on: tag },
  ...BOUNDS(tag, text),
];

// Each sample text, one line, at the default size: the minimum size and every character's place.
const LINES = [...TEXTS, '', 'Two\nlines', 'Three\n\nparas', 'Tab\there'];
const TEXT_CASE: Segment[] = [
  { ops: LINES.flatMap((text, i): Op[] => [{ node: `l${String(i)}`, kind: 'Label' }, { call: 'set_text', on: `l${String(i)}`, args: [text] }]) },
  { await: 1, ops: LINES.flatMap((text, i): Op[] => [...READS(`l${String(i)}`, text), { read: 'get_text', on: `l${String(i)}` }]) },
];
for (const member of ['set_text', 'get_text', 'get_line_count', 'get_line_height', 'get_character_bounds']) add(`${member}-texts`, member, TEXT_CASE);

// Label settings: sizes above and below the subpixel threshold, spacing, outline, and the
// settings' change reaching the node's size.
const SETTINGS_TEXT = 'Settings and\nsizes: 1,234 — ok';
const SETTINGS: Segment[] = [
  {
    ops: [
      { settings: 's' },
      { read: 'get_font_size', on: 's' },
      { read: 'get_line_spacing', on: 's' },
      { read: 'get_paragraph_spacing', on: 's' },
      { read: 'get_font_color', on: 's' },
      { read: 'get_outline_size', on: 's' },
      { read: 'get_outline_color', on: 's' },
      { node: 'l', kind: 'Label' },
      { call: 'set_text', on: 'l', args: [SETTINGS_TEXT] },
      { call: 'set_label_settings', on: 'l', args: [ref('s')] },
    ],
  },
  { await: 1, ops: READS('l', SETTINGS_TEXT) },
  ...[13, 21, 24, 37].map((size): Segment => ({
    await: 1,
    ops: [
      { call: 'set_font_size', on: 's', args: [int(size)] },
      { call: 'set_line_spacing', on: 's', args: [size / 4] },
      { call: 'set_paragraph_spacing', on: 's', args: [size / 2] },
      { call: 'set_outline_size', on: 's', args: [int(2)] },
      { read: 'get_font_size', on: 's' },
      { read: 'get_line_spacing', on: 's' },
      { read: 'get_paragraph_spacing', on: 's' },
      { read: 'get_outline_size', on: 's' },
    ],
  })).flatMap((segment): Segment[] => [segment, { await: 1, ops: READS('l', SETTINGS_TEXT) }]),
];
add('set_label_settings-settings', 'set_label_settings', SETTINGS);
add('get_label_settings-settings', 'get_label_settings', [{ ops: [{ settings: 's' }, { node: 'l', kind: 'Label' }, { call: 'set_label_settings', on: 'l', args: [ref('s')] }] }]);

// Alignment in a larger rect: each line's place. (Horizontal FILL justifies the lines, which is not
// bound; the vertical FILL spreads them.)
const ALIGN_TEXT = 'Left or right\ncentered text\nx';
const ALIGN: Segment[] = [
  {
    ops: [
      { node: 'l', kind: 'Label' },
      { call: 'set_text', on: 'l', args: [ALIGN_TEXT] },
      { call: 'set_custom_minimum_size', on: 'l', args: [v2(301, 211)] },
    ],
  },
  ...[0, 1, 2].flatMap((h): Segment[] =>
    [0, 1, 2, 3].map((v): Segment => ({
      await: 1,
      ops: [
        { call: 'set_horizontal_alignment', on: 'l', args: [int(h)] },
        { call: 'set_vertical_alignment', on: 'l', args: [int(v)] },
        { read: 'get_horizontal_alignment', on: 'l' },
        { read: 'get_vertical_alignment', on: 'l' },
        ...READS('l', ALIGN_TEXT),
      ],
    })),
  ),
];
for (const member of ['set_horizontal_alignment', 'get_horizontal_alignment', 'set_vertical_alignment', 'get_vertical_alignment', 'get_visible_line_count']) {
  add(`${member}-align`, member, ALIGN);
}

// Autowrap at several widths: word, smart word, arbitrary.
const WRAP_TEXT = 'The quick brown fox jumps over the lazy dog, twice-over; supercalifragilistic words!';
const WRAP: Segment[] = [
  { ops: [{ node: 'l', kind: 'Label' }, { call: 'set_text', on: 'l', args: [WRAP_TEXT] }] },
  ...[1, 2, 3].flatMap((mode): Segment[] =>
    [40, 97, 180].map((width): Segment => ({
      await: 1,
      ops: [
        { call: 'set_autowrap_mode', on: 'l', args: [int(mode)] },
        { call: 'set_custom_minimum_size', on: 'l', args: [v2(width, 0)] },
        { call: 'set_size', on: 'l', args: [v2(width, 0)] },
        { read: 'get_autowrap_mode', on: 'l' },
      ],
    })).flatMap((segment): Segment[] => [segment, { await: 1, ops: READS('l', WRAP_TEXT) }]),
  ),
];
for (const member of ['set_autowrap_mode', 'get_autowrap_mode']) add(`${member}-wrap`, member, WRAP);

// What the page draws: each line as SVG text at Godot's line position and baseline.
cases.push({
  id: 'draw-centered-outlined',
  symbol: { kind: 'native-member', owner: 'Label', member: 'set_text' },
  gdscript: '',
  comparator: 'render-mapping',
  fact: {
    // "JUMP" is 42 wide and 23 high at 16px: centered in 126x128 its line starts at int(126 - 42) / 2
    // = 42 and int((128 - 23) / 2) = 52, the baseline 18 (the ascent) below; the outline of 4 is a
    // stroke of 2 (radius 1, `text_server_adv.cpp:1512`).
    value: '<text x="42" y="70" font-family="godot-default-font" font-size="16" fill="rgba(255, 204, 0, 1)" xml:space="preserve" stroke="rgba(0, 0, 0, 1)" stroke-width="2" stroke-linejoin="round" paint-order="stroke">JUMP</text>',
    source: { file: 'scene/gui/label.cpp', symbol: 'Label::_notification', line: 749 },
  },
  target: () => {
    const page = drawn();
    const label = page.node('Control', 'l', undefined, (entity) => L.godot_label_mount(entity));
    const settings = LS.godot_label_settings_new();
    LS.set_font_color(settings, COLOR.construct(1, 0.8, 0, 1));
    LS.set_outline_size(settings, 4);
    LS.set_outline_color(settings, COLOR.construct(0, 0, 0, 1));
    L.set_label_settings(label, settings);
    L.set_text(label, 'JUMP');
    L.set_horizontal_alignment(label, 1);
    L.set_vertical_alignment(label, 1);
    C.set_size(label, V2.construct(126, 128));
    page.draw();
    return page.root.querySelector('text')?.outerHTML ?? '';
  },
});

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Label', compatModule: 'lib/godot-compat/label', cases };
export default EVIDENCE;
