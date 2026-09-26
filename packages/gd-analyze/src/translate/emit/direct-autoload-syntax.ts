import type { TargetTsExpression, TargetTsStatement } from '../code/target-ts-syntax';
import type {
  DirectGodotAutoloadReferencePlan,
  DirectGodotProjectCompositionPlan,
  DirectGodotSceneNodePlan,
} from '../data/direct-project-composition-plan';

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

function mountedGuard(reference: string, name: string): TargetTsStatement {
  return {
    kind: 'if-statement',
    condition: {
      kind: 'binary-expression',
      operator: '===',
      left: property(reference, 'current'),
      right: { kind: 'literal-expression', value: null },
    },
    // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
    then: [
      {
        kind: 'throw-statement',
        expression: {
          kind: 'new-expression',
          callee: { kind: 'identifier-expression', name: 'Error' },
          arguments: [
            { kind: 'literal-expression', value: `Godot autoload ${name} was not mounted.` },
          ],
        },
      },
    ],
  };
}

export function directGodotSceneAutoloadContextName(sceneExportName: string): string {
  return `${sceneExportName}Autoloads`;
}

export function directGodotSceneAutoloadReferences(
  node: DirectGodotSceneNodePlan,
): readonly DirectGodotAutoloadReferencePlan[] {
  const references = new Map<string, DirectGodotAutoloadReferencePlan>();
  const visit = (candidate: DirectGodotSceneNodePlan): void => {
    for (const reference of candidate.scriptInstance?.autoloadReferences ?? []) {
      const prior = references.get(reference.name);
      if (prior !== undefined && prior.resPath !== reference.resPath) {
        throw new Error(
          `autoload ${reference.name} resolves to both ${prior.resPath} and ${reference.resPath}`,
        );
      }
      references.set(reference.name, reference);
    }
    for (const child of candidate.children) visit(child);
  };
  visit(node);
  return [...references.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function directGodotAutoloadIndex(
  composition: DirectGodotProjectCompositionPlan,
  reference: DirectGodotAutoloadReferencePlan,
): number {
  const index = composition.scriptAutoloads.findIndex(
    (autoload) =>
      autoload.singleton &&
      autoload.name === reference.name &&
      autoload.scriptResPath === reference.resPath,
  );
  if (index < 0) {
    throw new Error(`${reference.name}: singleton ${reference.resPath} is absent from composition`);
  }
  return index;
}

/** Direct per-project field assignments performed after every retained autoload exists. */
export function directGodotAutoloadPreparation(
  composition: DirectGodotProjectCompositionPlan,
): readonly TargetTsStatement[] {
  return composition.scriptAutoloads.flatMap((autoload, ownerIndex) =>
    autoload.autoloadReferences.flatMap((reference) => {
      const targetIndex = directGodotAutoloadIndex(composition, reference);
      const owner = `$autoloadInstance_${ownerIndex}`;
      const target = `$autoloadInstance_${targetIndex}`;
      return [
        mountedGuard(owner, autoload.name),
        mountedGuard(target, reference.name),
        assignment(
          property(property(owner, 'current'), reference.fieldName),
          property(target, 'current'),
        ),
      ];
    }),
  );
}
