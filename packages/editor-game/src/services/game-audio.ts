/**
 * THE PAGE'S VIEW OF A RUNNING GAME'S WEB AUDIO — the editor's own audio adapter for a game
 * that declares none (the ingest way: the game is idiomatic code, and the editor reads it).
 *
 * UNLOCK. A game running in the editor's page can create its AudioContext before the
 * visitor's first gesture (survivor's auto-attack lands kills while they are still reading),
 * and browsers with a strict autoplay policy then hold it suspended until `resume()` runs
 * INSIDE a trusted input handler. The game's own unlock listeners go through the realm's
 * gated re-dispatch, which is no longer that trusted stack — two human passes heard both
 * flagship canvas games silent on first load and cured them only by restarting under a
 * gesture (runhuman 23/33). The EDITOR owns the page, so it wraps the page's AudioContext
 * constructor once at boot to track instances, and resumes any suspended one from
 * capture-phase pointerdown/keydown handlers — the real, trusted stack.
 *
 * MUTE AND THE GRAPH. The same wrap is what lets the editor pause a game's sound and show
 * what it built without the game implementing anything: every connection a game makes to
 * its context's destination is routed through one editor-owned gain per context, and every
 * connection is recorded. {@link observedGameAudio} is that adapter; Play installs it for a
 * game whose systems declare no `audio` (`play-mode.ts`).
 */

import type { AudioAdapter, AudioGraphNode } from '@volter/editor-project/adapter/system-adapter';

const tracked = new Set<WeakRef<AudioContext>>();

function resumeSuspended(): void {
  for (const ref of tracked) {
    const ctx = ref.deref();
    if (!ctx || ctx.state === 'closed') {
      tracked.delete(ref);
      continue;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  }
}

/** Install once at editor boot (`audio.service.ts`). Idempotent. */
export function installGameAudio(): void {
  const host = window as unknown as { __vgaiAudioUnlock?: boolean } & typeof window;
  if (host.__vgaiAudioUnlock) return;
  host.__vgaiAudioUnlock = true;
  const Orig = window.AudioContext;
  if (typeof Orig !== 'function') return;
  window.AudioContext = class extends Orig {
    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args);
      tracked.add(new WeakRef(this));
      trackedContexts.add(this);
    }
  };
  installConnectionRecorder();
  window.addEventListener('pointerdown', resumeSuspended, { capture: true });
  window.addEventListener('keydown', resumeSuspended, { capture: true });
}

// ---- Routing and recording -------------------------------------------------------------

/** One editor gain per tracked context, between the game's graph and the real output. */
const buses = new WeakMap<BaseAudioContext, GainNode>();
const trackedContexts = new WeakSet<BaseAudioContext>();
let muted = false;

/** The game's recorded connections: node → the nodes it feeds. */
const outputs = new WeakMap<AudioNode, Set<AudioNode>>();
const seen = new Set<WeakRef<AudioNode>>();
const ids = new WeakMap<AudioNode, string>();
let nextId = 0;

function idOf(node: AudioNode): string {
  if (node instanceof AudioDestinationNode) return 'destination';
  let id = ids.get(node);
  if (!id) {
    id = `n${++nextId}`;
    ids.set(node, id);
    seen.add(new WeakRef(node));
  }
  return id;
}

function installConnectionRecorder(): void {
  const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
  const disconnect = AudioNode.prototype.disconnect as (this: AudioNode, ...args: unknown[]) => unknown;
  const busFor = (context: BaseAudioContext): GainNode => {
    let bus = buses.get(context);
    if (!bus) {
      bus = context.createGain();
      bus.gain.value = muted ? 0 : 1;
      connect.call(bus, context.destination);
      buses.set(context, bus);
    }
    return bus;
  };
  const routed = (target: unknown): unknown =>
    target instanceof AudioDestinationNode && trackedContexts.has(target.context) ? busFor(target.context) : target;
  AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
    const [target, ...rest] = args;
    if (target instanceof AudioNode && !(buses.get(this.context) === this)) {
      idOf(this);
      idOf(target);
      let set = outputs.get(this);
      if (!set) outputs.set(this, (set = new Set()));
      set.add(target);
    }
    const result = connect.call(this, routed(target), ...rest);
    // A game chains `a.connect(b).connect(c)`: it gets back what it asked for.
    return target instanceof AudioDestinationNode ? target : result;
  } as typeof AudioNode.prototype.connect;
  AudioNode.prototype.disconnect = function (this: AudioNode, ...args: unknown[]) {
    const [target] = args;
    if (target === undefined || typeof target === 'number') outputs.delete(this);
    else if (target instanceof AudioNode) outputs.get(this)?.delete(target);
    return disconnect.call(this, ...(args.length ? [routed(target), ...args.slice(1)] : []));
  } as typeof AudioNode.prototype.disconnect;
}

/** Silence every tracked game context, or restore it; the game's own gains are untouched. */
function setGameAudioMuted(next: boolean): void {
  muted = next;
  for (const ref of tracked) {
    const bus = ref.deref() && buses.get(ref.deref()!);
    if (bus) bus.gain.value = next ? 0 : 1;
  }
}

/** What the game has built, as the recorded connections read it now. */
function gameAudioGraph(): AudioGraphNode[] {
  const nodes: AudioGraphNode[] = [];
  let destination = false;
  for (const ref of seen) {
    const node = ref.deref();
    if (!node) {
      seen.delete(ref);
      continue;
    }
    const targets = [...(outputs.get(node) ?? [])];
    if (targets.some((target) => target instanceof AudioDestinationNode)) destination = true;
    nodes.push({ id: idOf(node), type: node.constructor.name, outputs: targets.map(idOf), state: node.context.state });
  }
  if (destination) nodes.push({ id: 'destination', type: 'AudioDestinationNode', label: 'Output', outputs: [] });
  return nodes;
}

/**
 * The editor's audio adapter for a game whose systems declare none: mute through the editor's
 * bus, resume through the trusted-gesture unlock, and the graph the game built.
 */
export const observedGameAudio: AudioAdapter = {
  resume: resumeSuspended,
  setMuted: setGameAudioMuted,
  isMuted: () => muted,
  graphSnapshot: gameAudioGraph,
};
