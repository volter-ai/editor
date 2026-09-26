/** Source-shaped Godot 3.6/4.7 JSONRPC request dispatch. */

import { GodotCallable } from './callable';
import { createGodotJSON, godotJSONParse3, godotJSONStringify } from './json';
import { godotObjectCall, registerGodotObjectIdentity } from './object';
import { godotDictionary } from './variant';

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

type Dictionary = Map<string, unknown>;
type RPCMethod = GodotCallable | ((...args: readonly unknown[]) => unknown);

function dictionary(value: unknown): Dictionary | null {
  if (value instanceof Map) return value as Dictionary;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return godotDictionary(Object.entries(value as Record<string, unknown>));
}

function rpcDictionary(entries: readonly (readonly [string, unknown])[]): Dictionary {
  return godotDictionary(entries);
}

function invoke(callable: RPCMethod, args: readonly unknown[]): unknown {
  if (callable instanceof GodotCallable) return callable.callv(args);
  if (typeof callable === 'function') return callable(...args);
  throw new TypeError('JSONRPC method callback must be Callable.');
}

export class GodotJSONRPC {
  private readonly methods = new Map<string, RPCMethod>();
  private readonly scopes = new Map<string, unknown>();

  constructor(readonly major: 3 | 4) {
    registerGodotObjectIdentity(this, 'JSONRPC');
  }

  set_method(name: string, callback: RPCMethod): void {
    if (this.major !== 4) throw new Error('JSONRPC.set_method is Godot 4 only; Godot 3 uses set_scope.');
    if (typeof name !== 'string') throw new TypeError('JSONRPC.set_method name must be String.');
    if (!(callback instanceof GodotCallable) && typeof callback !== 'function') {
      throw new TypeError('JSONRPC.set_method callback must be Callable.');
    }
    this.methods.set(name, callback);
  }

  set_scope(scope: string, target: unknown): void {
    if (this.major !== 3) throw new Error('JSONRPC.set_scope is Godot 3 only; Godot 4 uses set_method.');
    if (typeof scope !== 'string') throw new TypeError('JSONRPC.set_scope scope must be String.');
    this.scopes.set(scope, target);
  }

  make_response_error(code: number, message: string, id: unknown = null): Dictionary {
    return rpcDictionary([
      ['jsonrpc', '2.0'],
      ['error', rpcDictionary([['code', code], ['message', message]])],
      ['id', id],
    ]);
  }

  make_response(result: unknown, id: unknown): Dictionary {
    return rpcDictionary([['jsonrpc', '2.0'], ['id', id], ['result', result]]);
  }

  make_notification(method: string, params: unknown): Dictionary {
    return rpcDictionary([['jsonrpc', '2.0'], ['method', method], ['params', params]]);
  }

  make_request(method: string, params: unknown, id: unknown): Dictionary {
    return rpcDictionary([['jsonrpc', '2.0'], ['method', method], ['params', params], ['id', id]]);
  }

  process_action(action: unknown, recurse = false): unknown {
    const request = dictionary(action);
    if (request !== null) return this.major === 4 ? this.process4(request) : this.process3(request);
    if (Array.isArray(action) && recurse) {
      if (action.length === 0) return this.make_response_error(JSONRPC_INVALID_REQUEST, 'Invalid Request');
      if (this.major === 3) return action.map((entry) => this.process_action(entry));
      const responses = action
        .map((entry) => this.process_action(entry))
        .filter((entry) => entry !== null && entry !== undefined);
      return responses.length === 0 ? null : responses;
    }
    return this.make_response_error(JSONRPC_INVALID_REQUEST, 'Invalid Request');
  }

  process_string(input: string): string {
    if (input.length === 0) return '';
    let parsed: unknown;
    if (this.major === 3) {
      const result = godotJSONParse3(input);
      parsed = result.error === 0 ? result.result : undefined;
    } else {
      const json = createGodotJSON();
      parsed = json.parse(input) === 0 ? json.get_data() : undefined;
    }
    const response = parsed === undefined
      ? this.make_response_error(JSONRPC_PARSE_ERROR, 'Parse error')
      : this.process_action(parsed, true);
    return response === null || response === undefined ? '' : godotJSONStringify(response);
  }

  private process4(request: Dictionary): unknown {
    const method = String(request.get('method') ?? '');
    const params = request.has('params') ? request.get('params') : undefined;
    const args = Array.isArray(params) ? params : params === undefined ? [] : [params];
    const notification = !request.has('id');
    const id = notification ? null : request.get('id');
    const callable = this.methods.get(method);
    const response = callable === undefined
      ? this.make_response_error(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`, id)
      : this.make_response(invoke(callable, args), id);
    return notification ? null : response;
  }

  private process3(request: Dictionary): unknown {
    let method = String(request.get('method') ?? '');
    if (method.startsWith('$/')) return null;
    const params = request.has('params') ? request.get('params') : undefined;
    const args = Array.isArray(params) ? params : params === undefined ? [] : [params];
    let target: unknown = this;
    const slash = method.lastIndexOf('/');
    const scope = slash < 0 ? '' : method.slice(0, slash);
    if (this.scopes.has(scope)) {
      target = this.scopes.get(scope);
      method = method.slice(slash + 1);
    }
    const id = request.has('id') ? request.get('id') : null;
    if (target === null || target === undefined) {
      return this.make_response_error(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`, id);
    }
    let result: unknown;
    try {
      if (target === this) {
        const own = Reflect.get(this, method) as unknown;
        if (typeof own !== 'function') return this.make_response_error(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`, id);
        result = Reflect.apply(own, this, args);
      } else {
        result = godotObjectCall(target, [method, ...args]);
      }
    } catch (error) {
      if (!(error instanceof TypeError && error.message === 'JSONRPC method callback must be Callable.') &&
          !(error instanceof Error && error.message.includes('Invalid call. Nonexistent function'))) throw error;
      return this.make_response_error(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`, id);
    }
    return id === null || id === undefined ? null : this.make_response(result, id);
  }
}

export function createGodotJSONRPC(major: 3 | 4): GodotJSONRPC {
  return new GodotJSONRPC(major);
}
