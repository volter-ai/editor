/**
 * The signals a program looks at as connections, not only emits or connects to: `disconnect`,
 * `is_connected`, `get_connections`, `get_signal_connection_list` and `has_connections`, on a signal named in the
 * source (`body_entered.disconnect(...)`, `disconnect("body_entered", ...)`), or on one it cannot
 * name (`any`: a name computed at run time, `get_incoming_connections`). A scene connection the
 * plan would hand a source's handler as a callback stays a connection to such a signal
 * (`scene-signal-delivery.ts`), since the callback is not one of the signal's connections.
 */

import type { GodotBoundScript } from '../godot-frontend/bound-program';

const LOOKS = new Set(['disconnect', 'is_connected', 'get_signal_connection_list', 'has_connections', 'get_connections']);

export interface BoundGodotSignalIntrospection {
  readonly signals: readonly string[];
  readonly any: boolean;
}

export function signalIntrospection(script: GodotBoundScript): BoundGodotSignalIntrospection {
  const nodes = script.nodes;
  const signals = new Set<string>();
  let any = false;
  for (const node of nodes) {
    if (node.kind !== 'CALL') continue;
    if (node.functionName === 'get_incoming_connections') any = true;
    if (!LOOKS.has(node.functionName)) continue;
    const first = node.arguments[0] === undefined ? undefined : nodes[node.arguments[0]];
    if (first?.kind === 'LITERAL' && (first.value.kind === 'string' || first.value.kind === 'string-name')) {
      signals.add(first.value.value);
      continue;
    }
    // The Object form names the signal first (`disconnect(name, callable)`,
    // `get_signal_connection_list(name)`): a name computed at run time is any signal.
    const objectForm = node.functionName === 'get_signal_connection_list' || node.functionName === 'has_connections' || node.arguments.length === 2;
    if (objectForm) {
      any = true;
      continue;
    }
    // The Signal form's signal is the call's base: a signal of the script's or of its native base
    // (`body_entered.disconnect(callable)`) or an object's by name (`area.body_entered`); a Signal
    // held in a variable is any signal.
    const callee = node.callee >= 0 ? nodes[node.callee] : undefined;
    const base = callee?.kind === 'SUBSCRIPT' && callee.isAttribute && callee.base >= 0 ? nodes[callee.base] : undefined;
    const attribute = base?.kind === 'SUBSCRIPT' && base.isAttribute ? nodes[base.attribute] : undefined;
    const name =
      base?.kind === 'IDENTIFIER' && (base.source === 'MEMBER_SIGNAL' || base.source === 'INHERITED_VARIABLE')
        ? base.name
        : attribute?.kind === 'IDENTIFIER'
          ? attribute.name
          : undefined;
    if (name === undefined) any = true;
    else signals.add(name);
  }
  return { signals: [...signals].sort(), any };
}
