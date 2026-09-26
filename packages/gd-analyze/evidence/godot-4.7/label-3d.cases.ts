/**
 * Label3D: labels made in official Godot (inside the tree, their deferred update run by the next
 * frame) and in compat (the message queue flushed), each read back: the text layout's AABB for
 * texts, sizes, pixel sizes, alignments, offsets, line spacing and autowrap widths, and each
 * property's setter and getter.
 */
import { readFileSync } from 'node:fs';
import { Mesh } from 'three';
import * as F from '../../capabilities/catalog/project-source/src/lib/godot-compat/font';
import * as L from '../../capabilities/catalog/project-source/src/lib/godot-compat/label-3d';
import * as O from '../../capabilities/catalog/project-source/src/lib/godot-compat/object';
import * as VI from '../../capabilities/catalog/project-source/src/lib/godot-compat/visual-instance-3d';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd, gs } from './literals';

F.godot_font_default(F.godot_font_load(new Uint8Array(readFileSync(new URL('../../capabilities/catalog/project-source/src/lib/godot-compat/OpenSans_SemiBold.woff2', import.meta.url)))));

const cases: GodotEvidenceCase[] = [];
/** The layout AABB cases (`VisualInstance3D.get_aabb` of a Label3D), run by `visual-instance-3d`'s case file. */
export const LABEL3D_AABB_CASES: GodotEvidenceCase[] = [];

type Prop =
  | readonly ['text', string]
  | readonly ['font_size' | 'horizontal_alignment' | 'vertical_alignment' | 'autowrap_mode' | 'outline_size', number]
  | readonly ['pixel_size' | 'line_spacing' | 'width', number]
  | readonly ['offset', readonly [number, number]];

const gdValue = (prop: Prop): string =>
  prop[0] === 'text' ? gs(prop[1]) : prop[0] === 'offset' ? `Vector2(${gd(prop[1][0])}, ${gd(prop[1][1])})` : typeof prop[1] === 'number' && ['pixel_size', 'line_spacing', 'width'].includes(prop[0]) ? gd(prop[1]) : String(prop[1]);

function apply(label: Mesh, prop: Prop): void {
  switch (prop[0]) {
    case 'text':
      L.set_text(label, prop[1]);
      break;
    case 'offset':
      L.set_offset(label, V2.construct(prop[1][0], prop[1][1]));
      break;
    default:
      (L[`set_${prop[0]}`] as (self: object, value: number) => void)(label, prop[1]);
  }
}

function add(id: string, member: string, props: readonly Prop[], read: 'aabb' | string): void {
  const lines = ['var l := Label3D.new()', 'holder.add_child(l)', ...props.map((prop) => `l.${prop[0]} = ${gdValue(prop)}`), 'await holder.get_tree().process_frame'];
  lines.push(read === 'aabb' ? 'return [l.get_aabb().position, l.get_aabb().size]' : `return l.${read}`);
  (read === 'aabb' ? LABEL3D_AABB_CASES : cases).push({
    id,
    symbol: { kind: 'native-member', owner: read === 'aabb' ? 'VisualInstance3D' : 'Label3D', member },
    gdscript: lines.join('\n'),
    target: () => {
      const label = new Mesh();
      L.godot_label_3d_mount(label);
      for (const prop of props) apply(label, prop);
      O.godot_message_queue_flush();
      if (read === 'aabb') {
        const box = VI.get_aabb(label);
        return [box.position, box.size];
      }
      const getter = read.replace(/\(.*$/u, '');
      return (L as unknown as Record<string, (self: object, ...args: unknown[]) => unknown>)[getter]!(label, ...(read.includes('(') ? [Number(read.slice(read.indexOf('(') + 1, -1))] : []));
    },
    comparator: 'exact',
  });
}

const TEXTS = ['123', 'Hi', 'You have found\na secret area!', 'Mixed widths: WAVE tofu, AVA!', '', 'trailing space  ', 'a\n\nb'];
TEXTS.forEach((text, index) => add(`aabb-text-${String(index)}`, 'get_aabb', [['text', text]], 'aabb'));
for (const size of [48, 16, 7]) add(`aabb-size-${String(size)}`, 'get_aabb', [['text', 'You have found\na secret area!'], ['font_size', size], ['pixel_size', 0.01]], 'aabb');
for (const h of [0, 1, 2, 3]) {
  for (const v of [0, 1, 2]) {
    add(`aabb-align-${String(h)}-${String(v)}`, 'get_aabb', [['text', 'Two\nlines here'], ['horizontal_alignment', h], ['vertical_alignment', v]], 'aabb');
  }
}
add('aabb-offset', 'get_aabb', [['text', 'Offset'], ['offset', [13.5, -7]], ['line_spacing', 3.5]], 'aabb');
add('aabb-spacing', 'get_aabb', [['text', 'a\nb\nc'], ['line_spacing', -4]], 'aabb');
for (const [mode, width] of [[3, 120], [2, 90], [1, 60], [0, 60]] as const) {
  add(`aabb-wrap-${String(mode)}-${String(width)}`, 'get_aabb', [['text', 'The quick brown fox jumps over the lazy dog'], ['autowrap_mode', mode], ['width', width]], 'aabb');
}

for (const [member, getter, prop] of [
  ['set_text', 'text', ['text', 'hello']],
  ['set_font_size', 'font_size', ['font_size', 48]],
  ['set_pixel_size', 'pixel_size', ['pixel_size', 0.013]],
  ['set_line_spacing', 'line_spacing', ['line_spacing', 2.25]],
  ['set_width', 'width', ['width', 77.7]],
  ['set_autowrap_mode', 'autowrap_mode', ['autowrap_mode', 2]],
  ['set_horizontal_alignment', 'horizontal_alignment', ['horizontal_alignment', 2]],
  ['set_vertical_alignment', 'vertical_alignment', ['vertical_alignment', 0]],
  ['set_outline_size', 'outline_size', ['outline_size', 4]],
  ['set_offset', 'offset', ['offset', [1.5, -2]]],
] as const) {
  add(`${member}`, member, [prop as Prop], `get_${getter}()`);
}
for (const getter of ['get_text', 'get_font_size', 'get_pixel_size', 'get_line_spacing', 'get_width', 'get_autowrap_mode', 'get_horizontal_alignment', 'get_vertical_alignment', 'get_outline_size', 'get_offset', 'get_modulate', 'get_outline_modulate', 'get_billboard_mode']) {
  add(`${getter}-default`, getter, [], `${getter}()`);
}
for (const flag of [0, 1, 2, 3]) add(`get_draw_flag-default-${String(flag)}`, 'get_draw_flag', [], `get_draw_flag(${String(flag)})`);

// Setters without a Prop row: colours, flags, billboard.
const direct = (id: string, member: string, gdscript: string, run: (label: Mesh) => unknown): void => {
  cases.push({
    id,
    symbol: { kind: 'native-member', owner: 'Label3D', member },
    gdscript: ['var l := Label3D.new()', 'holder.add_child(l)', gdscript].join('\n'),
    target: () => {
      const label = new Mesh();
      L.godot_label_3d_mount(label);
      return run(label);
    },
    comparator: 'exact',
  });
};
direct('set_modulate', 'set_modulate', 'l.modulate = Color(0.301961, 0.623529, 0.862745, 1)\nreturn l.modulate', (l) => {
  L.set_modulate(l, C.construct(0.301961, 0.623529, 0.862745, 1));
  return L.get_modulate(l);
});
direct('set_outline_modulate', 'set_outline_modulate', 'l.outline_modulate = Color(1, 0.8, 0.4, 0.5)\nreturn l.outline_modulate', (l) => {
  L.set_outline_modulate(l, C.construct(1, 0.8, 0.4, 0.5));
  return L.get_outline_modulate(l);
});
for (const [flag, enabled] of [[1, false], [2, true], [9, true]] as const) {
  direct(`set_draw_flag-${String(flag)}`, 'set_draw_flag', `l.set_draw_flag(${String(flag)}, ${String(enabled)})\nreturn l.get_draw_flag(${String(flag)})`, (l) => {
    L.set_draw_flag(l, flag, enabled);
    return L.get_draw_flag(l, flag);
  });
}
for (const mode of [1, 2, 5]) {
  direct(`set_billboard_mode-${String(mode)}`, 'set_billboard_mode', `l.billboard = ${String(mode)}\nreturn l.billboard`, (l) => {
    L.set_billboard_mode(l, mode);
    return L.get_billboard_mode(l);
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Label3D', compatModule: 'lib/godot-compat/label-3d', cases };
export default EVIDENCE;
