/**
 * THE SERVICE POINT (page side) — code a package RUNS for as long as its
 * contributions are loaded (WORKBENCH.md §Contribution points, `service`):
 * a page-wide guard, a worker, a listener. The module declares the point and
 * exports `start`, which returns the stop; the host starts every service
 * after a contribution pass and stops it before the next.
 *
 *   `audio-unlock.service.ts`
 *     export const point = 'workspace.service';
 *     export function start(): () => void { … }
 *
 * A service that must run BEFORE a project opens does not belong here — it
 * is the host's boot. Everything that only matters once a project's own
 * packages are known does.
 */
export interface ServiceContribution {
  start(): (() => void) | undefined | void;
}
