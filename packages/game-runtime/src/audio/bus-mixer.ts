/**
 * A named-bus mixer over Web Audio: buses created on demand, routed into each
 * other by name, and set in DECIBELS.
 *
 * Every mixer a game reaches for is this shape — Unity's `AudioMixerGroup`,
 * Godot's bus layout, FMOD's VCAs, and the `music`/`sfx`/`voice` trio
 * `setup/setup-audio.ts` hands a first-party three world. What they share is
 * not the protocol (that part is genuinely per-ecosystem and stays with the
 * lane that speaks it) but the machinery underneath: a `GainNode` per bus, a
 * name → node map, a parent to route into, and the one conversion below. This
 * file owns exactly that, and nothing that names an ecosystem.
 *
 * ## dB is not a gain, and the mistake is silent
 *
 * `GainNode.gain` is a LINEAR amplitude multiplier; every mixer's authored
 * volume is logarithmic dB, where 0 dB is unity and −80 dB is silence. Writing
 * the dB number straight onto `gain.value` gives you a gain of −80 (a phase
 * inversion at 80x) where the author asked for silence, and it does not throw,
 * warn, or look wrong in a debugger — it is just loud. {@link dbToLinear} is
 * the one conversion, `10^(dB/20)`, which is both Godot's `db_to_linear`
 * (`core/math/math_funcs.h`: `exp(db * 0.11512925464970228…)`, the same
 * function written in base e) and Unity's mixer volume curve.
 *
 * It deliberately does NOT clamp. A mixer's RANGE is protocol — Unity's
 * exposed parameters saturate at its slider's ends, Godot's `volume_db` does
 * not — so the lane that knows the range applies it before calling here, and
 * this file cannot silently mute or silently boost anyone's authored value.
 *
 * ## Create-on-demand, and why it is the contract rather than a convenience
 *
 * {@link AudioBusMixer.bus} MINTS a bus the first time it is named and returns
 * the SAME node forever after. The identity is the contract, not the minting:
 * a source connects to a bus long before anything sets that bus's volume, and
 * a parent is usually named by its child before anyone asks for it directly
 * (`bus('music', 'master')` builds `master` too, and the later `bus('master')`
 * must be that same node). A `bus()` that minted per call would hand the
 * volume control a SECOND node — the sources would keep feeding the first one,
 * every later write would land on a node nothing plays through, and nothing
 * would throw or look wrong. So the map is authoritative, and the only way a
 * name stops resolving to its node is {@link AudioBusMixer.remove} or
 * {@link AudioBusMixer.disconnect}.
 *
 * A re-ask that names a DIFFERENT parent throws by name. Routing is decided at
 * creation (the node is already connected by then), so honouring the second
 * parent would mean silently re-routing live audio and ignoring it would mean
 * silently keeping the first — a loud error is the only reading that is not a
 * lie.
 *
 * ## RESOURCE OWNERSHIP
 *
 * No module-scoped state: {@link createAudioBusMixer} is a factory and the
 * OWNER of an instance is whoever called it (a `setupAudio` graph, one
 * translated port's mixer store). What an instance ALLOCATES is one `GainNode`
 * per named bus, and disconnecting those is the whole of its teardown
 * obligation — {@link AudioBusMixer.disconnect}, called once by that same
 * owner. The `context` and the `destination` node are NOT its own: they are
 * passed in, shared with everything else hanging off the same graph, and this
 * file never creates, closes, suspends or disconnects either one.
 */

/**
 * The graph an {@link AudioBusMixer} hangs off, as the two members it touches.
 *
 * Narrow on purpose: `createGain` is all it needs from the context, so a real
 * `AudioContext`, an `OfflineAudioContext` and a headless stand-in are all
 * acceptable without a cast.
 */
export interface AudioBusMixerOptions {
  readonly context: { createGain(): GainNode };
  /** The node every parentless bus feeds. Usually a master gain or the context's destination. */
  readonly destination: AudioNode;
}

export interface AudioBusMixer {
  /**
   * The bus named `name`, created on the first ask and connected to `parent`
   * (itself created on demand) or to the destination.
   *
   * The returned node is the real `GainNode` — set `gain.value`, schedule
   * automation on `gain`, connect sources to it. Nothing here stands between a
   * caller and Web Audio's own API.
   */
  bus(name: string, parent?: string): GainNode;
  /** The bus named `name` if it EXISTS, else null. Never mints one. */
  find(name: string): GainNode | null;
  /** Set this bus's gain from decibels, creating it if absent. Clamp before calling — see the header. */
  setDb(name: string, db: number, parent?: string): void;
  /**
   * Disconnect one bus and forget its name, so a later {@link bus} mints a
   * fresh node. Buses that named it as their parent are NOT re-routed — they
   * keep feeding the removed node, which now reaches nothing.
   */
  remove(name: string): void;
  /** Disconnect every bus and forget them all. The owner's ONE teardown. */
  disconnect(): void;
}

/** dB → linear amplitude: `10^(dB/20)`. 0 dB is 1, −6 dB is ~0.5, −80 dB is ~0.0001. Never clamps. */
export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

interface BusRecord {
  readonly node: GainNode;
  readonly parent: string | undefined;
}

function safeDisconnect(node: GainNode): void {
  try {
    node.disconnect();
  } catch {
    // already disconnected
  }
}

/** Create one named-bus mixer. See the header for what owns the instance and what it allocates. */
export function createAudioBusMixer(options: AudioBusMixerOptions): AudioBusMixer {
  const { context, destination } = options;
  const buses = new Map<string, BusRecord>();

  function bus(name: string, parent?: string): GainNode {
    const existing = buses.get(name);
    if (existing !== undefined) {
      if (parent !== undefined && parent !== existing.parent) {
        throw new Error(
          `audio bus ${JSON.stringify(name)} already routes into ` +
            `${existing.parent === undefined ? 'the destination' : JSON.stringify(existing.parent)}` +
            `; it cannot also route into ${JSON.stringify(parent)}. Routing is decided when a bus ` +
            'is created (see packages/game-runtime/src/audio/bus-mixer.ts).',
        );
      }
      return existing.node;
    }
    // The parent is resolved (and minted, recursively) before this bus is
    // seated, so a conflicting-parent throw upstream leaves nothing half-built.
    const into = parent === undefined ? destination : bus(parent);
    const node = context.createGain();
    node.gain.value = 1;
    node.connect(into);
    buses.set(name, { node, parent });
    return node;
  }

  return {
    bus,
    find: (name) => buses.get(name)?.node ?? null,
    setDb: (name, db, parent) => {
      bus(name, parent).gain.value = dbToLinear(db);
    },
    remove: (name) => {
      const record = buses.get(name);
      if (record === undefined) return;
      buses.delete(name);
      safeDisconnect(record.node);
    },
    disconnect: () => {
      for (const record of buses.values()) safeDisconnect(record.node);
      buses.clear();
    },
  };
}
