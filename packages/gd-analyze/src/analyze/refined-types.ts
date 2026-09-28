/**
 * Datatypes the project fixes where the official analyzer left a node untyped (`Node`, Variant).
 * Each is what Godot's runtime would find there, found by one of these rules:
 *
 * - `scene-node-receiver`: `$Path` / `%Unique` is the node at that path in every scene the script
 *   is attached to (they must agree): its script class when it carries a script, else its class; so
 *   is `get_node(<literal relative path>)` on self or on a base whose scene path is known, at that
 *   base's path joined with the literal (`Node::get_node`, scene/main/node.cpp:1943). So is a
 *   member `@onready var m = <such an expression>` (optionally `as T`) that nothing assigns again:
 *   its initializer runs once, in the script's `@implicit_ready` as the node becomes ready
 *   (modules/gdscript/gdscript_compiler.cpp:2409), so after that the member holds that node.
 * - `classdb-method-selection`: a member read on a typed object is the member's declared type: a
 *   script field's, else the native property's getter return type (`ClassDB::get_property`). A
 *   dynamic call on a typed receiver returns what the method the receiver's type selects returns
 *   (a built-in's own method, or the ClassDB method up a native class's chain, `ClassDB::get_method`,
 *   core/object/class_db.cpp:1132; never on a scripted receiver, whose script may override it); a
 *   built-in indexed by an int is its indexed getter's type (`indexing_return_type`).
 * - `type-test-narrowing`: a local used where `local is T` has held (the true branch of the `if`,
 *   or the right operand of the `and`, when nothing reassigns it) is a T; `and`, `or` and `not`
 *   over booleans are booleans (`OperatorEvaluatorAnd`, core/variant/variant_op.cpp).
 *
 * - `utility-argument-type`: a Variant-returning utility function that returns its argument's type
 *   (`abs`, `sign`, `floor`, `ceil`, `round`, `clamp`, `lerp`, `snapped`, `wrap`, `min`, `max`,
 *   core/variant/variant_utility.cpp) returns that type when every value argument has the same
 *   built-in type (`lerp`'s weight aside).
 *
 * - `local-assignment-type`: an untyped local declared once in its function, whose initializer and
 *   every value assigned to it there have one built-in type, holds that type (GDScript's Variant
 *   local holds what it was last assigned).
 *
 * - `engine-virtual-parameter`, `signal-handler-parameter`, `call-site-parameter`: a read of an
 *   untyped parameter is the one datatype every caller of its function passes
 *   (`parameter-types.ts`), assigned nowhere in the function.
 *
 * Lowering reads the program with these datatypes in place (`refinedProgram`); a node no rule
 * fixes keeps the analyzer's datatype.
 */
import type { GodotBoundDatatype, GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';
import type { GodotProject, SceneNode } from '../read/godot-types';
import type { GodotApiDump } from './api-dump';
import { type CallReceiverAttachment, resolveScenePath } from './call-receivers';
import type { ParameterType } from './parameter-types';
import { OPERATOR_SPELLING } from './project-setting-types';

/** The analysis rules that fix a datatype the official analyzer left open. */
export type GodotAnalysisRuleId =
  | 'scene-node-receiver'
  | 'classdb-method-selection'
  | 'type-test-narrowing'
  | 'ray-result-schema'
  | 'engine-virtual-parameter'
  | 'signal-handler-parameter'
  | 'call-site-parameter'
  | 'script-method-dispatch'
  | 'member-assignment-type'
  | 'utility-argument-type'
  | 'local-assignment-type';

/** The utility functions whose Variant result has their value arguments' type (`utility-argument-type`). */
const UTILITY_ARGUMENT_TYPED: ReadonlySet<string> = new Set(['abs', 'sign', 'floor', 'ceil', 'round', 'clamp', 'lerp', 'snapped', 'wrap', 'min', 'max']);

/**
 * The Node lookups that return the node at a path: `get_node`, and `get_node_or_null`, which returns
 * the same node where the path resolves (scene/main/node.cpp:1966, :1904).
 */
const NODE_LOOKUPS: ReadonlySet<string> = new Set(['get_node', 'get_node_or_null']);

export interface BoundGodotRefinedType {
  readonly nodeId: number;
  readonly datatype: GodotBoundDatatype;
  /** The rule that fixed it. */
  readonly rule: GodotAnalysisRuleId;
  /** A scene node's datatype (`scene-node-receiver`): the node in each scene the script is attached to. */
  readonly sceneNodes?: readonly { readonly documentPath: string; readonly pathInDocument: string }[];
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
  /** Whether any script of the project assigns a member of this name other than as its own (`obj.name = …`). */
  readonly assignedElsewhere: (member: string) => boolean;
  /** An untyped parameter's datatype from every caller the project has (`parameter-types.ts`). */
  readonly parameterType?: (fn: string, parameter: string) => ParameterType | undefined;
  /** An untyped member's datatype from every value the project stores in it (`member-types.ts`). */
  readonly memberType?: (name: string) => GodotBoundDatatype | undefined;
  /** What a function of a script's chain returns (its declared or inferred datatype). */
  readonly scriptFunctionReturn?: (resPath: string, fn: string) => GodotBoundDatatype | undefined;
  /** Why an expression a rule would type stayed untyped, named for the refusal that follows. */
  readonly untyped?: (nodeId: number, reason: string) => void;
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

export function builtinDatatype(name: string): GodotBoundDatatype {
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
        // An engine signal reads as a Signal (`ClassDB::get_property`, class_db.cpp:1660).
        if (current.signals.some((entry) => entry.name === member)) return apiTypeDatatype(inputs.apiDump, 'Signal');
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

  /** What a method the receiver's type selects returns; undefined for a scripted receiver or void. */
  const methodReturn = (base: GodotBoundDatatype, member: string): GodotBoundDatatype | undefined => {
    if (base.metaType) return undefined;
    let returned: string | undefined;
    if (base.kind === 'BUILTIN') {
      returned = (inputs.apiDump.builtinClasses ?? [])
        .find((entry) => entry.name === base.builtinType)
        ?.methods.find((entry) => entry.name === member)?.return_type;
    } else if (base.kind === 'NATIVE') {
      for (let current = classes.get(base.nativeType); current !== undefined && returned === undefined; ) {
        returned = current.methods.find((entry) => entry.name === member)?.return_type;
        current = current.base_class === '' ? undefined : classes.get(current.base_class);
      }
    }
    if (returned === undefined || returned === '' || returned === 'void' || returned === 'Variant') return undefined;
    return apiTypeDatatype(inputs.apiDump, returned);
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

  let sceneNodes: { readonly documentPath: string; readonly pathInDocument: string }[] = [];
  /** Why the last exported node reference stayed untyped. */
  let exportCause: string | undefined;
  /** The node at `path` in every attached scene, when they agree; `sceneNodes` holds where each is. */
  const sceneNode = (
    path: string | ((attachment: CallReceiverAttachment) => { readonly from: CallReceiverAttachment; readonly path: string } | undefined),
  ): GodotBoundDatatype | undefined => {
    sceneNodes = [];
    if (inputs.attachments.length === 0) return undefined;
    let agreed: GodotBoundDatatype | undefined;
    for (const attachment of inputs.attachments) {
      const own = typeof path === 'string' ? { from: attachment, path } : path(attachment);
      if (own === undefined) return undefined;
      const resolved = resolveScenePath(scenes, own.from, own.path);
      if (typeof resolved === 'string' && typeof path !== 'string') exportCause = resolved;
      if (typeof resolved === 'string') return undefined;
      sceneNodes.push({ documentPath: resolved.documentPath, pathInDocument: resolved.pathInDocument });
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
   * The one built-in type an untyped local holds: declared once in the function that reads it, its
   * initializer and every value assigned to it there (plain or compound) of that type.
   */
  const localAssignedType = (node: Extract<GodotBoundNode, { kind: 'IDENTIFIER' }>): GodotBoundDatatype | undefined => {
    const scope = program.nodes.find((candidate) => candidate.kind === 'FUNCTION' && within(node, candidate));
    if (scope === undefined) return undefined;
    const named = (id: number): boolean => {
      const identifier = nodes.get(id);
      return identifier?.kind === 'IDENTIFIER' && identifier.name === node.name;
    };
    const declarations = program.nodes.filter((candidate) => candidate.kind === 'VARIABLE' && within(candidate, scope) && named(candidate.identifier));
    if (declarations.length !== 1) return undefined;
    const declaration = declarations[0] as Extract<GodotBoundNode, { kind: 'VARIABLE' }>;
    if (declaration.initializer < 0) return undefined;
    const values = [
      declaration.initializer,
      ...program.nodes.flatMap((candidate) => {
        if (candidate.kind !== 'ASSIGNMENT' || !within(candidate, scope)) return [];
        const assignee = nodes.get(candidate.assignee);
        if (assignee?.kind !== 'IDENTIFIER' || assignee.name !== node.name || assignee.source !== 'LOCAL_VARIABLE') return [];
        // A compound assignment's value is the operator's result, which keeps the type only when it is typed.
        return [candidate.operation === 'OP_NONE' ? candidate.assignedValue : candidate.id];
      }),
    ];
    let held: string | undefined;
    for (const value of values) {
      const type = datatypeOf(value);
      const name = type?.kind === 'BUILTIN' && !type.metaType ? type.builtinType : undefined;
      if (name === undefined || name === 'Nil' || (held !== undefined && held !== name)) return undefined;
      held = name;
    }
    return held === undefined ? undefined : builtinDatatype(held);
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

  /**
   * The scene path an `@onready` member of this script holds once ready: its initializer names one
   * statically (through an `as` cast), it has no setter and is not exported (an authored value is
   * replaced as the node becomes ready), and no script assigns it again.
   */
  const onready = new Map<string, string | undefined>();
  const onreadyPath = (name: string): string | undefined => {
    if (onready.has(name)) return onready.get(name);
    onready.set(name, undefined);
    const root = nodes.get(program.rootNodeId);
    if (root?.kind !== 'CLASS') return undefined;
    const declaration = root.members
      .map((member) => nodes.get(member))
      .find((member) => member?.kind === 'VARIABLE' && (() => {
        const identifier = nodes.get(member.identifier);
        return identifier?.kind === 'IDENTIFIER' && identifier.name === name;
      })());
    if (declaration?.kind !== 'VARIABLE' || !declaration.onready || declaration.static || declaration.exported || declaration.setter >= 0) return undefined;
    let initializer = nodes.get(declaration.initializer);
    if (initializer?.kind === 'CAST') initializer = nodes.get(initializer.operand);
    if (initializer === undefined || inputs.assignedElsewhere(name)) return undefined;
    const reassigned = program.nodes.some((other) => {
      if (other.kind !== 'ASSIGNMENT') return false;
      const assignee = nodes.get(other.assignee);
      if (assignee?.kind === 'IDENTIFIER') return assignee.name === name && assignee.source === 'MEMBER_VARIABLE';
      if (assignee?.kind !== 'SUBSCRIPT' || !assignee.isAttribute) return false;
      const attribute = nodes.get(assignee.attribute);
      return attribute?.kind === 'IDENTIFIER' && attribute.name === name;
    });
    if (reassigned) return undefined;
    const path = scenePathOf(initializer.id);
    onready.set(name, path);
    return path;
  };

  /**
   * The path an exported node reference (`@export var target: Node`) holds on one attachment: the
   * `NodePath` its scene node authors in `node_paths`, which Godot resolves to that node as the
   * scene instantiates. Undefined when the member has a setter or is assigned by any script, when
   * the attached node authors no relative path, or when a scene overrides the value on it.
   */
  const exportedDeclaration = (name: string): boolean => {
    const root = nodes.get(program.rootNodeId);
    if (root?.kind !== 'CLASS') return false;
    const declaration = root.members
      .map((member) => nodes.get(member))
      .find((member) => member?.kind === 'VARIABLE' && (() => {
        const identifier = nodes.get(member.identifier);
        return identifier?.kind === 'IDENTIFIER' && identifier.name === name;
      })());
    if (declaration?.kind !== 'VARIABLE' || !declaration.exported || declaration.onready || declaration.static || declaration.setter >= 0) return false;
    if (inputs.assignedElsewhere(name)) return false;
    return !program.nodes.some((other) => {
      if (other.kind !== 'ASSIGNMENT') return false;
      const assignee = nodes.get(other.assignee);
      return assignee?.kind === 'IDENTIFIER' && assignee.name === name && assignee.source === 'MEMBER_VARIABLE';
    });
  };
  const overrides = (attachment: CallReceiverAttachment, name: string): boolean => {
    const patches = (node: { readonly properties: Readonly<Record<string, unknown>>; readonly inheritedNode?: { readonly documentPath: string; readonly nodePath: string }; readonly instanceOf?: string }): boolean =>
      node.properties[name] !== undefined &&
      ((node.inheritedNode?.documentPath === attachment.documentPath && node.inheritedNode.nodePath === attachment.nodePath) ||
        (attachment.nodePath === '.' && node.instanceOf === attachment.documentPath));
    const walk = (node: SceneNode): boolean => patches(node) || node.children.some(walk);
    return [...scenes.values()].some(
      (document) => (document.root !== undefined && walk(document.root)) || document.unplacedNodes.some(patches),
    );
  };
  const exportedPath = (name: string) => (attachment: CallReceiverAttachment): { readonly from: CallReceiverAttachment; readonly path: string } | undefined => {
    const at = `${attachment.documentPath}#${attachment.nodePath}`;
    let node = scenes.get(attachment.documentPath)?.root;
    if (attachment.nodePath !== '.' && attachment.nodePath !== '') {
      for (const segment of attachment.nodePath.split('/')) node = node?.children.find((child) => child.name === segment);
    }
    // An instancing node that authors no value of its own holds the instanced scene root's.
    const seen = new Set<string>();
    while (node !== undefined && !node.nodePathProperties.includes(name) && node.properties[name] === undefined && node.instanceOf !== undefined && !seen.has(node.instanceOf)) {
      seen.add(node.instanceOf);
      node = scenes.get(node.instanceOf)?.root;
    }
    if (node === undefined || !node.nodePathProperties.includes(name)) {
      exportCause = `${at} authors no node path for it`;
      return undefined;
    }
    if (overrides(attachment, name)) {
      exportCause = `a scene instancing ${at} sets it again`;
      return undefined;
    }
    const value = node.properties[name];
    const text = value?.kind === 'ctor' && value.name === 'NodePath' && value.args[0]?.kind === 'string' ? value.args[0].value : undefined;
    if (text === undefined || text === '' || text.startsWith('/') || text.startsWith('%') || text.includes(':')) {
      exportCause = `${at} authors a path that is not relative to it`;
      return undefined;
    }
    // Relative to the attached node, which may climb (`../Player`): walked from the document root.
    const segments: string[] = attachment.nodePath === '.' || attachment.nodePath === '' ? [] : attachment.nodePath.split('/');
    for (const segment of text.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment !== '..') segments.push(segment);
      else if (segments.pop() === undefined) {
        exportCause = `${at}'s path ${text} leaves the scene`;
        return undefined;
      }
    }
    return { from: { documentPath: attachment.documentPath, nodePath: '.' }, path: segments.length === 0 ? '.' : segments.join('/') };
  };

  /**
   * The scene path an expression names, when it names one statically: `$Path` and `%Unique`, self,
   * and `get_node` or `get_node_or_null` of a literal relative path on either.
   */
  const scenePathOf = (id: number): string | undefined => {
    const node = nodes.get(id);
    if (node?.kind === 'GET_NODE') return node.fullPath;
    if (node?.kind === 'SELF') return '.';
    if (node?.kind === 'IDENTIFIER' && node.source === 'MEMBER_VARIABLE') return onreadyPath(node.name);
    if (node?.kind !== 'CALL' || node.compilerTarget.kind !== 'native-method' || !NODE_LOOKUPS.has(node.compilerTarget.member) || node.arguments.length !== 1) return undefined;
    const argument = nodes.get(node.arguments[0] as number);
    if (argument?.kind !== 'LITERAL') return undefined;
    const value = argument.value;
    const text = value.kind === 'string' ? value.value : value.kind === 'opaque' && value.type === 'NodePath' ? value.text : undefined;
    if (text === undefined || text === '' || text.startsWith('/') || text.startsWith('%') || text.includes(':')) return undefined;
    const callee = nodes.get(node.callee);
    const base = callee?.kind === 'SUBSCRIPT' && callee.isAttribute ? scenePathOf(callee.base) : callee?.kind === 'IDENTIFIER' ? '.' : undefined;
    if (base === undefined) return undefined;
    return base === '.' ? text : `${base}/${text}`;
  };

  /** A parameter read's datatype from its function's callers, when nothing in the function assigns it. */
  const parameterTypeOf = (node: Extract<GodotBoundNode, { kind: 'IDENTIFIER' }>): ParameterType | undefined => {
    if (inputs.parameterType === undefined) return undefined;
    const scope = program.nodes.find(
      (candidate) =>
        candidate.kind === 'FUNCTION' &&
        within(node, candidate) &&
        candidate.parameters.some((parameterId) => {
          const parameter = nodes.get(parameterId);
          const identifier = parameter?.kind === 'PARAMETER' ? nodes.get(parameter.identifier) : undefined;
          return identifier?.kind === 'IDENTIFIER' && identifier.name === node.name;
        }),
    );
    if (scope?.kind !== 'FUNCTION') return undefined;
    const fnIdentifier = nodes.get(scope.identifier);
    if (fnIdentifier?.kind !== 'IDENTIFIER') return undefined;
    const reassigned = program.nodes.some((other) => {
      if (other.kind !== 'ASSIGNMENT' || !within(other, scope)) return false;
      const assignee = nodes.get(other.assignee);
      return assignee?.kind === 'IDENTIFIER' && assignee.name === node.name;
    });
    return reassigned ? undefined : inputs.parameterType(fnIdentifier.name, node.name);
  };

  function refine(id: number): BoundGodotRefinedType | undefined {
    if (refined.has(id)) return refined.get(id) ?? undefined;
    refined.set(id, null);
    const node = nodes.get(id);
    let result:
      | {
          readonly datatype: GodotBoundDatatype;
          readonly rule: GodotAnalysisRuleId;
          readonly sceneNodes?: BoundGodotRefinedType['sceneNodes'];
        }
      | undefined;
    const parameter = node?.kind === 'IDENTIFIER' && node.source === 'FUNCTION_PARAMETER' && node.datatype.kind === 'VARIANT' ? parameterTypeOf(node) : undefined;
    const stored =
      node?.kind === 'IDENTIFIER' && (node.source === 'MEMBER_VARIABLE' || node.source === 'INHERITED_VARIABLE') && (node.datatype.kind === 'VARIANT' || node.datatype.typeSource === 'INFERRED') && onreadyPath(node.name) === undefined
        ? inputs.memberType?.(node.name)
        : undefined;
    // Inside `if event is InputEventMouseMotion:` the test's class holds whatever the callers pass.
    const narrowedParameter = parameter !== undefined && node?.kind === 'IDENTIFIER' ? narrowed(node) : undefined;
    if (narrowedParameter !== undefined) {
      result = { datatype: narrowedParameter, rule: 'type-test-narrowing' };
    } else if (parameter !== undefined) {
      result = { datatype: parameter.datatype, rule: parameter.rules[0] as GodotAnalysisRuleId };
    } else if (stored !== undefined) {
      result = { datatype: stored, rule: 'member-assignment-type' };
    } else if (node?.kind === 'GET_NODE') {
      const own = node.datatype;
      const type = sceneNode(node.fullPath);
      if (
        type !== undefined &&
        (own.kind === 'VARIANT' || (own.kind === 'NATIVE' && inherits(type.nativeType, own.nativeType) && (type.kind !== 'NATIVE' || type.nativeType !== own.nativeType)))
      ) {
        result = { datatype: type, rule: 'scene-node-receiver', sceneNodes };
      }
    } else if (node?.kind === 'CALL' && node.compilerTarget.kind === 'native-method' && NODE_LOOKUPS.has(node.compilerTarget.member)) {
      const own = node.datatype;
      const path = scenePathOf(id);
      const type = path === undefined ? undefined : sceneNode(path);
      if (
        type !== undefined &&
        (own.kind === 'VARIANT' || (own.kind === 'NATIVE' && inherits(type.nativeType, own.nativeType) && (type.kind !== 'NATIVE' || type.nativeType !== own.nativeType)))
      ) {
        result = { datatype: type, rule: 'scene-node-receiver', sceneNodes };
      }
    } else if (node?.kind === 'IDENTIFIER' && node.source === 'MEMBER_VARIABLE' && onreadyPath(node.name) !== undefined) {
      // The member holds the node once ready; its declared type (the node's or an ancestor's) stays
      // right, and the node's own class, script and place in the scene are what it holds.
      const own = node.datatype;
      const type = sceneNode(onreadyPath(node.name) as string);
      if (type !== undefined && (own.kind === 'VARIANT' || (own.kind === 'NATIVE' && !own.metaType && inherits(type.nativeType, own.nativeType)))) {
        result = { datatype: type, rule: 'scene-node-receiver', sceneNodes };
      }
    } else if (node?.kind === 'IDENTIFIER' && node.source === 'MEMBER_VARIABLE' && node.datatype.kind === 'NATIVE' && !node.datatype.metaType && exportedDeclaration(node.name)) {
      // An exported node reference holds the node every attached scene's NodePath names.
      const own = node.datatype;
      exportCause = undefined;
      const type = sceneNode(exportedPath(node.name));
      if (type !== undefined && inherits(type.nativeType, own.nativeType) && (type.kind !== 'NATIVE' || type.nativeType !== own.nativeType)) {
        result = { datatype: type, rule: 'scene-node-receiver', sceneNodes };
      } else if (type === undefined) {
        inputs.untyped?.(
          id,
          `the exported \`${node.name}\` holds no one node class: ${exportCause ?? (inputs.attachments.length === 0 ? 'the script is attached to no scene node' : 'the attached scenes assign nodes of different classes, or a path that does not resolve')}`,
        );
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
    } else if (
      node?.kind === 'CALL' &&
      (node.compilerTarget.kind === 'dynamic' || node.compilerTarget.kind === 'unresolved') &&
      node.datatype.kind === 'VARIANT'
    ) {
      const callee = nodes.get(node.callee);
      const base = callee?.kind === 'SUBSCRIPT' && callee.isAttribute ? datatypeOf(callee.base) : undefined;
      // A function of the receiver's script returns what that function declares
      // (`script-method-dispatch`: an override keeps the signature it overrides).
      const scripted =
        base !== undefined && (base.kind === 'CLASS' || base.kind === 'SCRIPT') && !base.metaType && base.scriptPath !== ''
          ? inputs.scriptFunctionReturn?.(base.scriptPath, node.functionName)
          : undefined;
      const type = scripted ?? (base === undefined ? undefined : methodReturn(base, node.functionName));
      if (type !== undefined) result = { datatype: type, rule: scripted !== undefined ? 'script-method-dispatch' : 'classdb-method-selection' };
    } else if (
      node?.kind === 'CALL' &&
      node.compilerTarget.kind === 'variant-utility' &&
      node.datatype.kind === 'VARIANT' &&
      UTILITY_ARGUMENT_TYPED.has(node.compilerTarget.member)
    ) {
      // The value arguments: every one but `lerp`'s weight.
      const values = node.compilerTarget.member === 'lerp' ? node.arguments.slice(0, 2) : node.arguments;
      const types = values.map((argument) => {
        const type = datatypeOf(argument);
        return type?.kind === 'BUILTIN' && !type.metaType ? type.builtinType : undefined;
      });
      const first = types[0];
      if (first !== undefined && first !== 'Nil' && types.every((type) => type === first)) {
        result = { datatype: builtinDatatype(first), rule: 'utility-argument-type' };
      }
    } else if (node?.kind === 'SUBSCRIPT' && !node.isAttribute && node.datatype.kind === 'VARIANT') {
      const base = datatypeOf(node.base);
      const index = datatypeOf(node.index);
      const returned =
        base?.kind === 'BUILTIN' && !base.metaType && index?.kind === 'BUILTIN' && index.builtinType === 'int'
          ? (inputs.apiDump.builtinClasses ?? []).find((entry) => entry.name === base.builtinType)?.indexingReturnType
          : undefined;
      const type = returned === undefined || returned === 'Variant' ? undefined : apiTypeDatatype(inputs.apiDump, returned);
      if (type !== undefined) result = { datatype: type, rule: 'classdb-method-selection' };
    } else if (node?.kind === 'IDENTIFIER' && (node.datatype.kind === 'NATIVE' || node.datatype.kind === 'VARIANT')) {
      const type = narrowed(node);
      if (type !== undefined && (node.datatype.kind === 'VARIANT' || inherits(type.nativeType, node.datatype.nativeType))) {
        result = { datatype: type, rule: 'type-test-narrowing' };
      } else if (node.source === 'LOCAL_VARIABLE' && node.datatype.kind === 'VARIANT') {
        const held = localAssignedType(node);
        if (held !== undefined) result = { datatype: held, rule: 'local-assignment-type' };
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
    } else if (node?.kind === 'ASSIGNMENT' && node.operation !== 'OP_NONE' && node.datatype.kind === 'VARIANT') {
      // A compound assignment's value is the operator's result over the assignee and the value,
      // by Godot's operator table (`Variant::get_operator_return_type`), when that is the
      // assignee's own type.
      const left = datatypeOf(node.assignee);
      const right = datatypeOf(node.assignedValue);
      const leftType = left?.kind === 'BUILTIN' ? left.builtinType : undefined;
      const rightType = right?.kind === 'BUILTIN' ? right.builtinType : right?.kind === 'ENUM' ? 'int' : undefined;
      const spelling = OPERATOR_SPELLING[node.variantOperatorId];
      const returnType =
        leftType === undefined || rightType === undefined
          ? undefined
          : (inputs.apiDump.builtinClasses ?? []).find((entry) => entry.name === leftType)?.operatorSignatures?.find((entry) => entry.name === spelling && entry.rightType === rightType)?.returnType;
      if (returnType !== undefined && returnType === leftType) {
        result = { datatype: builtinDatatype(returnType), rule: 'type-test-narrowing' };
      }
    } else if (node?.kind === 'UNARY_OPERATOR' && node.variantOperatorId === OP_NOT && node.datatype.kind === 'VARIANT') {
      const operand = datatypeOf(node.operand);
      if (operand?.kind === 'BUILTIN' && operand.builtinType === 'bool') {
        result = { datatype: builtinDatatype('bool'), rule: 'type-test-narrowing' };
      }
    } else if (node?.kind === 'UNARY_OPERATOR' && node.datatype.kind === 'VARIANT') {
      // A negation (`-event.relative.x`) of a value the refinement typed has the result type
      // Godot's operator table states for it (`unary-`, no right operand).
      const operand = datatypeOf(node.operand);
      const spelling = OPERATOR_SPELLING[node.variantOperatorId];
      const returnType =
        operand?.kind === 'BUILTIN' && !operand.metaType && spelling?.startsWith('unary') === true
          ? (inputs.apiDump.builtinClasses ?? [])
              .find((entry) => entry.name === operand.builtinType)
              ?.operatorSignatures?.find((entry) => entry.name === spelling && entry.rightType === undefined)?.returnType
          : undefined;
      if (returnType !== undefined && returnType !== 'Variant') {
        result = { datatype: builtinDatatype(returnType), rule: 'type-test-narrowing' };
      }
    }
    if (result === undefined) return undefined;
    const entry: BoundGodotRefinedType = {
      nodeId: id,
      datatype: result.datatype,
      rule: result.rule,
      ...(result.sceneNodes === undefined ? {} : { sceneNodes: result.sceneNodes }),
    };
    refined.set(id, entry);
    return entry;
  }

  for (const node of program.nodes) refine(node.id);
  return [...refined.values()].filter((entry): entry is BoundGodotRefinedType => entry !== null).sort((a, b) => a.nodeId - b.nodeId);
}
