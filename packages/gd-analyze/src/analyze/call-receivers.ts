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
  /** The live claim for a rule, or undefined when the rule has no live evidence. */
  readonly claim: (rule: GodotAnalysisRuleId) => string | undefined;
}

type ReceiverType =
  | { readonly kind: 'builtin'; readonly name: string }
  | { readonly kind: 'native'; readonly name: string; readonly claims: readonly string[] }
  | { readonly kind: 'unknown'; readonly reason: string };

interface ResolvedSceneNode {
  readonly className: string;
  readonly documentPath: string;
  readonly pathInDocument: string;
}

function childPath(parent: string, name: string): string {
  return parent === '.' || parent === '' ? name : `${parent}/${name}`;
}

/** Follow one relative node path from an attachment point, as SceneTree lookups do. */
function resolveScenePath(
  scenes: ReadonlyMap<string, SceneDocument>,
  attachment: CallReceiverAttachment,
  path: string,
): ResolvedSceneNode | string {
  const document = scenes.get(attachment.documentPath);
  if (document?.root === undefined) return `scene ${attachment.documentPath} has no readable tree`;
  interface Frame {
    readonly node: SceneNode;
    readonly documentPath: string;
    readonly pathInDocument: string;
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
  const stack: Frame[] = [
    { node: start, documentPath: attachment.documentPath, pathInDocument: attachment.nodePath },
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
    let next = top.node.children.find((child) => child.name === segment);
    let documentPath = top.documentPath;
    let pathInDocument = childPath(top.pathInDocument, segment);
    if (next === undefined && top.node.instanceOf !== undefined) {
      // An instanced scene or imported model: its root IS this node, its children are this node's.
      const instanced = scenes.get(top.node.instanceOf);
      next = instanced?.root?.children.find((child) => child.name === segment);
      documentPath = top.node.instanceOf;
      pathInDocument = segment;
    }
    if (next === undefined) return `node path ${path} has no node ${segment}`;
    stack.push({ node: next, documentPath, pathInDocument });
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
    if (node.kind === 'CALL') {
      const typed = receivers.get(id);
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

  // Calls are visited in node-id order; a chained call's inner call has the smaller id, so it is
  // typed before the call that uses its result.
  const calls = inputs.program.nodes
    .filter((node): node is GodotBoundCallNode => node.kind === 'CALL')
    .filter((node) => node.compilerTarget.kind === 'dynamic' || node.compilerTarget.kind === 'unresolved')
    .sort((left, right) => left.id - right.id);
  for (const call of calls) {
    const callee = nodes.get(call.callee);
    if (callee?.kind !== 'SUBSCRIPT' || !callee.isAttribute) {
      untyped.push({ nodeId: call.id, reason: 'a dynamic call without an attribute receiver' });
      continue;
    }
    const selected = select(typeOf(callee.base), call.functionName);
    if (typeof selected === 'string') {
      untyped.push({ nodeId: call.id, reason: selected });
      continue;
    }
    receivers.set(call.id, {
      nodeId: call.id,
      target: selected.target,
      returnType: selected.returnType,
      evidenceClaimIds: [...new Set(selected.claims)].sort(),
    });
  }
  return {
    receivers: [...receivers.values()].sort((left, right) => left.nodeId - right.nodeId),
    untyped,
  };
}
