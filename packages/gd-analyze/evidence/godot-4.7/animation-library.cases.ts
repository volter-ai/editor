import * as A from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation';
import * as L from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-library';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gs } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('AnimationLibrary');
/** A library with animations `a0…` added under `names`, in order; the body returns `result`. */
const body = (names: readonly string[], lines: readonly string[], result: string): string[] => [
  'var lib := AnimationLibrary.new()',
  ...names.map((_, i) => `var a${String(i)} := Animation.new()`),
  ...names.map((name, i) => `lib.add_animation(${gs(name)}, a${String(i)})`),
  ...lines,
  `return ${result}`,
];
const build = (names: readonly string[]) => {
  const lib = L.construct();
  const animations = names.map(() => A.construct());
  names.forEach((name, i) => L.add_animation(lib, name, animations[i] as A.Animation));
  return { lib, animations };
};

const NAMES = ['walk', 'Idle', 'run', 'b', 'a_1', 'Á'] as const;

c.add('add_animation-list', 'add_animation', body(NAMES, [], '[lib.get_animation_list(), lib.get_animation_list_size()]'), () => {
  const { lib } = build(NAMES);
  return [L.get_animation_list(lib), L.get_animation_list_size(lib)];
});
c.add('add_animation-invalid', 'add_animation', body([], ['var a := Animation.new()', 'var r := [lib.add_animation("", a), lib.add_animation("a/b", a), lib.add_animation("a:b", a), lib.add_animation("a,b", a), lib.add_animation("a[b", a), lib.add_animation("ok", a), lib.add_animation("ok2", null)]'], '[r, lib.get_animation_list()]'), () => {
  const { lib } = build([]);
  const a = A.construct();
  const r = ['', 'a/b', 'a:b', 'a,b', 'a[b', 'ok'].map((name) => L.add_animation(lib, name, a));
  r.push(L.add_animation(lib, 'ok2', null));
  return [r, L.get_animation_list(lib)];
});
c.add('add_animation-replace', 'add_animation', body(['x', 'y'], ['var z := Animation.new()', 'lib.add_animation("x", z)'], '[lib.get_animation("x") == z, lib.get_animation("y") == a1, lib.get_animation_list_size()]'), () => {
  const { lib, animations } = build(['x', 'y']);
  const z = A.construct();
  L.add_animation(lib, 'x', z);
  return [L.get_animation(lib, 'x') === z, L.get_animation(lib, 'y') === animations[1], L.get_animation_list_size(lib)];
});
c.add('remove_animation', 'remove_animation', body(['x', 'y', 'z'], ['lib.remove_animation("y")', 'lib.remove_animation("nope")'], '[lib.get_animation_list(), lib.has_animation("y")]'), () => {
  const { lib } = build(['x', 'y', 'z']);
  L.remove_animation(lib, 'y');
  L.remove_animation(lib, 'nope');
  return [L.get_animation_list(lib), L.has_animation(lib, 'y')];
});
c.add('rename_animation', 'rename_animation', body(['x', 'y'], ['lib.rename_animation("x", "w")', 'lib.rename_animation("y", "w")', 'lib.rename_animation("y", "a/b")', 'lib.rename_animation("nope", "q")'], '[lib.get_animation_list(), lib.get_animation("w") == a0]'), () => {
  const { lib, animations } = build(['x', 'y']);
  L.rename_animation(lib, 'x', 'w');
  L.rename_animation(lib, 'y', 'w');
  L.rename_animation(lib, 'y', 'a/b');
  L.rename_animation(lib, 'nope', 'q');
  return [L.get_animation_list(lib), L.get_animation(lib, 'w') === animations[0]];
});
c.add('has_animation', 'has_animation', body(['x'], [], '[lib.has_animation("x"), lib.has_animation("X"), lib.has_animation("")]'), () => {
  const { lib } = build(['x']);
  return [L.has_animation(lib, 'x'), L.has_animation(lib, 'X'), L.has_animation(lib, '')];
});
c.add('get_animation', 'get_animation', body(['x', 'y'], [], '[lib.get_animation("y") == a1, lib.get_animation("q") == null]'), () => {
  const { lib, animations } = build(['x', 'y']);
  return [L.get_animation(lib, 'y') === animations[1], L.get_animation(lib, 'q') === null];
});
c.add('get_animation_list', 'get_animation_list', body(['z', 'Z', 'a', '_', '0', 'aa', 'a0'], [], 'lib.get_animation_list()'), () => L.get_animation_list(build(['z', 'Z', 'a', '_', '0', 'aa', 'a0']).lib));
c.add('get_animation_list_size', 'get_animation_list_size', body(['x', 'y', 'x'], [], 'lib.get_animation_list_size()'), () => L.get_animation_list_size(build(['x', 'y', 'x']).lib));

const EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'AnimationLibrary',
  compatModule: 'lib/godot-compat/animation-library',
  cases: c.cases,
};
export default EVIDENCE;
