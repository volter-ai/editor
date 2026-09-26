/**
 * Receiver typing for calls the official compiler left dynamic.
 *
 * Godot's compiler selects a method only when the receiver's type is hard. `$Path.play()` is typed
 * `Node` statically, so the compiler emits a dynamic call and Godot's VM selects `play` at runtime
 * from the receiver's real class (`Object::callp` → `ClassDB::get_method`, walking the class
 * ancestry). This pass reproduces that runtime selection at compile time wherever the project
 * fixes the receiver's class, and only there:
 *
 * - `scene-node-receiver`: a `$Path` / `get_node("Path")` base resolves, in EVERY scene the script
 *   is attached to, to a node of one class (descending into instanced scenes and imported models
 *   as Godot's tree does). A node that carries a script defining the member is not typed here:
 *   Godot would call the script first (`Object::callp` checks the script instance before ClassDB).
 * - `classdb-method-selection`: with the receiver's class known (from the rule above, or from a
 *   call this pass or the compiler already selected), the member is the first class in the
 *   ancestry that declares it, carrying that method's bind hash — the identity the official
 *   compiler records for the same call when it is typed.
 *
 * Each typed call carries the claims of the rules it used; a rule without a live claim leaves the
 * call untyped with its reason, and code lowering refuses it at its source location. Nothing here
 * guesses: an unknown base, disagreeing attachments, a script-owned member or a path this pass
 * cannot follow stays untyped.
 */
import type { GodotApiDump } from './api-dump';
import type { GodotAnalysisRuleId } from './authority';
import type {
  GodotBoundCallNode,
  GodotBoundNode,
  GodotBoundScript,
} from '../godot-frontend/bound-program';
import type { GodotProject, SceneDocument, SceneNode } from '../read/godot-types';

export interface BoundGodotCallReceiver {
  readonly nodeId: number;
  readonly target: {
    readonly kind: 'native-member' | 'builtin-member';
    readonly owner: string;
    readonly member: string;
    readonly signatureHash: number;
  };
  /** The selected method's declared return type, as the API dump spells it. */
  readonly returnType: string;
  readonly evidenceClaimIds: readonly string[];
}

export interface BoundGodotUntypedCall {
  readonly nodeId: number;
  readonly reason: string;
}

export interface CallReceiverAttachment {
  readonly documentPath: string;
  readonly nodePath: string;
}

export interface CallReceiverInputs {
  readonly program: GodotBoundScript;
  readonly attachments: readonly CallReceiverAttachment[];
  readonly read: Pick<GodotProject, 'scenes'>;
  readonly apiDump: GodotApiDump;
  /** Scripts attached at an exact (document, node path), with the method names each declares. */
  readonly scriptMethodsAt: (documentPath: string, nodePath: string) => ReadonlySet<string> | undefined;
  /** `self`'s native class and the script chain's own methods, when the chain has a native root. */
  readonly self?: { readonly nativeClass: string; readonly scriptMethods: ReadonlySet<string> };
  /** The live claim for a rule, or undefined when the rule has no live evidence. */
  readonly claim: (rule: GodotAnalysisRuleId) => string | undefined;
}

type ReceiverType =
  | { readonly kind: 'builtin'; readonly name: string }
  | {
      readonly kind: 'native';
      readonly name: string;
      readonly claims: readonly string[];
      /** Members a script on the receiver declares: Godot calls those, not ClassDB's. */
      readonly scriptMembers?: ReadonlySet<string>;
    }
  | { readonly kind: 'unknown'; readonly reason: string };

export interface ResolvedSceneNode {
  readonly className: string;
  readonly documentPath: string;
  readonly pathInDocument: string;
}

function childPath(parent: string, name: string): string {
  return parent === '.' || parent === '' ? name : `${parent}/${name}`;
}

/** Follow one relative node path from an attachment point, as SceneTree lookups do. */
export function resolveScenePath(
  scenes: ReadonlyMap<string, SceneDocument>,
  attachment: CallReceiverAttachment,
  path: string,
): ResolvedSceneNode | string {
  const document = scenes.get(attachment.documentPath);
  if (document?.root === undefined) return `scene ${attachment.documentPath} has no readable tree`;
  /** A node reached on the path; `node` is a tree node, or a line placed into an instance. */
  interface Frame {
    readonly node: Pick<SceneNode, 'name' | 'type' | 'instanceOf' | 'inheritedNode'> & {
      readonly children: readonly SceneNode[];
    };
    readonly documentPath: string;
    readonly pathInDocument: string;
    /** This node's path in every document that encloses it, the attachment's first. */
    readonly enclosing: readonly { readonly documentPath: string; readonly path: string }[];
  }
  const locate = (root: SceneNode, nodePath: string): SceneNode | undefined => {
    if (nodePath === '.' || nodePath === '') return root;
    let current: SceneNode | undefined = root;
    for (const segment of nodePath.split('/')) {
      current = current?.children.find((child) => child.name === segment);
    }
    return current;
  };
  const start = locate(document.root, attachment.nodePath);
  if (start === undefined) return `attachment ${attachment.nodePath} is not in ${attachment.documentPath}`;
  // A node a scene copied from the scene it instanced keeps its path there
  // (`inheritedNode`); nodes that scene places under it are addressed through that path.
  const withOrigin = (
    entries: readonly { readonly documentPath: string; readonly path: string }[],
    node: Pick<SceneNode, 'inheritedNode'>,
  ) =>
    node.inheritedNode === undefined ||
    entries.some((entry) => entry.documentPath === node.inheritedNode?.documentPath)
      ? entries
      : [...entries, { documentPath: node.inheritedNode.documentPath, path: node.inheritedNode.nodePath }];
  // An attachment on an instancing node is also the root of every scene that node instances.
  const startEnclosing = [...withOrigin([{ documentPath: attachment.documentPath, path: attachment.nodePath }], start)];
  for (
    let instanced = start.instanceOf;
    instanced !== undefined && !startEnclosing.some((entry) => entry.documentPath === instanced);
    instanced = scenes.get(instanced)?.root?.instanceOf
  ) {
    startEnclosing.push({ documentPath: instanced, path: '.' });
  }
  const stack: Frame[] = [
    {
      node: start,
      documentPath: attachment.documentPath,
      pathInDocument: attachment.nodePath,
      enclosing: startEnclosing,
    },
  ];
  if (path.startsWith('/')) return `absolute node path ${path} depends on the running tree`;
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 1) return `node path ${path} leaves the attached scene`;
      stack.pop();
      continue;
    }
    const top = stack[stack.length - 1] as Frame;
    const deeper = top.enclosing.map((entry) => ({
      documentPath: entry.documentPath,
      path: childPath(entry.path, segment),
    }));
    const child = top.node.children.find((candidate) => candidate.name === segment);
    if (child !== undefined) {
      stack.push({
        node: child,
        documentPath: top.documentPath,
        pathInDocument: childPath(top.pathInDocument, segment),
        enclosing: withOrigin(deeper, child),
      });
      continue;
    }
    if (top.node.instanceOf !== undefined) {
      // An instanced scene or imported model: its root IS this node, its children are this node's.
      const instanced = scenes.get(top.node.instanceOf)?.root?.children.find(
        (candidate) => candidate.name === segment,
      );
      if (instanced !== undefined) {
        stack.push({
          node: instanced,
          documentPath: top.node.instanceOf,
          pathInDocument: segment,
          enclosing: [...deeper, { documentPath: top.node.instanceOf, path: segment }],
        });
        continue;
      }
    }
    // A node an enclosing scene places under a node of the scene it instanced
    // (`[node name="RayFloor" parent="Model/Skeleton"]`): Godot adds it as that node's child.
    let placed: Frame | undefined;
    for (const entry of top.enclosing) {
      const line = scenes
        .get(entry.documentPath)
        ?.unplacedNodes.find(
          (candidate) => candidate.parentPath === entry.path && candidate.name === segment,
        );
      if (line !== undefined) {
        placed = {
          node: {
            name: line.name,
            ...(line.type === undefined ? {} : { type: line.type }),
            ...(line.instanceOf === undefined ? {} : { instanceOf: line.instanceOf }),
            children: [],
          },
          documentPath: entry.documentPath,
          pathInDocument: childPath(entry.path, segment),
          enclosing: deeper,
        };
        break;
      }
    }
    if (placed === undefined) return `node path ${path} has no node ${segment}`;
    stack.push(placed);
  }
  const leaf = stack[stack.length - 1] as Frame;
  let className = leaf.node.type;
  let instanceOf = leaf.node.instanceOf;
  const seen = new Set<string>();
  while (className === undefined && instanceOf !== undefined && !seen.has(instanceOf)) {
    seen.add(instanceOf);
    const root = scenes.get(instanceOf)?.root;
    className = root?.type;
    instanceOf = root?.instanceOf;
  }
  if (className === undefined) return `node ${path} declares no class`;
  return { className, documentPath: leaf.documentPath, pathInDocument: leaf.pathInDocument };
}

export function typeCallReceivers(inputs: CallReceiverInputs): {
  readonly receivers: readonly BoundGodotCallReceiver[];
  readonly untyped: readonly BoundGodotUntypedCall[];
} {
  const nodes = new Map<number, GodotBoundNode>(
    inputs.program.nodes.map((node) => [node.id, node] as const),
  );
  const classes = new Map(inputs.apiDump.classes.map((entry) => [entry.name, entry] as const));
  const builtins = new Map(
    (inputs.apiDump.builtinClasses ?? []).map((entry) => [entry.name, entry] as const),
  );
  const scenes = new Map(inputs.read.scenes.map((scene) => [scene.resPath, scene] as const));
  const receivers = new Map<number, BoundGodotCallReceiver>();
  const untyped: BoundGodotUntypedCall[] = [];

  const typeOfName = (name: string, claims: readonly string[]): ReceiverType => {
    if (builtins.has(name)) return { kind: 'builtin', name };
    if (classes.has(name)) return { kind: 'native', name, claims };
    return { kind: 'unknown', reason: `type ${name} is neither a built-in nor a native class` };
  };

  const select = (
    receiver: ReceiverType,
    member: string,
  ):
    | { readonly target: BoundGodotCallReceiver['target']; readonly returnType: string; readonly claims: readonly string[] }
    | string => {
    if (receiver.kind === 'unknown') return receiver.reason;
    if (receiver.kind === 'builtin') {
      const method = builtins.get(receiver.name)?.methods.find((entry) => entry.name === member);
      if (method?.hash === undefined) return `${receiver.name} has no method ${member}`;
      return {
        target: { kind: 'builtin-member', owner: receiver.name, member, signatureHash: method.hash },
        returnType: method.return_type,
        claims: [],
      };
    }
    if (receiver.scriptMembers?.has(member) === true) {
      return `${member} is a script member of the receiver`;
    }
    const selection = inputs.claim('classdb-method-selection');
    if (selection === undefined) return 'classdb-method-selection has no live evidence';
    let current = classes.get(receiver.name);
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current.name)) {
      seen.add(current.name);
      const method = current.methods.find((entry) => entry.name === member);
      if (method !== undefined) {
        if (method.hash === undefined) return `${current.name}.${member} has no bind hash`;
        return {
          target: { kind: 'native-member', owner: current.name, member, signatureHash: method.hash },
          returnType: method.return_type,
          claims: [...receiver.claims, selection],
        };
      }
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return `${receiver.name} and its ancestors declare no method ${member}`;
  };

  const typeOf = (id: number): ReceiverType => {
    const node = nodes.get(id);
    if (node === undefined) return { kind: 'unknown', reason: `bound node ${String(id)} is absent` };
    if (node.kind === 'GET_NODE') {
      const rule = inputs.claim('scene-node-receiver');
      if (rule === undefined) return { kind: 'unknown', reason: 'scene-node-receiver has no live evidence' };
      if (inputs.attachments.length === 0) {
        return { kind: 'unknown', reason: `$${node.fullPath}: the script is attached to no scene node` };
      }
      let agreed: ResolvedSceneNode | undefined;
      for (const attachment of inputs.attachments) {
        const resolved = resolveScenePath(scenes, attachment, node.fullPath);
        if (typeof resolved === 'string') return { kind: 'unknown', reason: resolved };
        if (agreed !== undefined && agreed.className !== resolved.className) {
          return {
            kind: 'unknown',
            reason: `$${node.fullPath} is ${agreed.className} in one attachment and ${resolved.className} in another`,
          };
        }
        const scripted = inputs.scriptMethodsAt(resolved.documentPath, resolved.pathInDocument);
        if (scripted !== undefined) {
          return { kind: 'unknown', reason: `$${node.fullPath} carries a script; its members are the script's` };
        }
        agreed = resolved;
      }
      return typeOfName((agreed as ResolvedSceneNode).className, [rule]);
    }
    if (node.kind === 'SELF' && inputs.self !== undefined) {
      // `self.member()`: the instance is its script chain over its native class.
      return { kind: 'native', name: inputs.self.nativeClass, claims: [], scriptMembers: inputs.self.scriptMethods };
    }
    if (node.kind === 'SUBSCRIPT') {
      // A built-in's member (`transform.basis`) or index (`basis[2]`) has the type the API dump
      // states for it (`builtin_classes[].members`, `indexing_return_type`).
      const base = typeOf(node.base);
      if (base.kind === 'builtin') {
        const builtin = builtins.get(base.name);
        if (node.isAttribute) {
          const attribute = nodes.get(node.attribute);
          const name = attribute?.kind === 'IDENTIFIER' ? attribute.name : undefined;
          const member = builtin?.members.find((entry) => entry.name === name);
          if (member !== undefined) return typeOfName(member.type, []);
        } else if (builtin?.indexingReturnType !== undefined) {
          return typeOfName(builtin.indexingReturnType, []);
        }
      }
    }
    if (node.kind === 'CALL') {
      const typed = receivers.get(id) ?? typeCall(node);
      if (typed !== undefined) return typeOfName(typed.returnType, typed.evidenceClaimIds);
      const target = node.compilerTarget;
      if (target.kind === 'native-method' || target.kind === 'native-static') {
        const method = classes.get(target.owner)?.methods.find((entry) => entry.name === target.member);
        if (method !== undefined) return typeOfName(method.return_type, []);
      }
      if (target.kind === 'builtin-member' || target.kind === 'builtin-static') {
        const method = builtins.get(target.owner)?.methods.find((entry) => entry.name === target.member);
        if (method !== undefined) return typeOfName(method.return_type, []);
      }
    }
    const datatype = node.datatype;
    if (datatype.kind === 'BUILTIN' && datatype.builtinType !== 'Nil') {
      return typeOfName(datatype.builtinType, []);
    }
    return {
      kind: 'unknown',
      reason: `${node.kind} base has no receiver class fixed by the project (${datatype.display})`,
    };
  };

  const program = inputs.program;
  const within = (inner: GodotBoundNode, outer: GodotBoundNode): boolean =>
    (inner.startLine > outer.startLine || (inner.startLine === outer.startLine && inner.startColumn >= outer.startColumn)) &&
    (inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn));
  /** The classes an `or` of `name is Class` tests admits, or undefined for any other condition. */
  const testedClasses = (id: number, name: string): string[] | undefined => {
    const node = nodes.get(id);
    if (node?.kind === 'TYPE_TEST') {
      const operand = nodes.get(node.operand);
      if (operand?.kind !== 'IDENTIFIER' || operand.name !== name) return undefined;
      const tested = node.testDatatype;
      return tested.kind === 'NATIVE' && !tested.metaType && tested.nativeType !== '' ? [tested.nativeType] : undefined;
    }
    if (node?.kind === 'BINARY_OPERATOR' && node.variantOperatorId === 21) {
      const left = testedClasses(node.leftOperand, name);
      const right = testedClasses(node.rightOperand, name);
      return left === undefined || right === undefined ? undefined : [...left, ...right];
    }
    return undefined;
  };
  /**
   * A dynamic call on a local inside the true branch of `if local is A or local is B:` that does
   * not assign the local: Godot runs the branch only when the object's class is one of those
   * (`OPCODE_TYPE_TEST_NATIVE`), so the member is ClassDB's selection for each, when all agree.
   */
  const narrowedSelection = (
    baseId: number,
    member: string,
  ): ReturnType<typeof select> | undefined => {
    const base = nodes.get(baseId);
    if (base?.kind !== 'IDENTIFIER' || (base.source !== 'LOCAL_VARIABLE' && base.source !== 'FUNCTION_PARAMETER')) {
      return undefined;
    }
    for (const node of program.nodes) {
      if (node.kind !== 'IF') continue;
      const block = nodes.get(node.trueBlock);
      if (block === undefined || !within(base, block)) continue;
      const classes = testedClasses(node.condition, base.name);
      if (classes === undefined) continue;
      const reassigned = program.nodes.some((candidate) => {
        if (candidate.kind !== 'ASSIGNMENT' || !within(candidate, block)) return false;
        const assignee = nodes.get(candidate.assignee);
        return assignee?.kind === 'IDENTIFIER' && assignee.name === base.name;
      });
      if (reassigned) continue;
      const rule = inputs.claim('type-test-narrowing');
      if (rule === undefined) return 'type-test-narrowing has no live evidence';
      const selections = classes.map((name) => select({ kind: 'native', name, claims: [rule] }, member));
      const first = selections[0];
      if (first === undefined) continue;
      if (typeof first === 'string') return first;
      const agree = selections.every(
        (entry) =>
          typeof entry !== 'string' &&
          entry.target.owner === first.target.owner &&
          entry.target.signatureHash === first.target.signatureHash,
      );
      return agree ? first : `${member} selects different declarations for ${classes.join(', ')}`;
    }
    return undefined;
  };

  const untypedReasons = new Map<number, string>();
  // A dynamic call is typed on demand, so a call whose receiver is another dynamic call's result
  // types that call first, whatever their node ids.
  function typeCall(call: GodotBoundCallNode): BoundGodotCallReceiver | undefined {
    const known = receivers.get(call.id);
    if (known !== undefined || untypedReasons.has(call.id)) return known;
    if (call.compilerTarget.kind !== 'dynamic' && call.compilerTarget.kind !== 'unresolved') {
      return undefined;
    }
    untypedReasons.set(call.id, 'a call whose receiver depends on itself');
    const callee = nodes.get(call.callee);
    if (callee?.kind !== 'SUBSCRIPT' || !callee.isAttribute) {
      untypedReasons.set(call.id, 'a dynamic call without an attribute receiver');
      return undefined;
    }
    const narrowed = narrowedSelection(callee.base, call.functionName);
    const selected = narrowed ?? select(typeOf(callee.base), call.functionName);
    if (typeof selected === 'string') {
      untypedReasons.set(call.id, selected);
      return undefined;
    }
    untypedReasons.delete(call.id);
    const typed: BoundGodotCallReceiver = {
      nodeId: call.id,
      target: selected.target,
      returnType: selected.returnType,
      evidenceClaimIds: [...new Set(selected.claims)].sort(),
    };
    receivers.set(call.id, typed);
    return typed;
  }
  const calls = inputs.program.nodes
    .filter((node): node is GodotBoundCallNode => node.kind === 'CALL')
    .filter((node) => node.compilerTarget.kind === 'dynamic' || node.compilerTarget.kind === 'unresolved')
    .sort((left, right) => left.id - right.id);
  for (const call of calls) typeCall(call);
  for (const call of calls) {
    const reason = untypedReasons.get(call.id);
    if (reason !== undefined) untyped.push({ nodeId: call.id, reason });
  }
  return {
    receivers: [...receivers.values()].sort((left, right) => left.nodeId - right.nodeId),
    untyped,
  };
}
