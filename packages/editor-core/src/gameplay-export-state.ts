// Transport ownership is observable by both the UI and command relay.
let active = false;
const listeners = new Set<() => void>();
export const isGameplayExportActive = () => active;
export function subscribeGameplayExport(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setGameplayExportActive(value: boolean) {
  active = value;
  for (const listener of listeners) listener();
}
