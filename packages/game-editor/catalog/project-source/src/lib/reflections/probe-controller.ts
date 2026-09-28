import type {
  ReflectionProbeConfig,
  ReflectionProbeMark,
  ReflectionProbeSnapshot,
} from '@volter/threejs-runtime/adapter/reflection-probe';

/**
 * How a probe lights the diffuse term of the volume material that blends it,
 * carried in its mark's config beside the format-neutral fields. Every field
 * is optional; left out, a probe lights the diffuse from its capture, scaled
 * by its `intensity`, as the reflected term is.
 */
export interface ReflectionProbeDiffuse {
  /**
   * Where the probe's diffuse light comes from: its `capture` (the default), the
   * constant `color` below, or `none` — the probe lights no diffuse, and a
   * fragment that only it covers keeps the environment's.
   */
  readonly diffuse?: 'capture' | 'color' | 'none';
  /** Scales the probe's diffuse light. Defaults to the probe's `intensity`. */
  readonly diffuseIntensity?: number;
  /** Linear RGB radiance of the `color` diffuse. */
  readonly diffuseColor?: readonly [number, number, number];
}

/** A probe's config as the capability's own element states it. */
export type VolumeReflectionProbeConfig = ReflectionProbeConfig & ReflectionProbeDiffuse;

export interface MutableReflectionProbeMark extends ReflectionProbeMark {
  updateConfig(config: ReflectionProbeConfig): void;
  setCaptureStatus(snapshot: ReflectionProbeSnapshot): void;
}

/**
 * The config as a capture sees it: everything but the diffuse fields, which
 * only the volume material reads (from the probe's uniforms, not its capture).
 */
function captureSignature(config: ReflectionProbeConfig): string {
  const { diffuse, diffuseIntensity, diffuseColor, ...captured } = config as VolumeReflectionProbeConfig;
  return JSON.stringify(captured);
}

/**
 * One live projection of a component's JSX props and capture state. A config
 * change that a capture sees queues a recapture (outside Manual); one that
 * only changes the diffuse fields takes effect without one.
 */
export function createReflectionProbeMark(
  initial: ReflectionProbeConfig,
): MutableReflectionProbeMark {
  let config = initial;
  let configSignature = JSON.stringify(initial);
  let capturedSignature = captureSignature(initial);
  let revision = 0;
  let snapshot: ReflectionProbeSnapshot = {
    status: initial.captureMode === 'manual' ? 'idle' : 'queued',
    lastCapturedAt: null,
  };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get config() {
      return config;
    },
    get revision() {
      return revision;
    },
    recapture() {
      revision += 1;
      snapshot = { status: 'queued', lastCapturedAt: snapshot.lastCapturedAt };
      notify();
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateConfig(next) {
      const signature = JSON.stringify(next);
      if (signature === configSignature) return;
      const previousMode = config.captureMode;
      const nextCaptured = captureSignature(next);
      const recapture = nextCaptured !== capturedSignature;
      config = next;
      configSignature = signature;
      capturedSignature = nextCaptured;
      // A diffuse-only change needs no capture: the registry sees the new config
      // and the volume material rewrites its uniforms.
      if (recapture && next.captureMode !== 'manual') {
        revision += 1;
        snapshot = { status: 'queued', lastCapturedAt: snapshot.lastCapturedAt };
      } else if (previousMode !== 'manual' && snapshot.status !== 'ready') {
        // Entering Manual never performs an implicit capture. A valid existing
        // result remains valid; otherwise the explicit Recapture button is the
        // only operation that advances the capture revision.
        snapshot = { status: 'idle', lastCapturedAt: snapshot.lastCapturedAt };
      }
      notify();
    },
    setCaptureStatus(next) {
      if (
        next.status === snapshot.status &&
        next.lastCapturedAt === snapshot.lastCapturedAt &&
        next.message === snapshot.message
      ) {
        return;
      }
      snapshot = next;
      notify();
    },
  };
}
