/**
 * AnimationTree cases: `R` with a Node3D `A`, an AnimationPlayer `P` holding `x` and `y` (A's
 * position, looping and not) and an AnimationTree `T` blending them (`mix`, a Blend2, over `x` and a
 * TimeScale `slow` over `y`), which takes P's libraries as it enters the tree. The native side builds
 * the graph through the AnimationNode API; the target loads the same graph from its data, as a
 * scene does, and gives the tree the binding the translation resolves for `A:position`.
 */
import { Group, Object3D, Scene } from 'three';
import * as A from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation';
import * as AL from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-library';
import * as AM from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-mixer';
import * as AP from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-player';
import * as AT from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-tree';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as N3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-3d';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd, gs } from './literals';

const DT = 1 / 60;

interface World {
  readonly log: unknown[];
  readonly a: Object3D;
  readonly t: Group;
  readonly p: Group;
  readonly root: AT.AnimationNode;
}
interface Op {
  readonly gd: readonly string[];
  readonly ts: (w: World) => void;
}
interface Step {
  readonly await?: 'process' | 'physics';
  readonly ops: readonly Op[];
}

const GRAPH: AT.GodotAnimationNodeData = {
  type: 'blend-tree',
  nodes: [
    { name: 'x', node: { type: 'animation', animation: 'x' } },
    { name: 'y', node: { type: 'animation', animation: 'y' } },
    { name: 'slow', node: { type: 'time-scale' } },
    { name: 'mix', node: { type: 'blend2' } },
  ],
  connections: [['output', 0, 'mix'], ['mix', 0, 'x'], ['mix', 1, 'slow'], ['slow', 0, 'y']],
};
const G_GRAPH = [
  'var bt := AnimationNodeBlendTree.new()',
  'var nx := AnimationNodeAnimation.new()',
  'nx.animation = &"x"',
  'var ny := AnimationNodeAnimation.new()',
  'ny.animation = &"y"',
  'bt.add_node("x", nx)',
  'bt.add_node("y", ny)',
  'bt.add_node("slow", AnimationNodeTimeScale.new())',
  'bt.add_node("mix", AnimationNodeBlend2.new())',
  'bt.connect_node("output", 0, "mix")',
  'bt.connect_node("mix", 0, "x")',
  'bt.connect_node("mix", 1, "slow")',
  'bt.connect_node("slow", 0, "y")',
];

const read = {
  a: (): Op => ({ gd: ['log.append(a.position)'], ts: (w) => w.log.push(N3.get_position(w.a)) }),
  param: (name: string): Op => ({ gd: [`log.append(t.get(${gs(`parameters/${name}`)}))`], ts: (w) => w.log.push(AT.godot_animation_tree_get(w.t, `parameters/${name}`) ?? null) }),
};
const set = (name: string, value: number): Op => ({ gd: [`t.set(${gs(`parameters/${name}`)}, ${gd(value)})`], ts: (w) => void AT.godot_animation_tree_set(w.t, `parameters/${name}`, value) });

function gdscript(setup: readonly Op[], steps: readonly Step[]): string {
  const lines = [
    'var log: Array = []',
    'var r := Node3D.new()',
    'r.name = "R"',
    'holder.add_child(r)',
    'var a := Node3D.new()',
    'a.name = "A"',
    'r.add_child(a)',
    'var p := AnimationPlayer.new()',
    'p.name = "P"',
    'var lib := AnimationLibrary.new()',
    'var x := Animation.new()',
    'x.length = 1.0',
    'x.loop_mode = 1',
    'var xt := x.add_track(0)',
    'x.track_set_path(xt, "A:position")',
    'x.track_insert_key(xt, 0.0, Vector3(0.0, 0.0, 0.0))',
    'x.track_insert_key(xt, 1.0, Vector3(4.0, 0.0, 0.0))',
    'lib.add_animation("x", x)',
    'var y := Animation.new()',
    'y.length = 0.5',
    'var yt := y.add_track(0)',
    'y.track_set_path(yt, "A:position")',
    'y.track_insert_key(yt, 0.0, Vector3(0.0, 1.0, 0.0))',
    'y.track_insert_key(yt, 0.5, Vector3(0.0, 3.0, -2.0))',
    'lib.add_animation("y", y)',
    'p.add_animation_library("", lib)',
    'r.add_child(p)',
    'var t := AnimationTree.new()',
    't.name = "T"',
    't.animation_started.connect(func(n): log.append("started:" + n))',
    't.animation_finished.connect(func(n): log.append("finished:" + n))',
    ...G_GRAPH,
    't.tree_root = bt',
    't.anim_player = NodePath("../P")',
    ...setup.flatMap((op) => op.gd),
    'r.add_child(t)',
  ];
  for (const step of steps) {
    if (step.await !== undefined) lines.push(step.await === 'physics' ? 'await physics_frame' : 'await process_frame');
    for (const op of step.ops) lines.push(...op.gd);
  }
  lines.push('await process_frame', 'return log');
  return lines.join('\n');
}

function target(setup: readonly Op[], steps: readonly Step[]): () => unknown {
  return () => {
    const scene = new Scene();
    ST.godot_tree_set_root(scene);
    const tree = ST.godot_tree();
    const holder = new Group();
    N.godot_node_adopt(holder, { kind: 'node' });
    N.add_child(scene, holder);
    const log: unknown[] = [];
    const r = new Object3D();
    r.name = 'R';
    N.godot_node_adopt(r, { kind: 'spatial', classes: ['Node3D', 'Node', 'Object'] });
    N.add_child(holder, r);
    const a = new Object3D();
    a.name = 'A';
    N.godot_node_adopt(a, { kind: 'spatial', classes: ['Node3D', 'Node', 'Object'] });
    N.add_child(r, a);
    const p = new Group();
    p.name = 'P';
    N.godot_node_adopt(p, { kind: 'node', classes: ['AnimationPlayer', 'AnimationMixer', 'Node', 'Object'] });
    AP.godot_animation_player_mount(p);
    const lib = AL.construct();
    const x = A.construct();
    A.set_length(x, 1);
    A.set_loop_mode(x, 1);
    A.add_track(x, 0);
    A.track_set_path(x, 0, 'A:position');
    A.track_insert_key(x, 0, 0, V.construct(0, 0, 0));
    A.track_insert_key(x, 0, 1, V.construct(4, 0, 0));
    AL.add_animation(lib, 'x', x);
    const y = A.construct();
    A.set_length(y, 0.5);
    A.add_track(y, 0);
    A.track_set_path(y, 0, 'A:position');
    A.track_insert_key(y, 0, 0, V.construct(0, 1, 0));
    A.track_insert_key(y, 0, 0.5, V.construct(0, 3, -2));
    AL.add_animation(lib, 'y', y);
    AM.add_animation_library(p, '', lib);
    N.add_child(r, p);
    const t = new Group();
    t.name = 'T';
    N.godot_node_adopt(t, { kind: 'node', classes: ['AnimationTree', 'AnimationMixer', 'Node', 'Object'] });
    AT.godot_animation_tree_mount(t);
    AM.godot_animation_mixer_bind(t, { values: { 'A:position': { set: N3.set_position } } });
    AM.godot_animation_mixer_signal(t, 'animation_started').connect((n) => log.push(`started:${n}`));
    AM.godot_animation_mixer_signal(t, 'animation_finished').connect((n) => log.push(`finished:${n}`));
    const root = AT.godot_animation_node_load(GRAPH);
    AT.set_tree_root(t, root);
    AT.set_animation_player(t, '../P');
    const world: World = { log, a, t, p, root };
    for (const op of setup) op.ts(world);
    let result: unknown[] | undefined;
    const pending: Step[] = [...steps, { await: 'process', ops: [] }];
    const arm = (): void => {
      const step = pending.shift();
      if (step === undefined) {
        result = [...log];
        return;
      }
      if (step.await === undefined) {
        for (const op of step.ops) op.ts(world);
        arm();
        return;
      }
      (step.await === 'physics' ? tree.physics_frame : tree.process_frame).connect(
        () => {
          for (const op of step.ops) op.ts(world);
          arm();
        },
        { oneShot: true },
      );
    };
    tree.process_frame.connect(
      () => {
        N.add_child(r, t);
        arm();
      },
      { oneShot: true },
    );
    ST.godot_tree_frame(DT);
    for (let guard = 0; result === undefined && guard < 2000; guard += 1) {
      ST.godot_tree_physics_step(DT);
      if (result !== undefined) break;
      ST.godot_tree_frame(DT);
    }
    return result;
  };
}

const frames = (n: number, ...ops: Op[]): Step[] => Array.from({ length: n }, () => ({ await: 'process' as const, ops }));
const now = (...ops: Op[]): Step => ({ ops });
const cases: GodotEvidenceCase[] = [];
const add = (id: string, member: string, setup: readonly Op[], steps: readonly Step[]): void => {
  cases.push({ id, symbol: { kind: 'native-member', owner: 'AnimationTree', member }, gdscript: gdscript(setup, steps), target: target(setup, steps), comparator: 'exact' });
};

add('set_tree_root-blend', 'set_tree_root', [set('mix/blend_amount', 0.25), set('slow/scale', 0.5)], [
  now(read.a(), read.param('mix/blend_amount')),
  ...frames(40, read.a(), read.param('x/current_position'), read.param('y/current_position')),
  now(set('mix/blend_amount', 1)),
  ...frames(10, read.a()),
  now(set('mix/blend_amount', 0), set('slow/scale', 2)),
  ...frames(10, read.a()),
]);
add('get_tree_root', 'get_tree_root', [], [now({ gd: ['log.append(t.get_tree_root() == bt)'], ts: (w) => w.log.push(AT.get_tree_root(w.t) === w.root) })]);
add('set_animation_player', 'set_animation_player', [set('mix/blend_amount', 0.5)], [
  ...frames(5, read.a()),
  now({ gd: ['t.anim_player = NodePath("")'], ts: (w) => AT.set_animation_player(w.t, '') }),
  ...frames(3, read.a()),
  now({ gd: ['t.anim_player = NodePath("../P")'], ts: (w) => AT.set_animation_player(w.t, '../P') }),
  ...frames(5, read.a()),
]);
add('get_animation_player', 'get_animation_player', [], [
  now({ gd: ['log.append(String(t.get_animation_player()))'], ts: (w) => w.log.push(AT.get_animation_player(w.t)) }),
]);

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'AnimationTree',
  compatModule: 'lib/godot-compat/animation-tree',
  cases,
};
export default EVIDENCE;
