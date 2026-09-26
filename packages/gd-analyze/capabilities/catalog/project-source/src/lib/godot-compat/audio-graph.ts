/**
 * A port's own Web Audio graph — the `AudioContext`, the master `GainNode`, the autoplay unlock,
 * and the mute bit the host's `AudioAdapter` reads.
 *
 * Everything a translated Godot game plays hangs off ONE context and ONE master node:
 * `audio.ts`'s `AudioStreamPlayer`, `audio-3d.ts`'s positional player, and `audio-reverb.ts`'s
 * buses. This file is where that pair is created, unlocked and muted, so the emitted world holds
 * the glue (decoding `res://` streams, building the authored reverb buses, naming the nodes for the
 * editor's Audio tab) and none of the machinery.
 *
 * ## Why the port owns a graph at all, when the engine ships one
 *
 * `packages/engine/src/setup/setup-audio.ts` is the first-party equivalent — master gain,
 * `music`/`sfx`/`voice` buses, a `resume()` — and a first-party vgai world uses it. A PORT cannot,
 * for the same reason `audio.ts`'s header gives for not riding `THREE.Audio`: the signature is
 * `setupAudio(camera: THREE.Camera)`, which constructs a `THREE.AudioListener` on a camera, and
 * this lane spans BOTH surfaces. Two of the committed ports are `adapter: "canvas"` PixiJS worlds
 * (`dodge-port`, `starter-kit-match-3-port`) with no camera and no `Object3D` anywhere; binding to
 * that door would mean importing three into a Pixi bundle to obtain a gain node. The day
 * `setupAudio` grows a camera-free factory, {@link GodotAudioGraphHandle.open} becomes a call to it
 * and this file keeps only the mute bit.
 *
 * That is the whole extent of the duplication: the bus HIERARCHY, a listener object, and three.js
 * positional audio are the engine's and are not reimplemented here. This is the same conclusion the
 * Unity lane reached and the same shape it shipped (`unity-compat/audio-graph.ts`); the two lanes
 * are deliberately transcriptions of one another rather than two inventions.
 *
 * ## RESOURCE OWNERSHIP
 *
 * No module-scoped state — {@link createGodotAudioGraph} is a pure factory, for the reason the
 * barrel's header gives: this file is COPIED beside a port and its module scope is shared by every
 * evaluation of every port, while an `AudioContext` is one per port. The emitted `src/world.tsx`
 * instantiates exactly one at its own module scope, beside its stream cache.
 *
 * OWNER of the context and the master node is that instance. SHARERS are every player built by
 * `audio.ts`/`audio-3d.ts` (which allocate source and gain nodes onto the master node) and
 * `audio-reverb.ts`'s buses (one input chain per authored `default_bus_layout` bus); none of them
 * creates a context and none may end one. The ONE teardown is the emitted world's effect cleanup,
 * which calls {@link GodotAudioGraphHandle.detachResume} and disconnects the nodes IT built. The
 * context is deliberately NOT closed: a remount reuses this handle, and a closed `AudioContext`
 * cannot be reopened — a memoized stream cache handing out buffers for a closed context is silent
 * dead audio for the rest of the session.
 *
 * ## The context is opened LAZILY, and that is a contract rather than an optimisation
 *
 * Construction alone is what browsers count against the autoplay policy, and a headless harness has
 * no `AudioContext` constructor at all. So nothing here touches Web Audio until the first
 * {@link GodotAudioGraphHandle.open}, which the emitted world calls from its mount effect and never
 * at module evaluation.
 */

import { dbToLinear } from '@volter/game-runtime/audio/bus-mixer';
import {
  bindGodotAudioEffectResource,
  type GodotAudioEffectChain,
  type GodotAudioEffectResource,
} from './audio-effects';

/** The port's graph, as the two members every sharer touches. */
export interface GodotAudioGraph {
  readonly context: AudioContext;
  /** Godot's bus 0 input, `Master` — the node `audio.ts` resolves an unmatched bus name to. */
  readonly destination: GainNode;
  /** The real Web Audio buses, in Godot's authored index order. */
  readonly buses: readonly GodotAudioBus[];
  /** Godot `get_bus_index`: exact StringName match, or `-1`. */
  busIndex(name: string): number;
  /** Resolve a player bus name with Godot's playback fallback to bus 0. */
  busInput(name: string): AudioNode;
  /** Strict indexed access for AudioServer calls. */
  bus(index: number): GodotAudioBus;
  /** Replace the default Master-only layout with the project's authored bus rows. */
  configureBuses(specs: readonly GodotAudioBusSpec[]): void;
  /** Insert an exact native effect or a multi-node effect chain before the bus volume stage. */
  insertBusEffect(name: string, effect: AudioNode | GodotAudioEffectChain): () => void;
  addBus(atPosition?: number): void;
  setBusName(index: number, name: string): void;
  setBusSend(index: number, send: string): void;
  addBusEffect(busIndex: number, effect: GodotAudioEffectResource, atPosition?: number): void;
  getBusEffect(busIndex: number, effectIndex: number): GodotAudioEffectResource;
  getBusEffectCount(busIndex: number): number;
  removeBusEffect(busIndex: number, effectIndex: number): void;
  setBusEffectEnabled(busIndex: number, effectIndex: number, enabled: boolean): void;
  /** Godot AudioServer.get_bus_effect_instance; analyzers expose their retained native instance. */
  busEffectInstance(busIndex: number, effectIndex: number): unknown;
}

/** The authored part of one `AudioBusLayout` row. Effects remain native Web Audio nodes/chains. */
export interface GodotAudioBusSpec {
  readonly name: string;
  readonly volumeDb: number;
  readonly mute: boolean;
  readonly send: string;
}

/** One Godot bus backed by the graph's real GainNodes rather than mirrored state. */
export interface GodotAudioBus {
  readonly index: number;
  name: string;
  /** Players and upstream buses connect here. */
  readonly input: GainNode;
  /** The bus's post-effect volume stage. */
  readonly gain: GainNode;
  volumeDb: number;
  muted: boolean;
  send: string;
}

export interface GodotAudioGraphHandle {
  /** The context and master node, constructing them on the first call. */
  open: () => GodotAudioGraph;
  /** `AudioAdapter.resume` — unlock the context from a host-driven user gesture. */
  resume: () => void;
  /** `AudioAdapter.setMuted`. Restores the master gain's own prior value, never a hardcoded 1. */
  setMuted: (muted: boolean) => void;
  /** `AudioAdapter.isMuted`. */
  isMuted: () => boolean;
  /** Drop the pending autoplay-unlock listeners. The emitted world's ONE cleanup calls this. */
  detachResume: () => void;
}

/**
 * Create one port's audio graph. See the header for why this is a factory and what owns the
 * instance.
 */
export function createGodotAudioGraph(): GodotAudioGraphHandle {
  let context: AudioContext | null = null;
  let graph: GodotAudioGraph | null = null;
  let hostGate: GainNode | null = null;
  let detach: (() => void) | null = null;
  let muted = false;

  /**
   * Browsers start an `AudioContext` suspended until a user gesture. One `once` listener per
   * gesture kind, both removed by whichever fires first, so a resumed graph leaves nothing behind.
   */
  function armAutoplayUnlock(live: AudioContext): void {
    if (live.state === 'running' || detach !== null || typeof window === 'undefined') return;
    const remove = (): void => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      if (detach === remove) detach = null;
    };
    const resume = (): void => {
      remove();
      void live.resume();
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    detach = remove;
  }

  function open(): GodotAudioGraph {
    if (context === null || graph === null) {
      const live = new AudioContext();
      // Host mute is deliberately a separate output gate. AudioServer mutates the Master bus's
      // own gain, and muting the editor/session must never overwrite that authored/runtime value.
      const outputGate = live.createGain();
      outputGate.connect(live.destination);
      hostGate = outputGate;

      const records: GodotAudioBus[] = [];
      interface BusEffectPort {
        readonly identity: AudioNode | GodotAudioEffectChain;
        readonly input: AudioNode;
        readonly output: AudioNode;
        readonly resource?: GodotAudioEffectResource;
        readonly effectInstances: readonly (unknown | null)[];
        readonly release: () => void;
        enabled: boolean;
      }
      const effects = new Map<GodotAudioBus, BusEffectPort[]>();
      let configuredSignature: string | null = null;
      const assertDb = (db: number, label: string): void => {
        if (typeof db !== 'number' || Number.isNaN(db) || db === Number.POSITIVE_INFINITY) {
          throw new Error(`${label} must be a decibel value or -Infinity; received ${String(db)}.`);
        }
      };

      const applyGain = (bus: GodotAudioBus): void => {
        bus.gain.gain.value = bus.muted ? 0 : dbToLinear(bus.volumeDb);
      };

      const makeBus = (spec: GodotAudioBusSpec): GodotAudioBus => {
        const index = records.length;
        assertDb(spec.volumeDb, `AudioBusLayout bus ${index} volume_db`);
        if (typeof spec.mute !== 'boolean') {
          throw new Error(`AudioBusLayout bus ${index} mute must be a bool.`);
        }
        const input = live.createGain();
        const volume = live.createGain();
        let volumeDb = spec.volumeDb;
        let busMuted = spec.mute;
        const bus: GodotAudioBus = {
          get index(): number {
            return records.indexOf(bus);
          },
          name: spec.name,
          input,
          gain: volume,
          get volumeDb(): number {
            return volumeDb;
          },
          set volumeDb(value: number) {
            assertDb(value, `AudioServer.set_bus_volume_db(${index})`);
            volumeDb = value;
            applyGain(bus);
          },
          get muted(): boolean {
            return busMuted;
          },
          set muted(value: boolean) {
            if (typeof value !== 'boolean') {
              throw new Error(`AudioServer.set_bus_mute(${index}) requires a bool.`);
            }
            busMuted = value;
            applyGain(bus);
          },
          send: spec.send,
        };
        input.connect(volume);
        applyGain(bus);
        return bus;
      };

      const reconnectEffects = (bus: GodotAudioBus): void => {
        bus.input.disconnect();
        const chain = effects.get(bus) ?? [];
        for (const item of chain) item.output.disconnect();
        let previous: AudioNode = bus.input;
        for (const item of chain) {
          if (!item.enabled) continue;
          previous.connect(item.input);
          previous = item.output;
        }
        previous.connect(bus.gain);
      };

      const reconnectSends = (): void => {
        for (const bus of records) bus.gain.disconnect();
        for (const bus of records) {
          if (bus.index === 0) {
            bus.gain.connect(outputGate);
            continue;
          }
          const target = records.find((candidate) => candidate.name === bus.send);
          bus.gain.connect(target !== undefined && target.index < bus.index ? target.input : records[0]!.input);
        }
      };

      const configureBuses = (specs: readonly GodotAudioBusSpec[]): void => {
        if (specs.length === 0 || specs[0]?.name !== 'Master') {
          throw new Error('AudioBusLayout must declare bus 0 as "Master".');
        }
        const names = new Set<string>();
        for (const [index, spec] of specs.entries()) {
          if (typeof spec.name !== 'string' || typeof spec.send !== 'string') {
            throw new Error(`AudioBusLayout bus ${index} name and send must be StringNames.`);
          }
          if (spec.name.length === 0) throw new Error(`AudioBusLayout bus ${index} has an empty name.`);
          if (names.has(spec.name)) {
            throw new Error(`AudioBusLayout has duplicate bus name ${JSON.stringify(spec.name)}.`);
          }
          names.add(spec.name);
          assertDb(spec.volumeDb, `AudioBusLayout bus ${index} volume_db`);
          if (typeof spec.mute !== 'boolean') {
            throw new Error(`AudioBusLayout bus ${index} mute must be a bool.`);
          }
          if (index === 0 && spec.send !== '') {
            throw new Error(`AudioBusLayout Master send must be empty; received ${JSON.stringify(spec.send)}.`);
          }
        }
        // JSON serializes every non-finite number as null. Validation above rules out NaN/+INF,
        // while this tagged representation keeps Godot's valid -INF distinct for idempotence.
        const signature = JSON.stringify(
          specs.map((spec) => ({
            ...spec,
            volumeDb:
              spec.volumeDb === Number.NEGATIVE_INFINITY ? { negativeInfinity: true } : spec.volumeDb,
          })),
        );
        if (configuredSignature !== null) {
          if (configuredSignature === signature) return;
          const defaultSignature = JSON.stringify([
            { name: 'Master', volumeDb: 0, mute: false, send: '' },
          ]);
          if (configuredSignature !== defaultSignature || records.length !== 1) {
            throw new Error('GodotAudioGraph cannot be reconfigured with a different bus layout.');
          }
          records[0]!.volumeDb = specs[0]!.volumeDb;
          records[0]!.muted = specs[0]!.mute;
          for (const [index, spec] of specs.entries()) {
            if (index > 0) records.push(makeBus(spec));
          }
        } else {
          for (const spec of specs) records.push(makeBus(spec));
        }
        configuredSignature = signature;
        reconnectSends();
      };

      // Godot's exact no-layout default: one unmuted, 0 dB Master bus.
      configureBuses([{ name: 'Master', volumeDb: 0, mute: false, send: '' }]);
      const liveGraph: GodotAudioGraph = {
        context: live,
        get destination(): GainNode {
          return records[0]!.input;
        },
        buses: records,
        busIndex: (name) => records.findIndex((candidate) => candidate.name === name),
        busInput: (name) => records.find((candidate) => candidate.name === name)?.input ?? records[0]!.input,
        bus: (index) => {
          if (!Number.isSafeInteger(index) || index < 0 || index >= records.length) {
            throw new Error(`AudioServer bus index ${String(index)} is outside [0, ${records.length}).`);
          }
          return records[index]!;
        },
        configureBuses,
        addBus: (atPosition = -1) => {
          if (!Number.isSafeInteger(atPosition)) {
            throw new Error(`AudioServer.add_bus position ${String(atPosition)} is not an integer.`);
          }
          let position = atPosition;
          if (position >= records.length) position = -1;
          else if (position === 0) position = records.length > 1 ? 1 : -1;
          let name = 'New Bus';
          let suffix = 1;
          while (records.some((candidate) => candidate.name === name)) {
            suffix += 1;
            name = `New Bus ${String(suffix)}`;
          }
          const bus = makeBus({ name, volumeDb: 0, mute: false, send: '' });
          if (position < 0) records.push(bus);
          else records.splice(position, 0, bus);
          reconnectEffects(bus);
          reconnectSends();
        },
        setBusName: (index, name) => {
          const bus = liveGraph.bus(index);
          if (typeof name !== 'string') throw new Error('AudioServer.set_bus_name requires a String.');
          if (index === 0 && name !== 'Master') return;
          if (bus.name === name) return;
          let unique = name;
          let suffix = 1;
          while (records.some((candidate) => candidate !== bus && candidate.name === unique)) {
            suffix += 1;
            unique = `${name} ${String(suffix)}`;
          }
          bus.name = unique;
          reconnectSends();
        },
        setBusSend: (index, send) => {
          const bus = liveGraph.bus(index);
          if (typeof send !== 'string') throw new Error('AudioServer.set_bus_send requires a StringName.');
          bus.send = send;
          reconnectSends();
        },
        addBusEffect: (busIndex, resource, atPosition = -1) => {
          const bus = liveGraph.bus(busIndex);
          if (resource === null || typeof resource !== 'object' ||
            typeof resource.spec !== 'function' || typeof resource.subscribe !== 'function') {
            throw new Error('AudioServer.add_bus_effect requires a retained AudioEffect resource.');
          }
          if (!Number.isSafeInteger(atPosition)) {
            throw new Error(`AudioServer.add_bus_effect position ${String(atPosition)} is not an integer.`);
          }
          const effect = bindGodotAudioEffectResource(live, resource);
          const port: BusEffectPort = {
            identity: effect,
            input: effect.input,
            output: effect.output,
            resource,
            effectInstances: effect.effectInstances ?? [effect.spectrum ?? null],
            release: () => effect.dispose(),
            enabled: true,
          };
          const chain = effects.get(bus) ?? [];
          if (atPosition < 0 || atPosition >= chain.length) chain.push(port);
          else chain.splice(atPosition, 0, port);
          effects.set(bus, chain);
          reconnectEffects(bus);
        },
        getBusEffect: (busIndex, effectIndex) => {
          const bus = liveGraph.bus(busIndex);
          const port = (effects.get(bus) ?? [])[effectIndex];
          if (port === undefined) {
            throw new Error(`AudioServer effect index ${String(effectIndex)} is outside bus ${String(busIndex)}.`);
          }
          if (port.resource === undefined) {
            throw new Error('AudioServer.get_bus_effect cannot expose an authored composite without its retained Resource identity.');
          }
          return port.resource;
        },
        getBusEffectCount: (busIndex) => (effects.get(liveGraph.bus(busIndex)) ?? []).length,
        removeBusEffect: (busIndex, effectIndex) => {
          const bus = liveGraph.bus(busIndex);
          const chain = effects.get(bus) ?? [];
          if (!Number.isSafeInteger(effectIndex) || effectIndex < 0 || effectIndex >= chain.length) {
            throw new Error(`AudioServer effect index ${String(effectIndex)} is outside bus ${String(busIndex)}.`);
          }
          const [removed] = chain.splice(effectIndex, 1);
          removed!.release();
          reconnectEffects(bus);
        },
        setBusEffectEnabled: (busIndex, effectIndex, enabled) => {
          const bus = liveGraph.bus(busIndex);
          const port = (effects.get(bus) ?? [])[effectIndex];
          if (port === undefined) {
            throw new Error(`AudioServer effect index ${String(effectIndex)} is outside bus ${String(busIndex)}.`);
          }
          if (typeof enabled !== 'boolean') throw new Error('AudioServer.set_bus_effect_enabled requires a bool.');
          if (port.enabled === enabled) return;
          port.enabled = enabled;
          reconnectEffects(bus);
        },
        busEffectInstance: (busIndex, effectIndex) => {
          const bus = liveGraph.bus(busIndex);
          if (!Number.isSafeInteger(effectIndex) || effectIndex < 0) return null;
          const inserted = effects.get(bus) ?? [];
          let remaining = effectIndex;
          for (const port of inserted) {
            if (port.effectInstances.length > 0) {
              if (remaining < port.effectInstances.length) return port.effectInstances[remaining] ?? null;
              remaining -= port.effectInstances.length;
              continue;
            }
            if (remaining === 0) return null;
            remaining -= 1;
          }
          return null;
        },
        insertBusEffect: (name, effect) => {
          const bus = records.find((candidate) => candidate.name === name);
          if (bus === undefined) throw new Error(`Audio bus ${JSON.stringify(name)} does not exist.`);
          const isChain = 'input' in effect && 'output' in effect && 'dispose' in effect;
          const port: BusEffectPort = isChain
            ? { identity: effect, input: effect.input, output: effect.output, effectInstances: effect.effectInstances ?? [effect.spectrum ?? null], release: () => effect.dispose(), enabled: true }
            : { identity: effect, input: effect, output: effect, effectInstances: [null], release: () => effect.disconnect(), enabled: true };
          const chain = effects.get(bus) ?? [];
          chain.push(port);
          effects.set(bus, chain);
          reconnectEffects(bus);
          let released = false;
          return () => {
            if (released) return;
            released = true;
            const at = chain.indexOf(port);
            if (at >= 0) chain.splice(at, 1);
            port.release();
            reconnectEffects(bus);
          };
        },
      };
      context = live;
      graph = liveGraph;
    }
    armAutoplayUnlock(context);
    return graph;
  }

  return {
    open,
    resume: () => {
      const live = open().context;
      if (live.state === 'suspended') void live.resume();
    },
    setMuted: (next: boolean) => {
      if (typeof next !== 'boolean') throw new Error('Godot audio host mute requires a bool.');
      if (next === muted) return;
      muted = next;
      open();
      // Host/session mute gates the real output without touching AudioServer's Master state.
      hostGate!.gain.value = next ? 0 : 1;
    },
    isMuted: () => muted,
    detachResume: () => {
      detach?.();
    },
  };
}
