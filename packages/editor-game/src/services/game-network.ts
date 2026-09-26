/**
 * THE PAGE'S VIEW OF A RUNNING GAME'S COLYSEUS ROOMS — the editor's own networking adapter for a
 * game that declares none (the ingest way: the game joins its room with `@colyseus/sdk` directly,
 * and the editor reads it).
 *
 * The editor owns the page, so it wraps the page's `WebSocket` constructor once at boot, as it
 * wraps `AudioContext` (`game-audio.ts`). A socket whose URL is a Colyseus room's
 * (`/<processId>/<roomId>?sessionId=…`, the SDK's `buildEndpoint`) gets a MIRROR: every frame the
 * game sends or receives is decoded the way the SDK's own `Room.onMessageCallback` decodes it —
 * the join handshake and its schema reflection, full state and patches through the SDK's own
 * `SchemaSerializer`, room messages as a type and a msgpack payload. The game's socket is never
 * touched: the mirror reads copies of the same bytes and keeps its own decoder. The room's name is
 * read from the matchmaking reply that reserved the seat (`POST /matchmake/<method>/<name>`).
 *
 * What a client cannot see, the observer does not claim: the other clients of a room are the
 * server's (Colyseus Monitor reads them from the matchmaker), so `peers()` is the local session
 * of each observed room.
 */

import { pack, unpack } from '@colyseus/msgpackr';
import { decode, encode, type Iterator } from '@colyseus/schema';
import { SchemaSerializer } from '@colyseus/sdk';
import type {
  ConnectionState,
  NetConditioning,
  NetServerInspection,
  NetMessageEvent,
  NetPeer,
  NetRates,
  NetworkingAdapter,
  ReplicationStats,
  RoomInfo,
} from '@volter/editor-project/adapter/system-adapter';

/** Colyseus's wire codes (`@colyseus/shared-types`' `Protocol`). */
const JOIN_ROOM = 10;
const ERROR = 11;
const LEAVE_ROOM = 12;
const ROOM_DATA = 13;
const ROOM_STATE = 14;
const ROOM_STATE_PATCH = 15;
const ROOM_DATA_BYTES = 17;
const PING = 18;

const LOG_CAPACITY = 2000;

/** One message type's traffic, both directions (Godot's per-node RPC row). */
export interface ObservedMessageType {
  readonly type: string;
  readonly countIn: number;
  readonly countOut: number;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly last?: unknown;
}

export interface ObservedRoom {
  readonly roomId: string;
  readonly processId: string;
  readonly sessionId: string;
  readonly roomName: string | null;
  readonly endpoint: string;
  readonly state: ConnectionState;
  readonly joinedAt: number | null;
  readonly closedAt: number | null;
  readonly closeCode: number | null;
  readonly error: string | null;
  readonly rttMs: number | null;
  /** Bytes of the last full state the server sent, and of every patch since. */
  readonly stateBytes: number;
  readonly patches: number;
  readonly patchBytes: number;
  readonly messageTypes: readonly ObservedMessageType[];
}

interface MutableType {
  type: string;
  countIn: number;
  countOut: number;
  bytesIn: number;
  bytesOut: number;
  last?: unknown;
}

interface Mirror {
  roomId: string;
  processId: string;
  sessionId: string;
  endpoint: string;
  state: ConnectionState;
  joinedAt: number | null;
  closedAt: number | null;
  closeCode: number | null;
  error: string | null;
  serializer: SchemaSerializer | null;
  pingSentAt: number | null;
  rttMs: number | null;
  stateBytes: number;
  patches: number;
  patchBytes: number;
  types: Map<string, MutableType>;
  socket: WebSocket;
  /** When the last delayed frame is due, per direction: a later frame never overtakes it. */
  dueIn: number;
  dueOut: number;
}

const mirrors: Mirror[] = [];
const mirrorOf = new WeakMap<WebSocket, Mirror>();
const pingWaiters = new WeakMap<Mirror, (rttMs: number) => void>();
/** The link conditioner (Unity's network simulator): latency and jitter on every observed room
 *  socket, both directions, in order. A WebSocket is reliable and ordered, so loss is not one of
 *  its behaviours and is not simulated. */
let conditioning: NetConditioning = { latencyMs: 0, jitterMs: 0, packetLoss: 0 };

/** Run `deliver` after the conditioned delay, never before the direction's previous frame. */
function conditioned(mirror: Mirror, direction: 'in' | 'out', deliver: () => void): void {
  const { latencyMs, jitterMs } = conditioning;
  const now = performance.now();
  const last = direction === 'in' ? mirror.dueIn : mirror.dueOut;
  if (latencyMs <= 0 && jitterMs <= 0 && last <= now) {
    deliver();
    return;
  }
  const due = Math.max(last, now + latencyMs + Math.random() * jitterMs);
  if (direction === 'in') mirror.dueIn = due;
  else mirror.dueOut = due;
  setTimeout(deliver, due - now);
}
const roomNames = new Map<string, string>();
const log: NetMessageEvent[] = [];
let seq = 0;
const listeners = new Set<() => void>();
/** Per-second windows for the rates: the current one and the last complete one. */
let window0 = { start: 0, msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0 };
let lastWindow = { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0 };

function notify(): void {
  for (const listener of listeners) listener();
}

function roll(now: number): void {
  const elapsed = now - window0.start;
  if (elapsed < 1000) return;
  // The window that just closed is the last second's reading only if it closed within one.
  lastWindow = elapsed < 2000 ? { ...window0 } : { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0 };
  window0 = { start: now, msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0 };
}

function record(mirror: Mirror, direction: 'in' | 'out', type: string, size: number, payload?: unknown): void {
  const now = Date.now();
  roll(now);
  if (direction === 'in') {
    window0.msgsIn += 1;
    window0.bytesIn += size;
  } else {
    window0.msgsOut += 1;
    window0.bytesOut += size;
  }
  let entry = mirror.types.get(type);
  if (!entry) {
    entry = { type, countIn: 0, countOut: 0, bytesIn: 0, bytesOut: 0 };
    mirror.types.set(type, entry);
  }
  if (direction === 'in') {
    entry.countIn += 1;
    entry.bytesIn += size;
  } else {
    entry.countOut += 1;
    entry.bytesOut += size;
  }
  if (payload !== undefined) entry.last = payload;
  seq += 1;
  // The contract's clock is `performance.now()` milliseconds.
  log.push({ seq, time: performance.now(), direction, type, size });
  if (log.length > LOG_CAPACITY) log.splice(0, log.length - LOG_CAPACITY);
}

/** A room message's type, as the SDK reads it: a string or a number after the code. */
function messageType(bytes: Uint8Array, it: Iterator): string {
  const buffer = bytes as unknown as Parameters<typeof decode.string>[0];
  return decode.stringCheck(buffer, it) ? decode.string(buffer, it) : String(decode.number(buffer, it));
}

function observeIncoming(mirror: Mirror, bytes: Uint8Array): void {
  const code = bytes[0];
  const it: Iterator = { offset: 1 };
  const buffer = bytes as unknown as Parameters<typeof decode.utf8Read>[0];
  try {
    if (code === JOIN_ROOM) {
      decode.utf8Read(buffer, it, bytes[it.offset++]!);
      const serializerId = decode.utf8Read(buffer, it, bytes[it.offset++]!);
      if (serializerId === 'schema' && !mirror.serializer) {
        mirror.serializer = new SchemaSerializer();
        if (bytes.byteLength > it.offset) mirror.serializer.handshake(bytes, it);
      }
      mirror.state = 'connected';
      mirror.joinedAt ??= Date.now();
      record(mirror, 'in', 'join', bytes.byteLength);
    } else if (code === ERROR) {
      const errorCode = decode.number(buffer, it);
      const message = decode.string(buffer, it);
      mirror.error = `${errorCode}: ${message}`;
      mirror.state = 'error';
      record(mirror, 'in', 'error', bytes.byteLength);
    } else if (code === LEAVE_ROOM) {
      record(mirror, 'in', 'leave', bytes.byteLength);
    } else if (code === ROOM_STATE) {
      mirror.serializer?.setState(bytes, it);
      mirror.stateBytes = bytes.byteLength;
      record(mirror, 'in', 'state', bytes.byteLength);
    } else if (code === ROOM_STATE_PATCH) {
      mirror.serializer?.patch(bytes, it);
      mirror.patches += 1;
      mirror.patchBytes += bytes.byteLength;
      record(mirror, 'in', 'patch', bytes.byteLength);
    } else if (code === ROOM_DATA) {
      const type = messageType(bytes, it);
      const payload = bytes.byteLength > it.offset ? unpack(bytes, { start: it.offset }) : undefined;
      record(mirror, 'in', type, bytes.byteLength, payload);
    } else if (code === ROOM_DATA_BYTES) {
      record(mirror, 'in', messageType(bytes, it), bytes.byteLength);
    } else if (code === PING) {
      if (mirror.pingSentAt !== null) mirror.rttMs = Math.round(performance.now() - mirror.pingSentAt);
      mirror.pingSentAt = null;
      const waiting = pingWaiters.get(mirror);
      pingWaiters.delete(mirror);
      if (waiting && mirror.rttMs !== null) waiting(mirror.rttMs);
      record(mirror, 'in', 'ping', bytes.byteLength);
    }
  } catch (error) {
    // A frame the mirror cannot read is the mirror's failure, never the game's: the game decodes
    // its own copy. Say so once per room rather than per frame.
    if (!mirror.error) mirror.error = `the editor could not read a frame (code ${code}): ${String(error)}`;
  }
  notify();
}

function observeOutgoing(mirror: Mirror, data: unknown): void {
  const bytes =
    data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : null;
  if (!bytes || bytes.byteLength === 0) return;
  const code = bytes[0];
  const it: Iterator = { offset: 1 };
  try {
    if (code === ROOM_DATA) {
      const type = messageType(bytes, it);
      const payload = bytes.byteLength > it.offset ? unpack(bytes, { start: it.offset }) : undefined;
      record(mirror, 'out', type, bytes.byteLength, payload);
    } else if (code === ROOM_DATA_BYTES) {
      record(mirror, 'out', messageType(bytes, it), bytes.byteLength);
    } else if (code === PING) {
      mirror.pingSentAt = performance.now();
      record(mirror, 'out', 'ping', bytes.byteLength);
    } else if (code === JOIN_ROOM) {
      record(mirror, 'out', 'join', bytes.byteLength);
    } else if (code === LEAVE_ROOM) {
      record(mirror, 'out', 'leave', bytes.byteLength);
    }
  } catch {
    /* the game's own send is unaffected */
  }
  notify();
}

/** The room a socket URL addresses, when it is a Colyseus room's. */
function roomAddress(url: string): { processId: string; roomId: string; sessionId: string; endpoint: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url, location.href);
  } catch {
    return null;
  }
  const sessionId = parsed.searchParams.get('sessionId');
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (!sessionId || parts.length < 2) return null;
  const roomId = parts[parts.length - 1]!;
  const processId = parts[parts.length - 2]!;
  return { processId, roomId, sessionId, endpoint: `${parsed.protocol}//${parsed.host}` };
}

function attach(socket: WebSocket, url: string): void {
  const address = roomAddress(url);
  if (!address) return;
  const mirror: Mirror = {
    ...address,
    state: 'connecting',
    joinedAt: null,
    closedAt: null,
    closeCode: null,
    error: null,
    serializer: null,
    pingSentAt: null,
    rttMs: null,
    stateBytes: 0,
    patches: 0,
    patchBytes: 0,
    types: new Map(),
    socket,
    dueIn: 0,
    dueOut: 0,
  };
  mirrors.push(mirror);
  mirrorOf.set(socket, mirror);
  socket.addEventListener('message', (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) observeIncoming(mirror, new Uint8Array(event.data));
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    mirror.state = 'disconnected';
    mirror.closedAt = Date.now();
    mirror.closeCode = event.code;
    notify();
  });
  socket.addEventListener('error', () => {
    mirror.state = 'error';
    mirror.error ??= 'the socket reported an error';
    notify();
  });
  const send = socket.send.bind(socket);
  socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
    observeOutgoing(mirror, data);
    conditioned(mirror, 'out', () => {
      if (socket.readyState === socket.OPEN) send(data);
    });
  };
  notify();
}

/** Record the room name a matchmaking reply reserved a seat in. */
function observeMatchmaking(input: RequestInfo | URL, response: Response): void {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/\/matchmake\//.test(url)) return;
  void response
    .clone()
    .json()
    .then((reservation: { name?: unknown; roomId?: unknown; room?: { name?: unknown; roomId?: unknown } }) => {
      const room = reservation.room ?? reservation;
      if (typeof room.roomId === 'string' && typeof room.name === 'string') {
        roomNames.set(room.roomId, room.name);
        notify();
      }
    })
    .catch(() => undefined);
}

/** Install once at editor boot (`network-observer.service.ts`). Idempotent. */
export function installGameNetwork(): void {
  const host = window as unknown as { __vgaiNetworkObserver?: boolean } & typeof window;
  if (host.__vgaiNetworkObserver) return;
  host.__vgaiNetworkObserver = true;
  const Orig = window.WebSocket;
  if (typeof Orig === 'function') {
    const Observed = class extends Orig {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        attach(this, String(url));
      }

      // The SDK receives through `onmessage`; a room socket's handler is handed each frame
      // after the conditioner's delay. The mirror's own listener reads it on arrival.
      override set onmessage(handler: ((this: WebSocket, event: MessageEvent) => unknown) | null) {
        const mirror = mirrorOf.get(this);
        super.onmessage =
          handler && mirror
            ? (event: MessageEvent) => conditioned(mirror, 'in', () => handler.call(this, event))
            : handler;
      }

      override get onmessage(): ((this: WebSocket, event: MessageEvent) => unknown) | null {
        return super.onmessage;
      }
    };
    window.WebSocket = Observed as typeof WebSocket;
  }
  const fetchOrig = window.fetch;
  if (typeof fetchOrig === 'function') {
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchOrig(input, init);
      observeMatchmaking(input, response);
      return response;
    };
  }
}

/** Every room this page has joined, newest last. */
export function observedRooms(): readonly ObservedRoom[] {
  return mirrors.map((mirror) => ({
    roomId: mirror.roomId,
    processId: mirror.processId,
    sessionId: mirror.sessionId,
    roomName: roomNames.get(mirror.roomId) ?? null,
    endpoint: mirror.endpoint,
    state: mirror.state,
    joinedAt: mirror.joinedAt,
    closedAt: mirror.closedAt,
    closeCode: mirror.closeCode,
    error: mirror.error,
    rttMs: mirror.rttMs,
    stateBytes: mirror.stateBytes,
    patches: mirror.patches,
    patchBytes: mirror.patchBytes,
    messageTypes: [...mirror.types.values()].map((entry) => ({ ...entry })),
  }));
}

/** Colyseus Monitor's API on the room's own server, when the server mounts it (`/monitor`). */
function monitorApi(mirror: Mirror): string {
  return `${mirror.endpoint.replace(/^ws/, 'http')}/monitor/api`;
}

interface MonitorRooms {
  rooms?: { roomId: string; name: string; clients: number; maxClients?: string | number | null; locked?: boolean; elapsedTime?: number }[];
  connections?: number;
  cpu?: number;
  memory?: { totalMemMb?: number; usedMemMb?: number };
}

interface MonitorRoom {
  clients?: { sessionId: string; elapsedTime: number }[];
  stateSize?: number;
}

async function monitorJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url).catch(() => null);
  if (!response || !response.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

/** One of Monitor's room actions (`/room/call`), on `roomId` (the current room's by default). */
async function roomCall(method: string, args: unknown[], what: string, roomId?: string): Promise<void> {
  const mirror = current();
  if (!mirror) throw new Error('No room is observed.');
  const query = new URLSearchParams({ roomId: roomId ?? mirror.roomId, method, args: JSON.stringify(args) });
  const response = await fetch(`${monitorApi(mirror)}/room/call?${query}`);
  if (response.status === 404) {
    throw new Error(`The room server serves no Monitor view, so ${what} has nowhere to go (its \`server\` configuration sets VGAI_ROOM_MONITOR=1).`);
  }
  if (!response.ok) throw new Error(`The room server refused ${what} (${response.status}).`);
}

/** The room the inspector reads: the newest one still open, else the newest. */
function current(): Mirror | null {
  for (let index = mirrors.length - 1; index >= 0; index -= 1) {
    if (mirrors[index]!.state !== 'disconnected') return mirrors[index]!;
  }
  return mirrors[mirrors.length - 1] ?? null;
}

function stateJson(mirror: Mirror | null): unknown {
  const state = mirror?.serializer?.getState() as { toJSON?: () => unknown } | undefined;
  return state?.toJSON ? state.toJSON() : state;
}

function rates(): NetRates {
  roll(Date.now());
  return {
    msgsInPerSec: lastWindow.msgsIn,
    msgsOutPerSec: lastWindow.msgsOut,
    bytesInPerSec: lastWindow.bytesIn,
    bytesOutPerSec: lastWindow.bytesOut,
  };
}

/** Forget every room (the inspector's Clear). */
export function clearObservedNetwork(): void {
  mirrors.splice(0, mirrors.length);
  log.splice(0, log.length);
  notify();
}

export const observedGameNetwork: NetworkingAdapter = {
  peers(): NetPeer[] {
    return mirrors
      .filter((mirror) => mirror.state === 'connected')
      .map((mirror) => ({ id: mirror.sessionId, label: `${roomNames.get(mirror.roomId) ?? mirror.roomId} (this client)` }));
  },
  networkId: () => null,
  authority: () => 'server',
  editable: () => false,
  getConnectionState(): ConnectionState {
    return current()?.state ?? 'disconnected';
  },
  getRoomInfo(): RoomInfo | null {
    const mirror = current();
    if (!mirror) return null;
    return { roomId: mirror.roomId, sessionId: mirror.sessionId, roomName: roomNames.get(mirror.roomId) ?? '' };
  },
  getReplicationStats(): ReplicationStats {
    const mirror = current();
    const refs = (mirror?.serializer?.decoder as { root?: { refs?: Map<unknown, unknown> } } | undefined)?.root?.refs;
    const now = rates();
    return { entities: refs?.size ?? 0, msgsInPerSec: now.msgsInPerSec, msgsOutPerSec: now.msgsOutPerSec };
  },
  subscribe(callback) {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
  getStateSnapshot: () => stateJson(current()),
  messageEvents(sinceSeq = 0): NetMessageEvent[] {
    return log.filter((event) => event.seq > sinceSeq);
  },
  getRates: rates,
  sendMessage(type: string, payload: unknown): void {
    const mirror = current();
    if (!mirror || mirror.state !== 'connected') throw new Error('No room is connected to send into.');
    // The SDK's own framing (`Room.send`): the ROOM_DATA code, the type, then the msgpack payload.
    const head = new Uint8Array(1 + 5 + type.length * 3);
    head[0] = ROOM_DATA;
    const it: Iterator = { offset: 1 };
    encode.string(head as unknown as Parameters<typeof encode.string>[0], type, it);
    const body = payload === undefined ? new Uint8Array(0) : new Uint8Array(pack(payload));
    const frame = new Uint8Array(it.offset + body.byteLength);
    frame.set(head.subarray(0, it.offset));
    frame.set(body, it.offset);
    // Through the game's own socket, so the send is observed and logged like any other.
    mirror.socket.send(frame);
  },
  getConditioning: () => ({ ...conditioning }),
  setConditioning(next: NetConditioning): void {
    conditioning = { latencyMs: Math.max(0, next.latencyMs), jitterMs: Math.max(0, next.jitterMs), packetLoss: 0 };
    notify();
  },
  getConditioningLimits: () => ({
    packetLoss: 'A WebSocket is reliable and ordered: a lost packet is resent, so loss is not simulated here.',
  }),
  ping(): Promise<number> {
    const mirror = current();
    if (!mirror || mirror.state !== 'connected') return Promise.reject(new Error('No room is connected to ping.'));
    return new Promise((resolve, reject) => {
      pingWaiters.set(mirror, resolve);
      setTimeout(() => {
        if (pingWaiters.get(mirror) !== resolve) return;
        pingWaiters.delete(mirror);
        reject(new Error('The server did not answer the ping within 5 s.'));
      }, 5000);
      // The SDK's own PING frame (`Room.ping`), through the game's socket; the SDK ignores the
      // answer to a ping it did not send.
      mirror.socket.send(new Uint8Array([PING]));
    });
  },
  async inspectServer(roomId?: string): Promise<NetServerInspection | null> {
    const mirror = current();
    if (!mirror) return null;
    const api = monitorApi(mirror);
    const list = await monitorJson<MonitorRooms>(`${api}/`);
    if (!list) return null;
    const inspected = roomId ?? mirror.roomId;
    const detail = await monitorJson<MonitorRoom>(`${api}/room?roomId=${encodeURIComponent(inspected)}`);
    const maxClients = (value: string | number | null | undefined): number | null => {
      const count = Number(value);
      return Number.isFinite(count) ? count : null;
    };
    return {
      rooms: (list.rooms ?? []).map((room) => ({
        roomId: room.roomId,
        name: room.name,
        clients: room.clients,
        maxClients: maxClients(room.maxClients),
        locked: room.locked === true,
        elapsedMs: room.elapsedTime ?? 0,
      })),
      connections: list.connections ?? 0,
      cpuPercent: typeof list.cpu === 'number' && Number.isFinite(list.cpu) ? list.cpu : null,
      memory:
        list.memory?.usedMemMb !== undefined && list.memory.totalMemMb !== undefined
          ? { usedMb: list.memory.usedMemMb, totalMb: list.memory.totalMemMb }
          : null,
      room: detail
        ? {
            roomId: inspected,
            clients: (detail.clients ?? []).map((client) => ({ sessionId: client.sessionId, elapsedMs: client.elapsedTime })),
            stateBytes: detail.stateSize ?? 0,
          }
        : null,
    };
  },
  disconnectClient: (sessionId: string, roomId?: string) =>
    roomCall('_forceClientDisconnect', [sessionId], 'the disconnect', roomId),
  editServerState: (path: readonly (string | number)[], value: unknown) =>
    roomCall('_editStateProperty', [path, value], 'the state edit'),
  deleteServerState: (path: readonly (string | number)[]) =>
    roomCall('_deleteStateProperty', [path], 'the state delete'),
  sendToClient: (sessionId: string, type: string, payload: unknown, roomId?: string) =>
    roomCall('_sendMessageToClient', [sessionId, type, payload], 'the send', roomId),
  broadcast: (type: string, payload: unknown, roomId?: string) =>
    roomCall('broadcast', [type, payload], 'the broadcast', roomId),
  disposeRoom: (roomId?: string) => roomCall('disconnect', [], 'the dispose', roomId),
  getTrafficByType() {
    const mirror = current();
    return mirror ? [...mirror.types.values()].map(({ type, countIn, countOut, bytesIn, bytesOut }) => ({ type, countIn, countOut, bytesIn, bytesOut })) : [];
  },
  getServerConfig() {
    const mirror = current();
    if (!mirror) return null;
    const roomName = roomNames.get(mirror.roomId);
    return roomName ? { endpoint: mirror.endpoint, roomName } : { endpoint: mirror.endpoint };
  },
};
