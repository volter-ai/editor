/**
 * Datatypes the project fixes where the official analyzer left a node untyped (`Node`, Variant).
 * Each is what Godot's runtime would find there, and the rule that finds it is evidenced:
 *
 * - `scene-node-receiver`: `$Path` / `%Unique` is the node at that path in every scene the script
 *   is attached to (they must agree): its script class when it carries a script, else its class.
 * - `classdb-method-selection`: a member read on a typed object is the member's declared type: a
 *   script field's, else the native property's getter return type (`ClassDB::get_property`).
 * - `type-test-narrowing`: a local used where `local is T` has held (the true branch of the `if`,
 *   or the right operand of the `and`, when nothing reassigns it) is a T; `and`, `or` and `not`
 *   over booleans are booleans (`OperatorEvaluatorAnd`, core/variant/variant_op.cpp).
 *
 * Lowering reads the program with these datatypes in place (`refinedProgram`); a node no rule
 * fixes keeps the analyzer's datatype.
 */
import type { GodotBoundDatatype, GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';
import type { GodotProject } from '../read/godot-types';
import type { GodotApiDump } from './api-dump';
import type { GodotAnalysisRuleId } from './authority';
import { type CallReceiverAttachment, resolveScenePath } from './call-receivers';
import { OPERATOR_SPELLING } from './project-setting-types';

export interface BoundGodotRefinedType {
  readonly nodeId: number;
  readonly datatype: GodotBoundDatatype;
  readonly rule: GodotAnalysisRuleId;
  readonly evidenceClaimIds: readonly string[];
}

export interface RefinedScriptInfo {
  /** The script's global class name, or '' for an unnamed script. */
  readonly className: string;
  /** The native class at the root of its chain. */
  readonly nativeBase: string;
  /** A member variable's declared datatype, up the script chain. */
  readonly fieldType: (name: string) => GodotBoundDatatype | undefined;
}

export interface RefineInputs {
  readonly program: GodotBoundScript;
  readonly attachments: readonly CallReceiverAttachment[];
  readonly read: Pick<GodotProject, 'scenes'>;
  readonly apiDump: GodotApiDump;
  /** The script attached at an exact (document, node path). */
  readonly scriptAt: (documentPath: string, nodePath: string) => string | undefined;
  readonly scriptInfo: (resPath: string) => RefinedScriptInfo | undefined;
  readonly claim: (rule: GodotAnalysisRuleId) => string | undefined;
}

const BASE: Omit<GodotBoundDatatype, 'kind' | 'display' | 'builtinType' | 'nativeType' | 'enumType' | 'scriptPath' | 'className'> = {
  typeSource: 'INFERRED',
  constant: false,
  readOnly: false,
  metaType: false,
  pseudoType: false,
  coroutine: false,
  containerTypes: [],
  enumValues: [],
};

export function nativeDatatype(name: string): GodotBoundDatatype {
  return { ...BASE, kind: 'NATIVE', display: name, builtinType: 'Object', nativeType: name, enumType: '', scriptPath: '', className: '' };
}

export function scriptDatatype(resPath: string, info: RefinedScriptInfo): GodotBoundDatatype {
  return {
    ...BASE,
    kind: 'CLASS',
    display: info.className === '' ? resPath : info.className,
    builtinType: 'Object',
    nativeType: info.nativeBase,
    enumType: '',
    scriptPath: resPath,
    className: info.className,
  };
}

function builtinDatatype(name: string): GodotBoundDatatype {
  return { ...BASE, kind: 'BUILTIN', display: name, builtinType: name, nativeType: '', enumType: '', scriptPath: '', className: '' };
}

/** An API dump type (`bool`, `Node3D`, `enum::DirectionalLight3D.SkyMode`) as a datatype. */
export function apiTypeDatatype(apiDump: GodotApiDump, name: string): GodotBoundDatatype | undefined {
  if (name.startsWith('enum::')) {
    const qualified = name.slice('enum::'.length);
    const dot = qualified.lastIndexOf('.');
    if (dot < 0) return undefined;
    return {
      ...BASE,
      kind: 'ENUM',
      display: qualified,
      builtinType: 'int',
      nativeType: qualified,
      enumType: qualified.slice(dot + 1),
      scriptPath: '',
      className: '',
    };
  }
  if (name.includes('::')) return undefined;
  if ((apiDump.builtinClasses ?? []).some((entry) => entry.name === name) && name !== 'Nil') return builtinDatatype(name);
  if (apiDump.classes.some((entry) => entry.name === name)) return nativeDatatype(name);
  return undefined;
}

function within(inner: GodotBoundNode, outer: GodotBoundNode): boolean {
  return (
    (inner.startLine > outer.startLine || (inner.startLine === outer.startLine && inner.startColumn >= outer.startColumn)) &&
    (inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn))
  );
}

/**
 * The keys `PhysicsDirectSpaceState3D::intersect_ray` fills in its result Dictionary and their
 * Variant types (`servers/physics_server_3d.cpp:374`): `RayResult`'s `position`/`normal`
 * (Vector3), `face_index`/`shape` (int) and `collider_id` (an ObjectID, stored as int). `collider`
 * and `rid` are not typed.
 */
const RAY_RESULT_KEYS: Readonly<Record<string, string>> = {
  position: 'Vector3',
  normal: 'Vector3',
  face_index: 'int',
  shape: 'int',
  collider_id: 'int',
};

/** `Variant::OP_AND` / `OP_OR` / `OP_NOT` (`core/variant/variant.h:566`). */
const OP_AND = 20;
const OP_OR = 21;
const OP_NOT = 23;

export function refineDatatypes(inputs: RefineInputs): readonly BoundGodotRefinedType[] {
  const program = inputs.program;
  const nodes = new Map(program.nodes.map((node) => [node.id, node] as const));
  const classes = new Map(inputs.apiDump.classes.map((entry) => [entry.name, entry] as const));
  const scenes = new Map(inputs.read.scenes.map((scene) => [scene.resPath, scene] as const));
  const inherits = (name: string, ancestor: string): boolean => {
    for (let current = classes.get(name); current !== undefined; ) {
      if (current.name === ancestor) return true;
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return false;
  };
  const refined = new Map<number, BoundGodotRefinedType | null>();

  const datatypeOf = (id: number): GodotBoundDatatype | undefined => {
    const own = refine(id);
    return own?.datatype ?? nodes.get(id)?.datatype;
  };

  /** The object datatype a member is read on: its native class and, when scripted, its script. */
  const memberType = (base: GodotBoundDatatype, member: string): GodotBoundDatatype | undefined => {
    if (base.kind === 'BUILTIN' && !base.metaType) {
      // A built-in's member (`transform.origin`) has the type the API dump states for it.
      const type = (inputs.apiDump.builtinClasses ?? [])
        .find((entry) => entry.name === base.builtinType)
        ?.members.find((entry) => entry.name === member)?.type;
      return type === undefined ? undefined : apiTypeDatatype(inputs.apiDump, type);
    }
    if (base.kind === 'CLASS' || base.kind === 'SCRIPT') {
      const field = base.scriptPath === '' ? undefined : inputs.scriptInfo(base.scriptPath)?.fieldType(member);
      if (field !== undefined) return field;
    }
    if ((base.kind === 'NATIVE' || base.kind === 'CLASS' || base.kind === 'SCRIPT') && !base.metaType) {
      for (let current = classes.get(base.nativeType); current !== undefined; ) {
        const property = current.properties.find((entry) => entry.name === member);
        if (property !== undefined) {
          if (property.getter === undefined) return undefined;
          const getter = property.getter;
          let owner: typeof current | undefined = current;
          while (owner !== undefined) {
            const method = owner.methods.find((entry) => entry.name === getter);
            if (method !== undefined) return apiTypeDatatype(inputs.apiDump, method.return_type);
            owner = owner.base_class === '' ? undefined : classes.get(owner.base_class);
          }
          return undefined;
        }
        current = current.base_class === '' ? undefined : classes.get(current.base_class);
      }
    }
    return undefined;
  };

  /** The type `name is T` establishes, when `test` is such a test or an `and` of them. */
  const testedType = (id: number, name: string): GodotBoundDatatype | undefined => {
    const node = nodes.get(id);
    if (node?.kind === 'TYPE_TEST') {
      const operand = nodes.get(node.operand);
      if (operand?.kind !== 'IDENTIFIER' || operand.name !== name) return undefined;
      const tested = node.testDatatype;
      if ((tested.kind === 'CLASS' || tested.kind === 'SCRIPT') && tested.scriptPath !== '') {
        const info = inputs.scriptInfo(tested.scriptPath);
        return info === undefined ? undefined : scriptDatatype(tested.scriptPath, info);
      }
      if (tested.kind === 'NATIVE' && tested.nativeType !== '' && !tested.metaType) return nativeDatatype(tested.nativeType);
      return undefined;
    }
    if (node?.kind === 'BINARY_OPERATOR' && node.variantOperatorId === OP_AND) {
      return testedType(node.leftOperand, name) ?? testedType(node.rightOperand, name);
    }
    return undefined;
  };

  const narrowed = (node: Extract<GodotBoundNode, { kind: 'IDENTIFIER' }>): GodotBoundDatatype | undefined => {
    if (node.source !== 'LOCAL_VARIABLE' && node.source !== 'FUNCTION_PARAMETER') return undefined;
    for (const candidate of program.nodes) {
      let region: GodotBoundNode | undefined;
      let test: number | undefined;
      if (candidate.kind === 'IF') {
        region = nodes.get(candidate.trueBlock);
        test = candidate.condition;
      } else if (candidate.kind === 'BINARY_OPERATOR' && candidate.variantOperatorId === OP_AND) {
        region = nodes.get(candidate.rightOperand);
        test = candidate.leftOperand;
      }
      if (region === undefined || test === undefined || !within(node, region)) continue;
      const type = testedType(test, node.name);
      if (type === undefined) continue;
      const reassigned = program.nodes.some((other) => {
        if (other.kind !== 'ASSIGNMENT' || !within(other, region as GodotBoundNode)) return false;
        const assignee = nodes.get(other.assignee);
        return assignee?.kind === 'IDENTIFIER' && assignee.name === node.name;
      });
      if (!reassigned) return type;
    }
    return undefined;
  };

  const sceneNode = (path: string): GodotBoundDatatype | undefined => {
    if (inputs.attachments.length === 0) return undefined;
    let agreed: GodotBoundDatatype | undefined;
    for (const attachment of inputs.attachments) {
      const resolved = resolveScenePath(scenes, attachment, path);
      if (typeof resolved === 'string') return undefined;
      const script = inputs.scriptAt(resolved.documentPath, resolved.pathInDocument);
      const info = script === undefined ? undefined : inputs.scriptInfo(script);
      const type =
        script === undefined ? nativeDatatype(resolved.className) : info === undefined ? undefined : scriptDatatype(script, info);
      if (type === undefined) return undefined;
      if (agreed !== undefined && (agreed.kind !== type.kind || agreed.nativeType !== type.nativeType || agreed.scriptPath !== type.scriptPath)) {
        return undefined;
      }
      agreed = type;
    }
    return agreed;
  };

  /**
   * Whether a local is the result of `intersect_ray`: declared, in the function that reads it, by
   * `var name := <space state>.intersect_ray(...)` and never assigned again there.
   */
  const rayResult = (node: Extract<GodotBoundNode, { kind: 'IDENTIFIER' }>): boolean => {
    if (node.source !== 'LOCAL_VARIABLE') return false;
    const scope = program.nodes.find((candidate) => candidate.kind === 'FUNCTION' && within(node, candidate));
    if (scope === undefined) return false;
    const declarations = program.nodes.filter(
      (candidate) =>
        candidate.kind === 'VARIABLE' &&
        within(candidate, scope) &&
        (() => {
          const identifier = nodes.get(candidate.identifier);
          return identifier?.kind === 'IDENTIFIER' && identifier.name === node.name;
        })(),
    );
    if (declarations.length !== 1) return false;
    const declaration = declarations[0] as Extract<GodotBoundNode, { kind: 'VARIABLE' }>;
    const initializer = nodes.get(declaration.initializer);
    if (
      initializer?.kind !== 'CALL' ||
      initializer.compilerTarget.kind !== 'native-method' ||
      initializer.compilerTarget.owner !== 'PhysicsDirectSpaceState3D' ||
      initializer.compilerTarget.member !== 'intersect_ray'
    ) {
      return false;
    }
    return !program.nodes.some((other) => {
      if (other.kind !== 'ASSIGNMENT' || !within(other, scope)) return false;
      const assignee = nodes.get(other.assignee);
      return assignee?.kind === 'IDENTIFIER' && assignee.name === node.name;
    });
  };

  function refine(id: number): BoundGodotRefinedType | undefined {
    if (refined.has(id)) return refined.get(id) ?? undefined;
    refined.set(id, null);
    const node = nodes.get(id);
    let result: { readonly datatype: GodotBoundDatatype; readonly rule: GodotAnalysisRuleId } | undefined;
    if (node?.kind === 'GET_NODE') {
      const own = node.datatype;
      const type = sceneNode(node.fullPath);
      if (
        type !== undefined &&
        (own.kind === 'VARIANT' || (own.kind === 'NATIVE' && inherits(type.nativeType, own.nativeType) && (type.kind !== 'NATIVE' || type.nativeType !== own.nativeType)))
      ) {
        result = { datatype: type, rule: 'scene-node-receiver' };
      }
    } else if (node?.kind === 'SUBSCRIPT' && node.isAttribute && (node.datatype.kind === 'VARIANT' || node.datatype.kind === 'UNRESOLVED')) {
      const base = datatypeOf(node.base);
      const attribute = nodes.get(node.attribute);
      const baseNode = nodes.get(node.base);
      const rayKey = attribute?.kind === 'IDENTIFIER' ? RAY_RESULT_KEYS[attribute.name] : undefined;
      if (
        base?.kind === 'BUILTIN' &&
        base.builtinType === 'Dictionary' &&
        baseNode?.kind === 'IDENTIFIER' &&
        rayKey !== undefined &&
        rayResult(baseNode)
      ) {
        result = { datatype: builtinDatatype(rayKey), rule: 'ray-result-schema' };
      } else if (base !== undefined && attribute?.kind === 'IDENTIFIER') {
        const type = memberType(base, attribute.name);
        if (type !== undefined) result = { datatype: type, rule: 'classdb-method-selection' };
      }
    } else if (node?.kind === 'IDENTIFIER' && (node.datatype.kind === 'NATIVE' || node.datatype.kind === 'VARIANT')) {
      const type = narrowed(node);
      if (type !== undefined && (node.datatype.kind === 'VARIANT' || inherits(type.nativeType, node.datatype.nativeType))) {
        result = { datatype: type, rule: 'type-test-narrowing' };
      }
    } else if (node?.kind === 'BINARY_OPERATOR' && node.datatype.kind === 'VARIANT') {
      const left = datatypeOf(node.leftOperand);
      const right = datatypeOf(node.rightOperand);
      const leftType = left?.kind === 'BUILTIN' ? left.builtinType : left?.kind === 'ENUM' ? 'int' : undefined;
      const rightType = right?.kind === 'BUILTIN' ? right.builtinType : right?.kind === 'ENUM' ? 'int' : undefined;
      if (node.variantOperatorId === OP_AND || node.variantOperatorId === OP_OR) {
        if (leftType === 'bool' && rightType === 'bool') {
          result = { datatype: builtinDatatype('bool'), rule: 'type-test-narrowing' };
        }
      } else if (leftType !== undefined && rightType !== undefined) {
        // An operator over values the refinement typed has the result type Godot's operator table
        // states for those operand types (`Variant::get_operator_return_type`).
        const spelling = OPERATOR_SPELLING[node.variantOperatorId];
        const returnType = (inputs.apiDump.builtinClasses ?? [])
          .find((entry) => entry.name === leftType)
          ?.operatorSignatures?.find((entry) => entry.name === spelling && entry.rightType === rightType)?.returnType;
        if (returnType !== undefined && returnType !== 'Variant') {
          result = { datatype: builtinDatatype(returnType), rule: 'type-test-narrowing' };
        }
      }
    } else if (node?.kind === 'ASSIGNMENT' && node.operation === 'OP_NONE' && node.datatype.kind === 'VARIANT') {
      // A plain assignment's value is the assigned value: typed by the rule that typed that value
      // when it is the assignee's type.
      const value = refine(node.assignedValue);
      const assignee = datatypeOf(node.assignee);
      if (
        value !== undefined &&
        value.datatype.kind === 'BUILTIN' &&
        assignee?.kind === 'BUILTIN' &&
        assignee.builtinType === value.datatype.builtinType
      ) {
        result = { datatype: value.datatype, rule: value.rule };
      }
    } else if (node?.kind === 'UNARY_OPERATOR' && node.variantOperatorId === OP_NOT && node.datatype.kind === 'VARIANT') {
      const operand = datatypeOf(node.operand);
      if (operand?.kind === 'BUILTIN' && operand.builtinType === 'bool') {
        result = { datatype: builtinDatatype('bool'), rule: 'type-test-narrowing' };
      }
    }
    if (result === undefined) return undefined;
    const claim = inputs.claim(result.rule);
    if (claim === undefined) return undefined;
    const entry = { nodeId: id, datatype: result.datatype, rule: result.rule, evidenceClaimIds: [claim] };
    refined.set(id, entry);
    return entry;
  }

  for (const node of program.nodes) refine(node.id);
  return [...refined.values()].filter((entry): entry is BoundGodotRefinedType => entry !== null).sort((a, b) => a.nodeId - b.nodeId);
}
