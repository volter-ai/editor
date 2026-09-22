/**
 * WHICH CODING HARNESSES CAN BE DELEGATED TO — the eleventh registry in the
 * family of `workspace-document-restore.ts` (a kind owns its persisted state),
 * `document-open-registry.ts` (a kind owns how it opens), `chrome-slot-registry
 * .ts` (the host owns the place, a package owns what sits there),
 * `content-entry-source-registry.ts` (the host owns the Content scope, a
 * package owns why a component is content) and the seven since. Here: the host
 * owns the DELEGATE FORM — the task text, the isolation choice, the branch
 * name, the button, the notice line and `delegateEditorTask` itself — and a
 * package owns WHICH AGENTS EXIST.
 *
 * WHY IT EXISTS. `components/WorktreeSwitcher.tsx`'s Delegate form was the
 * single edge holding `api/agents.ts` and its three wire modules in the
 * editor's eager import closure (WORK.md §The open-source launch, the four
 * that remained of the harness bucket): it called `getHarnessChatSnapshot()`
 * to list which harnesses are installed, and it named two of them by hand
 * (`claude`, `codex`) for its container isolation. A base library for making
 * IDEs should not know the name of a coding agent.
 *
 * THE DOOR THE RECORD NAMED WAS A BIGGER ONE, AND THE CODE DID NOT WANT IT.
 * Unit 21 specified "a chrome slot that can hand its filler a dismiss/refresh
 * callback", i.e. the whole form becoming `@vgai/agents`' surface. Measured
 * against the form: of its ~120 lines, everything but the harness `<Select>`
 * is the worktree board's own vocabulary — the branch slug, the three
 * isolations, the copy about sibling checkouts and bounded containers, and
 * `delegateEditorTask` (`api/worktrees.ts`, a `keep`-bucket module whose wire
 * already takes a `harness` string). Moving it would have put the board's
 * delegation UI inside the agents package AND changed `ChromeSlotFiller` —
 * whose whole claim is that a slot is a PLACE, rendered `<filler.Content />`
 * with no props — for every existing filler. What the host actually cannot
 * answer is one question, so one question is what it asks.
 *
 * ASKED PER ISOLATION, because the answer differs and only the source knows
 * how: a worktree or in-place delegation needs a harness that is INSTALLED and
 * can start, while a bounded container authenticates the harness inside its
 * own temporary home, so "installed here" is not the question. The host passes
 * the isolation and reads a list; which of its harnesses satisfies which is
 * the package's to decide.
 *
 * NOTHING REGISTERED IS A REAL ANSWER. With no source, the picker says "No
 * harness ready" and Delegate stays disabled — the same honest emptiness a
 * document kind with no registered opener gives. That is not a regression
 * risk for any shipped build: `WorktreeSwitcher` renders only in `server`
 * editor mode, and every dev session loads `@vgai/agents` through
 * `SESSION_PACKAGES` (`server/project-tools.ts`), while a build with no
 * session has no board at all.
 */

/** How a delegated task is isolated from the caller's checkout — the board's
 *  own vocabulary, passed to a source as the question's context. */
export type DelegateIsolation = 'worktree' | 'current' | 'container';

export interface DelegateHarness {
  /** The value `delegateEditorTask({ harness })` takes. */
  readonly id: string;
  /** What the picker shows. */
  readonly label: string;
}

export interface DelegateHarnessSource {
  /** Which module registered it. Re-registering the same owner REPLACES, so
   *  an HMR re-evaluation leaves one source, not two. */
  readonly owner: string;
  /** Ascending; ties keep registration order. */
  readonly order?: number;
  /** Asking is a fetch, so this is async; the form re-asks whenever the
   *  isolation or the registry version changes. */
  readonly harnesses: (isolation: DelegateIsolation) => Promise<readonly DelegateHarness[]>;
}

const _sources: DelegateHarnessSource[] = [];
const listeners = new Set<() => void>();
let version = 0;

function publish(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Install a source. Returns the teardown. */
export function registerDelegateHarnessSource(source: DelegateHarnessSource): () => void {
  const stale = _sources.findIndex((item) => item.owner === source.owner);
  if (stale >= 0) _sources.splice(stale, 1);
  _sources.push(source);
  _sources.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  publish();
  return () => {
    const at = _sources.indexOf(source);
    if (at < 0) return;
    _sources.splice(at, 1);
    publish();
  };
}

/**
 * THE HOST'S ONE QUESTION. Every source's answer, in registration order, with
 * the first claim on an id winning — two packages offering the same harness is
 * one harness, and the one that registered earlier named it.
 *
 * A source that throws is skipped rather than taking the form down with it:
 * the picker degrades to the harnesses that did answer, which is the same
 * shape as no source at all.
 */
export async function delegateHarnesses(
  isolation: DelegateIsolation,
): Promise<readonly DelegateHarness[]> {
  const seen = new Set<string>();
  const out: DelegateHarness[] = [];
  for (const source of _sources) {
    let answered: readonly DelegateHarness[];
    try {
      answered = await source.harnesses(isolation);
    } catch {
      continue;
    }
    for (const harness of answered) {
      if (seen.has(harness.id)) continue;
      seen.add(harness.id);
      out.push(harness);
    }
  }
  return out;
}

/** The form's `useSyncExternalStore` subscription: a source arriving with a
 *  contribution pass re-asks the question. */
export function subscribeDelegateHarnessSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function delegateHarnessRegistryVersion(): number {
  return version;
}

/** Test-only reset (mirrors the restore, open, chrome-slot and content-entry
 *  registries'). */
export function __resetDelegateHarnessSourcesForTest(): void {
  _sources.length = 0;
  publish();
}
