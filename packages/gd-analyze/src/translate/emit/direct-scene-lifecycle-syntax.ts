import type { BoundGodotLifecyclePhase } from '../../analyze/bound-project';
import type { TargetTsExpression, TargetTsStatement, TargetTsType } from '../code/target-ts-syntax';
import type { DirectGodotScriptInstancePlan } from '../data/direct-project-composition-plan';

export interface DirectGodotSceneScriptBinding {
  readonly index: number;
  readonly nodePath: string;
  readonly instance: DirectGodotScriptInstancePlan;
}

function unreachable(value: never): never {
  throw new Error(`unhandled direct lifecycle value: ${JSON.stringify(value)}`);
}

function referenceType(name: string): TargetTsType {
  return { kind: 'type-reference', name, arguments: [] };
}

function nullable(type: TargetTsType): TargetTsType {
  return { kind: 'union-type', members: [type, { kind: 'literal-type', value: null }] };
}

function property(object: string | TargetTsExpression, member: string): TargetTsExpression {
  return {
    kind: 'property-expression',
    object: typeof object === 'string' ? { kind: 'identifier-expression', name: object } : object,
    property: member,
  };
}

function assignment(target: TargetTsExpression, value: TargetTsExpression): TargetTsStatement {
  return {
    kind: 'expression-statement',
    expression: { kind: 'assignment-expression', operator: '=', target, value },
  };
}

function fieldLiteral(field: DirectGodotScriptInstancePlan['fields'][number]): TargetTsExpression {
  switch (field.value.kind) {
    case 'boolean':
    case 'number':
    case 'string':
      return { kind: 'literal-expression', value: field.value.value };
    default:
      return unreachable(field.value);
  }
}

export function directGodotScriptBindingDeclarations(
  binding: DirectGodotSceneScriptBinding,
): readonly TargetTsStatement[] {
  const suffix = String(binding.index);
  return [
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: `$node_${suffix}`,
      initializer: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: 'useRef' },
        typeArguments: [nullable(referenceType('Group'))],
        arguments: [{ kind: 'literal-expression', value: null }],
      },
    },
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: `$script_${suffix}`,
      initializer: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: 'useRef' },
        typeArguments: [nullable(referenceType(`$Script_${suffix}`))],
        arguments: [{ kind: 'literal-expression', value: null }],
      },
    },
  ];
}

function nullGuard(name: string, message: string): TargetTsStatement {
  return {
    kind: 'if-statement',
    condition: {
      kind: 'binary-expression',
      operator: '===',
      left: { kind: 'identifier-expression', name },
      right: { kind: 'literal-expression', value: null },
    },
    // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
    then: [
      {
        kind: 'throw-statement',
        expression: {
          kind: 'new-expression',
          callee: { kind: 'identifier-expression', name: 'Error' },
          arguments: [{ kind: 'literal-expression', value: message }],
        },
      },
    ],
  };
}

function bindingInitialization(
  binding: DirectGodotSceneScriptBinding,
): readonly TargetTsStatement[] {
  const suffix = String(binding.index);
  const native = `$native_${suffix}`;
  const instance = `$instance_${suffix}`;
  return [
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: native,
      initializer: property(`$node_${suffix}`, 'current'),
    },
    nullGuard(native, 'Godot native script node was not mounted.'),
    {
      kind: 'variable-statement',
      declaration: 'const',
      name: instance,
      initializer: {
        kind: 'new-expression',
        callee: { kind: 'identifier-expression', name: `$Script_${suffix}` },
        arguments: [{ kind: 'identifier-expression', name: native }],
      },
    },
    ...binding.instance.fields.map((field) =>
      assignment(property(instance, field.fieldName), fieldLiteral(field)),
    ),
    ...binding.instance.autoloadReferences.flatMap((reference) => {
      const autoload = `$autoload_${suffix}_${reference.name}`;
      return [
        {
          kind: 'variable-statement' as const,
          declaration: 'const' as const,
          name: autoload,
          initializer: property(property('$autoloads', reference.name), 'current'),
        },
        nullGuard(autoload, `Godot autoload ${reference.name} was not mounted.`),
        assignment(property(instance, reference.fieldName), {
          kind: 'identifier-expression',
          name: autoload,
        }),
      ];
    }),
    assignment(property(`$script_${suffix}`, 'current'), {
      kind: 'identifier-expression',
      name: instance,
    }),
  ];
}

/** `argument`: the callback's one parameter (a frame's delta, an input event), passed through. */
function lifecycleCallback(instance: string, method: string, argument?: string): TargetTsExpression {
  return {
    kind: 'arrow-expression',
    parameters: argument === undefined ? [] : [{ name: argument }],
    body: {
      kind: 'call-expression',
      callee: property(instance, method),
      arguments: argument === undefined ? [] : [{ kind: 'identifier-expression', name: argument }],
    },
  };
}

function lifecycleBinding(binding: DirectGodotSceneScriptBinding): TargetTsExpression {
  const suffix = String(binding.index);
  const instance = `$instance_${suffix}`;
  const method = (phase: BoundGodotLifecyclePhase): string | undefined =>
    binding.instance.lifecycle.find((entry) => entry.phase === phase)?.methodName;
  // Each phase's binding key and its callback's parameter (`node.ts` GodotScriptLifecycleBinding).
  const callbacks = [
    ['enterTree', method('enter-tree'), undefined],
    ['ready', method('ready'), undefined],
    ['exitTree', method('exit-tree'), undefined],
    ['process', method('process'), 'delta'],
    ['physicsProcess', method('physics-process'), 'delta'],
    ['input', method('input'), 'event'],
    ['shortcutInput', method('shortcut-input'), 'event'],
    ['unhandledInput', method('unhandled-input'), 'event'],
    ['unhandledKeyInput', method('unhandled-key-input'), 'event'],
  ] as const;
  return {
    kind: 'object-expression',
    properties: [
      { key: 'native', value: { kind: 'identifier-expression', name: `$native_${suffix}` } },
      { key: 'owner', value: { kind: 'identifier-expression', name: instance } },
      ...callbacks.flatMap(([key, methodName, argument]) =>
        methodName === undefined ? [] : [{ key, value: lifecycleCallback(instance, methodName, argument) }],
      ),
    ],
  };
}

export function directGodotSceneLifecycleEffect(
  bindings: readonly DirectGodotSceneScriptBinding[],
  rootNodeRef: string,
  /** Authored connections, made once every script instance exists; released with the scene. */
  connections: { readonly make: readonly TargetTsStatement[]; readonly release: readonly TargetTsStatement[] } = {
    make: [],
    release: [],
  },
): TargetTsStatement {
  return {
    kind: 'expression-statement',
    expression: {
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: 'useGodotScriptTreeAttachment' },
      arguments: [
        { kind: 'identifier-expression', name: rootNodeRef },
        {
          kind: 'arrow-expression',
          parameters: [],
          body: [
            ...bindings.flatMap(bindingInitialization),
            ...connections.make,
            {
              kind: 'return-statement',
              expression: {
                kind: 'object-expression',
                properties: [
                  {
                    key: 'bindings',
                    value: { kind: 'array-expression', elements: bindings.map(lifecycleBinding) },
                  },
                  {
                    key: 'release',
                    value: {
                      kind: 'arrow-expression',
                      parameters: [],
                      body: [
                        ...connections.release,
                        ...bindings.map((binding) =>
                          assignment(property(`$script_${binding.index}`, 'current'), {
                            kind: 'literal-expression',
                            value: null,
                          }),
                        ),
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}
