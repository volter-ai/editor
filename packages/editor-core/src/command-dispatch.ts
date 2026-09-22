/**
 * EVERY RELAYED COMMAND, observed — the host's side of
 * `host.session.onCommandDispatched`. `command-listener.ts` notes each
 * command's type at the top of its dispatch; an idle watchdog (Play's
 * recording: "an agent still driving through `vgai eval` is not idle,
 * whatever the command was") subscribes rather than being named there.
 */
const listeners = new Set<(type: string) => void>();

export function onCommandDispatched(fn: (type: string) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function noteCommandDispatched(type: string): void {
  for (const fn of listeners) fn(type);
}
