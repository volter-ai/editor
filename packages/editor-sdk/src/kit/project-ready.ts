/**
 * THE PROJECT-READY HOOK — the host's side of `host.project.onReady`: the
 * moment both bootstraps (`the world root's stage`'s boot chain, after the scene
 * loads and the composite installs; `NonThreeAuthoringBootstrap`'s, after
 * its composite installs) reach when a lane may auto-launch what the
 * manifest declares. Listeners run in registration order, each awaited, so
 * a later one may read what an earlier one mounted.
 *
 * LATCHED, per project, for the same reason `hosted-example.ts`'s auto-play
 * decision is: this hook's registrants are PACKAGE SERVICES, and a
 * contribution pass is asynchronous — it can finish on either side of the
 * boot chain. Unlatched, a service that registered one tick late simply
 * never ran, and the lane it starts (the ingest auto-launch) silently
 * did nothing for the whole session; measured 2026-09-17 on a staged
 * vendored game, which mounted nothing at all. The latch is keyed to the
 * project that reached ready, so opening a second project does not fire its
 * services against the first project's boot.
 */
import { getCurrentProject } from '@volter/editor-sdk/kit/project-manager';

const listeners = new Set<() => void | Promise<void>>();

/** The `rootPath` of the project whose boot chain last reached ready. */
let readyFor: string | null = null;

function currentProjectKey(): string | null {
  return getCurrentProject()?.rootPath ?? null;
}

export function onProjectReady(fn: () => void | Promise<void>): () => void {
  listeners.add(fn);
  const key = currentProjectKey();
  if (key !== null && readyFor === key) void fn();
  return () => {
    listeners.delete(fn);
  };
}

export async function runProjectReady(): Promise<void> {
  readyFor = currentProjectKey();
  for (const fn of [...listeners]) await fn();
}
