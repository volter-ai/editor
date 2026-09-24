import type {
  ReflectionProbeConfig,
  ReflectionProbeMark,
  ReflectionProbeSnapshot,
} from '@volter/threejs-runtime/adapter/reflection-probe';

export interface MutableReflectionProbeMark extends ReflectionProbeMark {
  updateConfig(config: ReflectionProbeConfig): void;
  setCaptureStatus(snapshot: ReflectionProbeSnapshot): void;
}

/** One live projection of a component's JSX props and capture state. */
export function createReflectionProbeMark(
  initial: ReflectionProbeConfig,
): MutableReflectionProbeMark {
  let config = initial;
  let configSignature = JSON.stringify(initial);
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
      config = next;
      configSignature = signature;
      if (next.captureMode !== 'manual') {
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
