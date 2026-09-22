import { createServer } from 'node:net';

/**
 * Can `port` be bound on the loopback interface right now?
 *
 * `unref()` before `listen` is the load-bearing line, and the reason this probe
 * is one exported function rather than four lines copied per caller: a probe
 * socket left ref'd holds the event loop open for the whole listen→close
 * window, so a CLI command that finishes while a probe is in flight waits on it
 * instead of exiting. The two copies this replaces disagreed about exactly that
 * call, which means the same question had two different process-exit behaviours
 * depending on which port scanner asked it.
 *
 * "Bindable right now" is the whole answer — the port can be taken between this
 * probe and the caller's real `listen`, so every caller still handles
 * `EADDRINUSE` on the actual bind.
 */
export async function loopbackPortFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolveFree) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', () => resolveFree(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolveFree(true)));
  });
}
