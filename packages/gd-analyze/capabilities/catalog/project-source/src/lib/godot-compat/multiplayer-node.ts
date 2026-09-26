/** Node-side MultiplayerAPI ownership, authority, and RPC dispatch. */

import {
  GodotMultiplayerAPI,
  MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE,
} from './multiplayer-api';
import type { GodotNodePath } from './node-path';

interface MultiplayerNodeState {
  authority: number;
  api: GodotMultiplayerAPI | null;
  defaultApi: GodotMultiplayerAPI | null;
  path: string;
  configuration: object | null;
  native: object | null;
}

const nodeMultiplayer = new WeakMap<object, MultiplayerNodeState>();
const nativeScriptNodes = new WeakMap<object, object>();

function state(node: object): MultiplayerNodeState {
  let current = nodeMultiplayer.get(node);
  if (current === undefined) {
    current = { authority: 1, api: null, defaultApi: null, path: '', configuration: null, native: null };
    nodeMultiplayer.set(node, current);
  }
  return current;
}

function nodeChildren(node: object): readonly object[] {
  const boundNative = state(node).native;
  const carrier = boundNative ?? node;
  const children = Reflect.get(carrier, 'children') as unknown;
  if (Array.isArray(children)) {
    return children
      .filter((child): child is object => child !== null && typeof child === 'object')
      .map((child) => nativeScriptNodes.get(child) ?? child);
  }
  const getter = Reflect.get(carrier, 'get_children') as unknown;
  if (typeof getter === 'function') {
    const result = Reflect.apply(getter, carrier, []) as unknown;
    if (Array.isArray(result)) return result.filter((child): child is object => child !== null && typeof child === 'object');
  }
  return [];
}

function nodeParent(node: object): object | null {
  const carrier = state(node).native ?? node;
  const parent = Reflect.get(carrier, 'parent') as unknown;
  if (parent !== null && typeof parent === 'object') {
    return nativeScriptNodes.get(parent) ?? parent;
  }
  const getter = Reflect.get(carrier, 'get_parent') as unknown;
  if (typeof getter === 'function') {
    const result = Reflect.apply(getter, carrier, []) as unknown;
    if (result !== null && typeof result === 'object') return nativeScriptNodes.get(result) ?? result;
  }
  return null;
}

function authority(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 0x7fffffff) {
    throw new RangeError('Node multiplayer authority requires a positive 31-bit peer ID.');
  }
  return value;
}

export function setGodotMultiplayerAuthority(node: object, id: number, recursive = true): void {
  state(node).authority = authority(id);
  if (!recursive) return;
  for (const child of nodeChildren(node)) setGodotMultiplayerAuthority(child, id, true);
}

export function getGodotMultiplayerAuthority(node: object): number { return state(node).authority; }
export function isGodotMultiplayerAuthority(node: object): boolean {
  const api = godotNodeMultiplayer(node);
  return api.get_unique_id() === state(node).authority;
}
export function isGodotMultiplayerAuthorityFor(api: GodotMultiplayerAPI, node: object): boolean {
  return api.get_unique_id() === state(node).authority;
}

/** Godot 3 names the same retained authority field network_master. */
export function setGodotNetworkMaster(node: object, id: number, recursive = true): void {
  setGodotMultiplayerAuthority(node, id, recursive);
}
export function getGodotNetworkMaster(node: object): number { return getGodotMultiplayerAuthority(node); }
export function isGodotNetworkMaster(node: object): boolean { return isGodotMultiplayerAuthority(node); }

export function bindGodotNodeMultiplayer(
  node: object,
  api: GodotMultiplayerAPI,
  path: string,
  methods: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
  native: object | null = null,
): () => void {
  if (!(api instanceof GodotMultiplayerAPI)) throw new TypeError('Node multiplayer binding requires MultiplayerAPI.');
  const current = state(node);
  if (current.api !== null) throw new Error('Node already has an explicit MultiplayerAPI binding.');
  const configuration = Object.freeze({ path: String(path), methods });
  const error = api.object_configuration_add(node, configuration);
  if (error !== 0) throw new Error(`MultiplayerAPI rejected node configuration with Error ${error}.`);
  current.api = api;
  current.defaultApi = api;
  current.path = String(path);
  current.configuration = configuration;
  current.native = native;
  if (native !== null) nativeScriptNodes.set(native, node);
  return () => {
    if (current.api !== api || current.configuration !== configuration) return;
    api.object_configuration_remove(node, configuration);
    current.api = null;
    current.defaultApi = null;
    current.path = '';
    current.configuration = null;
    if (current.native !== null && nativeScriptNodes.get(current.native) === node) nativeScriptNodes.delete(current.native);
    current.native = null;
  };
}

export function setGodotCustomMultiplayer(node: object, custom: GodotMultiplayerAPI | null): void {
  if (custom !== null && !(custom instanceof GodotMultiplayerAPI)) {
    throw new TypeError('Node.custom_multiplayer requires MultiplayerAPI or null.');
  }
  const current = state(node);
  const next = custom ?? current.defaultApi;
  if (next === current.api) return;
  if (current.configuration !== null && current.api !== null) {
    current.api.object_configuration_remove(node, current.configuration);
  }
  current.api = next;
  if (current.configuration !== null && next !== null) {
    const error = next.object_configuration_add(node, current.configuration);
    if (error !== 0) throw new Error(`Node.custom_multiplayer configuration transfer failed with Error ${error}.`);
  }
}

export function getGodotCustomMultiplayer(node: object): GodotMultiplayerAPI | null {
  const current = state(node);
  return current.api === current.defaultApi ? null : current.api;
}

export function godotNodeEffectiveMultiplayer(
  node: object,
  fallback: GodotMultiplayerAPI,
): GodotMultiplayerAPI {
  return state(node).api ?? fallback;
}

export function godotNodeEffectiveMultiplayerInTree(
  identity: object,
  native: object,
  tree: {
    readonly multiplayer: GodotMultiplayerAPI;
    getNodePath(node: object): GodotNodePath;
    getMultiplayer(path: GodotNodePath | string): GodotMultiplayerAPI;
  },
): GodotMultiplayerAPI {
  const explicit = state(identity).api;
  if (explicit !== null) return explicit;
  try {
    return tree.getMultiplayer(tree.getNodePath(native));
  } catch {
    return tree.multiplayer;
  }
}

export function godotNodeMultiplayer(node: object): GodotMultiplayerAPI {
  let current: object | null = node;
  const visited = new Set<object>();
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const api = state(current).api;
    if (api !== null) return api;
    current = nodeParent(current);
  }
  throw new Error('Node multiplayer operation requires an emitted MultiplayerAPI binding on the node or an ancestor.');
}

export function godotNodeRpc(node: object, method: string, ...args: readonly unknown[]): number {
  return godotNodeMultiplayer(node).rpc(0, node, String(method), args);
}

export function godotNodeRpcId(node: object, peer: number, method: string, ...args: readonly unknown[]): number {
  return godotNodeMultiplayer(node).rpc(peer, node, String(method), args);
}

export function godotNodeRpcConfig(
  api: GodotMultiplayerAPI,
  node: object,
  method: string,
  config: number | Readonly<Record<string, unknown>> | ReadonlyMap<unknown, unknown> | null,
): void {
  api.configure_rpc(node, String(method), config);
}

export function godotNodeGetRpcConfig(
  api: GodotMultiplayerAPI,
  node: object,
): ReadonlyMap<string, ReadonlyMap<string, unknown>> {
  return api.get_rpc_config(node);
}

export function godotMultiplayerRpc(
  api: GodotMultiplayerAPI,
  node: object,
  method: string,
  ...args: readonly unknown[]
): number {
  return api.rpc(0, node, String(method), args);
}

export function godotMultiplayerRpcId(
  api: GodotMultiplayerAPI,
  node: object,
  peer: number,
  method: string,
  ...args: readonly unknown[]
): number {
  return api.rpc(peer, node, String(method), args);
}

export function godotMultiplayerRpcUnreliable(
  api: GodotMultiplayerAPI,
  node: object,
  method: string,
  ...args: readonly unknown[]
): number {
  return rpcWithApiTransfer(api, node, 0, MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE, method, args);
}

export function godotMultiplayerRpcUnreliableId(
  api: GodotMultiplayerAPI,
  node: object,
  peer: number,
  method: string,
  ...args: readonly unknown[]
): number {
  return rpcWithApiTransfer(api, node, peer, MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE, method, args);
}

export function godotNodeRpcUnreliable(node: object, method: string, ...args: readonly unknown[]): number {
  return rpcWithTransfer(node, 0, MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE, method, args);
}

export function godotNodeRpcUnreliableId(
  node: object,
  peer: number,
  method: string,
  ...args: readonly unknown[]
): number {
  return rpcWithTransfer(node, peer, MULTIPLAYER_PEER_TRANSFER_MODE_UNRELIABLE, method, args);
}

export function godotNodeRset(_node: object, property: string, _value: unknown): never {
  throw new Error(
    `Node.rset(${property}) requires Godot's replicated-property protocol; ` +
    'no exact browser carrier is bound for that engine-owned wire format.',
  );
}

export function godotNodeRsetId(_node: object, _peer: number, property: string, _value: unknown): never {
  throw new Error(
    `Node.rset_id(${property}) requires Godot's replicated-property protocol; ` +
    'no exact browser carrier is bound for that engine-owned wire format.',
  );
}

function rpcWithTransfer(
  node: object,
  peerId: number,
  mode: number,
  method: string,
  args: readonly unknown[],
): number {
  const api = godotNodeMultiplayer(node);
  const multiplayerPeer = api.get_multiplayer_peer();
  const previousMode = multiplayerPeer?.get_transfer_mode();
  if (multiplayerPeer !== null) multiplayerPeer.set_transfer_mode(mode);
  try {
    return api.rpc(peerId, node, String(method), args);
  } finally {
    if (multiplayerPeer !== null && previousMode !== undefined) multiplayerPeer.set_transfer_mode(previousMode);
  }
}

function rpcWithApiTransfer(
  api: GodotMultiplayerAPI,
  node: object,
  peerId: number,
  mode: number,
  method: string,
  args: readonly unknown[],
): number {
  const multiplayerPeer = api.get_multiplayer_peer();
  const previousMode = multiplayerPeer?.get_transfer_mode();
  if (multiplayerPeer !== null) multiplayerPeer.set_transfer_mode(mode);
  try {
    return api.rpc(peerId, node, String(method), args);
  } finally {
    if (multiplayerPeer !== null && previousMode !== undefined) multiplayerPeer.set_transfer_mode(previousMode);
  }
}
