/**
 * A script's frame and input callbacks as its component's own hooks (docs/GODOT.md §The lane's law,
 * order of work 2): `_process` from `useFrame`; `_physics_process` and a RigidBody3D's `_integrate_forces` from
 * `useBeforePhysicsStep` (the step's own `timestep` is the delta, fixed, so a stall only adds
 * steps); input callbacks from
 * `useGodotInput`. `_process` and `_physics_process` run while the node processes
 * (`godot_node_processes`: inside the tree, not turned off by `set_process`, its process mode
 * allowing), as `SceneTree::_process_group` asks each node. Only the hooks the script defines are
 * written. A script error aborts only its callback (GODOT.md §Order of work): the hook reports it
 * and the frame or step carries on. `_enter_tree`, `_ready` and `_exit_tree` are not hooks of their
 * own: the scene entering the tree (`useGodotScene`, the component's last effect) runs them,
 * parents entering first and children readying first, once the whole scene's scripts are attached,
 * as `add_child` does.
 *
 * `_process` is handed the frame's delta clamped to the plan's bound (`Math.min(delta, 8 / 60)` by
 * default): Godot never advances a frame by more than its maximum physics steps
 * (`main/main.cpp:4951`), so a stall reaches the script as at most that, as a three.js game clamps
 * its frame delta.
 */
import type { BoundGodotLifecycleEntry } from '../../analyze/bound-project';
import type { DirectGodotProcessDeltaPlan } from '../data/direct-project-composition-plan';
import type { TargetTsExpression, TargetTsStatement } from '../code/target-ts-syntax';

/** What the hooks import: React's, R3F's and Rapier's hooks, and compat's (module, name). */
export interface ScriptLifecycleImports {
  readonly react: Set<string>;
  readonly fiber: Set<string>;
  readonly rapier: Set<string>;
  readonly compat: Map<string, string>;
}

const id = (name: string): TargetTsExpression => ({ kind: 'identifier-expression', name });

/** `script.current?.method(...args)`. */
function call(script: string, method: string, args: readonly TargetTsExpression[]): TargetTsExpression {
  return {
    kind: 'call-expression',
    callee: { kind: 'property-expression', object: { kind: 'property-expression', object: id(script), property: 'current' }, property: method, optional: true },
    arguments: args,
  };
}

/**
 * `if (godot_node_processes(script.current, kind)) try { script.current?.method(delta); } catch
 * (error) { console.error(error); }`
 */
function whileProcessing(kind: string, script: string, method: string, delta: TargetTsExpression, imports: ScriptLifecycleImports): TargetTsStatement[] {
  imports.compat.set('godot_node_processes', 'node');
  return [
    {
      kind: 'if-statement',
      condition: {
        kind: 'call-expression',
        callee: id('godot_node_processes'),
        arguments: [{ kind: 'property-expression', object: id(script), property: 'current' }, { kind: 'literal-expression', value: kind }],
      },
      then: [
        {
          kind: 'try-statement',
          body: [{ kind: 'expression-statement', expression: call(script, method, [delta]) }],
          binding: 'error',
          handler: [
            {
              kind: 'expression-statement',
              expression: { kind: 'call-expression', callee: { kind: 'property-expression', object: id('console'), property: 'error' }, arguments: [id('error')] },
            },
          ],
        },
      ],
    },
  ];
}

/** `Math.min(delta, maxSteps / ticksPerSecond)`. */
function clamped(bound: DirectGodotProcessDeltaPlan): TargetTsExpression {
  return {
    kind: 'call-expression',
    callee: { kind: 'property-expression', object: id('Math'), property: 'min' },
    arguments: [
      id('delta'),
      {
        kind: 'binary-expression',
        operator: '/',
        left: { kind: 'literal-expression', value: bound.maxSteps },
        right: { kind: 'literal-expression', value: bound.ticksPerSecond },
      },
    ],
  };
}

function hook(name: string, args: readonly TargetTsExpression[]): TargetTsStatement {
  return { kind: 'expression-statement', expression: { kind: 'call-expression', callee: id(name), arguments: args } };
}

const INPUT_KINDS: Readonly<Record<string, string>> = {
  input: 'input',
  'shortcut-input': 'shortcutInput',
  'unhandled-key-input': 'unhandledKeyInput',
  'unhandled-input': 'unhandledInput',
};

/**
 * The hook statements for a script held in `script` (a ref to the instance) on the node `node`
 * (its element's ref), given the lifecycle methods the script defines and the plan's bound on the
 * process delta.
 */
export function scriptLifecycleHooks(
  script: string,
  node: string,
  lifecycle: readonly BoundGodotLifecycleEntry[],
  imports: ScriptLifecycleImports,
  processDelta: DirectGodotProcessDeltaPlan,
): TargetTsStatement[] {
  const method = (phase: BoundGodotLifecycleEntry['phase']): string | undefined => lifecycle.find((entry) => entry.phase === phase)?.methodName;
  const statements: TargetTsStatement[] = [];
  const process = method('process');
  if (process !== undefined) {
    imports.fiber.add('useFrame');
    statements.push(
      hook('useFrame', [
        {
          kind: 'arrow-expression',
          parameters: [{ name: '_' }, { name: 'delta' }],
          body: whileProcessing('process', script, process, clamped(processDelta), imports),
        },
      ]),
    );
  }
  const physics = method('physics-process');
  if (physics !== undefined) {
    imports.rapier.add('useBeforePhysicsStep');
    statements.push(
      hook('useBeforePhysicsStep', [
        {
          kind: 'arrow-expression',
          parameters: [{ name: 'world' }],
          body: whileProcessing('physics', script, physics, { kind: 'property-expression', object: id('world'), property: 'timestep' }, imports),
        },
      ]),
    );
  }
  const integrate = method('integrate-forces');
  if (integrate !== undefined) {
    imports.rapier.add('useBeforePhysicsStep');
    imports.compat.set('godot_rigid_body_3d_integrate', 'rigid-body-3d');
    statements.push(
      hook('useBeforePhysicsStep', [
        {
          kind: 'arrow-expression',
          parameters: [],
          body: {
            kind: 'call-expression',
            callee: id('godot_rigid_body_3d_integrate'),
            arguments: [
              { kind: 'property-expression', object: id(node), property: 'current' },
              { kind: 'arrow-expression', parameters: [{ name: 'state' }], body: call(script, integrate, [id('state')]) },
            ],
          },
        },
      ]),
    );
  }
  for (const [phase, kind] of Object.entries(INPUT_KINDS)) {
    const handler = method(phase as BoundGodotLifecycleEntry['phase']);
    if (handler === undefined) continue;
    imports.compat.set('useGodotInput', 'react-lifecycle');
    statements.push(
      hook('useGodotInput', [
        id(node),
        { kind: 'literal-expression', value: kind },
        { kind: 'arrow-expression', parameters: [{ name: 'event' }], body: call(script, handler, [id('event')]) },
      ]),
    );
  }
  return statements;
}
