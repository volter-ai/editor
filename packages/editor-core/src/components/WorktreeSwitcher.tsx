import { productCommand } from '../product-command';
import {
  faBoxArchive,
  faCheck,
  faCodeBranch,
  faCopy,
  faFileExport,
  faRotate,
  faShieldHalved,
  faStop,
  faTerminal,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import {
  AnchoredMenu,
  Button,
  EditorIcon,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  Text,
  TextArea,
  TextInput,
} from '@volter/editor-sdk/widgets';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  type DelegateHarness,
  type DelegateIsolation,
  delegateHarnesses,
  delegateHarnessRegistryVersion,
  subscribeDelegateHarnessSources,
} from '../delegate-harness-registry';
import {
  archiveEditorWorktree,
  createEditorWorktree,
  delegateEditorTask,
  type EditorIsolatedWorktree,
  type EditorRepositoryParticipant,
  type EditorWorktree,
  type EditorWorktreeState,
  exportIsolatedEditorWorktree,
  getEditorSessionWorktreeIdentity,
  isolatedEditorWorktreeLogs,
  listEditorWorktrees,
  openEditorWorktree,
  stopEditorWorktreeSession,
  stopIsolatedEditorWorktree,
} from '../editor-api';
import { COLLABORATION_REMOTE_SHARE } from '../editor-session-attribution';
import { VersionControlSection } from './VersionControlSection';

const EMPTY_STATE: EditorWorktreeState = { worktrees: [], branches: [], isolatedWorktrees: [] };

function branchSlug(task: string): string {
  const value = task
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 42);
  return `agent/${value || 'task'}`;
}

function DelegateTaskForm({
  currentLabel,
  onDone,
  onError,
}: {
  currentLabel: string;
  onDone: (result: Record<string, unknown>) => void;
  onError: (message: string) => void;
}) {
  const [task, setTask] = useState('');
  const [branch, setBranch] = useState('agent/task');
  const [branchTouched, setBranchTouched] = useState(false);
  const [isolation, setIsolation] = useState<DelegateIsolation>('worktree');
  const [harnessOptions, setHarnessOptions] = useState<readonly DelegateHarness[]>([]);
  const [harness, setHarness] = useState('');
  const [delegating, setDelegating] = useState(false);
  // WHICH AGENTS EXIST IS A REGISTERED ANSWER (`delegate-harness-registry.ts`).
  // This form used to call the harness lane's own HTTP client and name two
  // harnesses by hand for the container case — the one edge that held
  // `api/agents.ts` and its three wire modules in the editor's eager closure.
  // The registry version is a dependency because a contribution pass lands
  // ~9s into a cold boot, after this dropdown can already be open.
  const sourceVersion = useSyncExternalStore(
    subscribeDelegateHarnessSources,
    delegateHarnessRegistryVersion,
    delegateHarnessRegistryVersion,
  );
  useEffect(() => {
    let live = true;
    void delegateHarnesses(isolation).then((available) => {
      if (!live) return;
      setHarnessOptions(available);
      // Keep the choice when the new list still offers it; otherwise take the
      // first. The old code forced `codex` here, which is how the host came to
      // spell a harness name at all.
      setHarness((current) =>
        available.some((candidate) => candidate.id === current)
          ? current
          : (available[0]?.id ?? ''),
      );
    });
    return () => {
      live = false;
    };
  }, [isolation, sourceVersion]);
  return (
    <div className="vgai-worktree-delegate" role="group" aria-label="Delegate task">
      <Text as="div" variant="label">
        Delegate task
      </Text>
      <TextArea
        aria-label="Task for the agent"
        placeholder="Describe a bounded task…"
        value={task}
        onChange={(event) => {
          const value = event.target.value;
          setTask(value);
          if (!branchTouched) setBranch(branchSlug(value));
        }}
      />
      <label>
        <span>Harness</span>
        <Select value={harness} onChange={(event) => setHarness(event.target.value)}>
          {harnessOptions.length === 0 && <option value="">No harness ready</option>}
          {harnessOptions.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </Select>
      </label>
      <label>
        <span>Isolation</span>
        <Select
          value={isolation}
          onChange={(event) => {
            // Reconciling the harness choice with the new isolation belongs to
            // the effect above, which asks the registry what this isolation
            // offers; the old branch here spelled two harness names.
            setIsolation(event.target.value as DelegateIsolation);
          }}
        >
          <option value="worktree">New worktree (recommended)</option>
          <option value="container">Bounded container (untrusted code)</option>
          <option value="current">Current worktree (shared files)</option>
        </Select>
      </label>
      {isolation !== 'current' && (
        <label>
          <span>Branch</span>
          <TextInput
            aria-label="Delegated branch"
            value={branch}
            onChange={(event) => {
              setBranchTouched(true);
              setBranch(event.target.value);
            }}
          />
        </label>
      )}
      <Text as="div" variant="caption" tone="dim">
        {isolation === 'worktree'
          ? `Creates a sibling checkout from ${currentLabel}, opens its editor, and starts the agent there.`
          : isolation === 'container'
            ? 'Creates a credential-empty, resource-bounded Docker worktree. You authenticate the harness inside its temporary home.'
            : 'The agent edits the files in this live worktree alongside you.'}
      </Text>
      <Button
        type="button"
        variant="primary"
        size="compact"
        disabled={
          delegating || !task.trim() || !harness || (isolation !== 'current' && !branch.trim())
        }
        onClick={() => {
          setDelegating(true);
          void delegateEditorTask({
            task: task.trim(),
            harness,
            isolation,
            ...(isolation !== 'current' ? { branch: branch.trim(), from: 'HEAD' } : {}),
          })
            .then(onDone)
            .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
            .finally(() => setDelegating(false));
        }}
      >
        {delegating ? 'Delegating…' : 'Delegate'}
      </Button>
    </div>
  );
}

function folderName(path: string): string {
  return (
    path
      .replace(/[\\/]$/, '')
      .split(/[\\/]/)
      .at(-1) ?? path
  );
}

function worktreeDetail(worktree: EditorWorktree): string {
  const parts = worktree.current ? ['Current worktree'] : [folderName(worktree.root)];
  if (worktree.sessions.length > 0) parts.push('editor running');
  if (worktree.dirty) parts.push('uncommitted changes');
  else parts.push('clean');
  if (worktree.ahead) parts.push(`${worktree.ahead} ahead`);
  if (worktree.behind) parts.push(`${worktree.behind} behind`);
  const participants = worktreeParticipants(worktree);
  if (participants.length === 1) {
    const participant = participants[0]!;
    parts.push(
      participant.kind === 'agent'
        ? `${participant.displayName} ${participant.status}${participant.changeCount > 0 ? ` · ${participant.changeCount} changes` : ''}`
        : `${participant.displayName} here`,
    );
  } else if (participants.length > 1) parts.push(`${participants.length} collaborators here`);
  return parts.join(' · ');
}

function worktreeParticipants(worktree: EditorWorktree): EditorRepositoryParticipant[] {
  const participants = new Map<string, EditorRepositoryParticipant>();
  for (const session of worktree.sessions) {
    for (const participant of session.presence?.participants ?? []) {
      const previous = participants.get(participant.participantId);
      if (!previous || Date.parse(previous.lastSeenAt) < Date.parse(participant.lastSeenAt)) {
        participants.set(participant.participantId, participant);
      }
    }
  }
  return [...participants.values()].sort((left, right) => {
    const statusRank = { 'needs-input': 0, active: 1, idle: 2, done: 3 } as const;
    return (
      statusRank[left.status] - statusRank[right.status] ||
      left.displayName.localeCompare(right.displayName)
    );
  });
}

function participantInitials(participant: EditorRepositoryParticipant): string {
  if (participant.kind === 'agent') return 'AI';
  return participant.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? '')
    .join('');
}

function WorktreePresence({ worktree }: { worktree: EditorWorktree }) {
  const participants = worktreeParticipants(worktree);
  if (participants.length === 0) return null;
  const visible = participants.slice(0, 3);
  return (
    <span
      className="vgai-worktree-presence"
      role="img"
      aria-label={participants
        .map((participant) => `${participant.displayName}, ${participant.status}`)
        .join('; ')}
    >
      {visible.map((participant) => (
        <span
          key={participant.participantId}
          className="vgai-worktree-avatar"
          data-kind={participant.kind}
          data-status={participant.status}
          style={{ '--vgai-participant-color': participant.color } as CSSProperties}
          title={`${participant.displayName} · ${participant.kind} · ${participant.status}`}
          aria-hidden="true"
        >
          {participantInitials(participant)}
        </span>
      ))}
      {participants.length > visible.length && (
        <span className="vgai-worktree-avatar vgai-worktree-avatar-more" aria-hidden="true">
          +{participants.length - visible.length}
        </span>
      )}
    </span>
  );
}

/** Health, in words a reader can act on. `docker-unavailable` deliberately
 *  says nothing about the container: the daemon could not be reached, so its
 *  state is UNKNOWN rather than stopped. */
const ISOLATED_HEALTH_LABEL: Record<EditorIsolatedWorktree['health'], string> = {
  healthy: 'ready',
  starting: 'starting',
  unhealthy: 'running, editor not responding',
  stopped: 'stopped',
  'docker-unavailable': 'unknown — Docker not reachable',
};

function isolatedWorktreeDetail(worktree: EditorIsolatedWorktree): string {
  const state = ISOLATED_HEALTH_LABEL[worktree.health] ?? worktree.health;
  const limits = `${worktree.limits.cpus} CPU · ${worktree.limits.memory} RAM · ${worktree.limits.workspace} workspace`;
  return `${state} · ${limits} · allowlisted egress${worktree.exportedAt ? ' · exported' : ' · not exported'}`;
}

function matchesQuery(query: string, ...values: Array<string | null>): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || values.some((value) => value?.toLocaleLowerCase().includes(needle));
}

function worktreeRank(
  worktree: EditorWorktree,
  branchUpdatedAt: ReadonlyMap<string, number>,
): number[] {
  return [
    Number(!worktree.current),
    Math.min(
      ...worktreeParticipants(worktree).map((participant) =>
        participant.status === 'needs-input'
          ? 0
          : participant.status === 'active'
            ? 1
            : participant.status === 'idle'
              ? 2
              : 3,
      ),
    ),
    Number(worktree.branch === null),
    Number(worktree.sessions.length === 0),
    Number(!worktree.dirty),
    -(worktree.branch ? (branchUpdatedAt.get(worktree.branch) ?? 0) : 0),
  ];
}

function compareWorktrees(branchUpdatedAt: ReadonlyMap<string, number>) {
  return (left: EditorWorktree, right: EditorWorktree): number => {
    const leftRank = worktreeRank(left, branchUpdatedAt);
    const rightRank = worktreeRank(right, branchUpdatedAt);
    const rankDifference = leftRank.reduce(
      (difference, rank, index) => difference || rank - (rightRank[index] ?? 0),
      0,
    );
    return rankDifference || (left.branch ?? left.root).localeCompare(right.branch ?? right.root);
  };
}

function useWorktreePickerState() {
  const [state, setState] = useState<EditorWorktreeState>(EMPTY_STATE);
  const [sessionIdentity, setSessionIdentity] = useState<{
    branch: string | null;
    worktreeId: string | null;
  }>({ branch: null, worktreeId: null });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setState(await listEditorWorktrees());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (COLLABORATION_REMOTE_SHARE) return;
    let live = true;
    void getEditorSessionWorktreeIdentity()
      .then((identity) => {
        if (live) setSessionIdentity(identity);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const run = async (key: string, action: () => Promise<unknown>, close: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return { state, sessionIdentity, loading, busy, error, setError, refresh, run };
}

export function WorktreeSwitcher() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { state, sessionIdentity, loading, busy, error, setError, refresh, run } =
    useWorktreePickerState();

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  if (COLLABORATION_REMOTE_SHARE) return null;

  const current = state.worktrees.find((worktree) => worktree.current);
  const currentLabel =
    current?.branch ??
    sessionIdentity.branch ??
    (state.worktrees.length > 0 || sessionIdentity.worktreeId ? 'detached' : 'Branches');
  // `currentLabel` reads 'Branches' only when neither the worktree list nor the
  // session identity knows a branch.
  const knowsBranch = currentLabel !== 'Branches';
  const branchUpdatedAt = new Map(state.branches.map((branch) => [branch.name, branch.updatedAt]));
  const orderedWorktrees = [...state.worktrees].sort(compareWorktrees(branchUpdatedAt));
  const matchingWorktrees = orderedWorktrees.filter((worktree) =>
    matchesQuery(query, worktree.branch, worktree.root),
  );
  const matchingBranches = state.branches.filter(
    (branch) => !branch.worktreeId && matchesQuery(query, branch.name),
  );
  const matchingIsolated = state.isolatedWorktrees.filter((worktree) =>
    matchesQuery(query, worktree.branch, worktree.id),
  );
  const visibleWorktrees = matchingWorktrees.slice(0, query.trim() ? 30 : 10);
  const visibleBranches = matchingBranches.slice(0, query.trim() ? 50 : 20);
  const hiddenWorktrees = matchingWorktrees.length - visibleWorktrees.length;
  const hiddenBranches = matchingBranches.length - visibleBranches.length;
  const candidate = query.trim();
  const exactBranch = state.branches.some((branch) => branch.name === candidate);
  const hasMatches =
    matchingWorktrees.length > 0 || matchingBranches.length > 0 || matchingIsolated.length > 0;

  return (
    <div className="vgai-worktree-switcher">
      {/* A GLYPH, NOT A LABEL, and the measurement is why. This trigger used
          to draw the current branch name beside the icon: 204 CSS px of the
          top bar's left end, ellipsized at 1728 ("worktree-agent-ad85b645…"),
          in the band where Blender spends 16 on its app mark and starts its
          menu words at 32. The label was also REDUNDANT — the menu this
          button opens marks the current worktree with `data-current` and
          draws it in `content.primary`, so the branch is named at the one
          moment a person is asking which branch they are on. It stays in the
          accessible name and the tooltip, both of which cost no pixels.
          (Whether an open-source editor ships a worktree switcher at all is
          the owner's question, recorded in docs/WORK.md R1; this unit only
          made the block cost what Blender's costs.) */}
      <MenuTrigger
        ref={triggerRef}
        className="vgai-worktree-trigger"
        aria-label={
          knowsBranch
            ? `Branches and worktrees, current branch ${currentLabel}${current?.dirty ? ', uncommitted changes' : ''}`
            : 'Branches and worktrees'
        }
        aria-expanded={open}
        // The BRANCH NAME, on the label the glyph replaced. Gated on the LABEL,
        // not on `current`: a session whose worktree list has no `current` row
        // still knows its branch from the session identity, and that is the
        // common case in an agent worktree — gating on `current` silently
        // dropped the name from the one place left that says it.
        title={
          knowsBranch
            ? `Branches and worktrees — ${currentLabel}${current?.dirty ? ' (uncommitted changes)' : ''}`
            : 'Branches and worktrees'
        }
        onClick={() => {
          setOpen((value) => !value);
          if (!open) {
            setQuery('');
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <EditorIcon icon={faCodeBranch} />
        {current?.dirty && <span className="vgai-worktree-dirty-dot" aria-hidden="true" />}
        {current && <WorktreePresence worktree={current} />}
      </MenuTrigger>

      {open && (
        <AnchoredMenu
          anchorRef={triggerRef}
          align="start"
          clamp
          autoFocusFirst={false}
          className="vgai-worktree-menu"
          aria-label="Branches and worktrees"
          onDismiss={() => setOpen(false)}
        >
          <div className="vgai-worktree-search">
            <TextInput
              autoFocus
              aria-label="Find a branch"
              placeholder="Find a branch…"
              value={query}
              disabled={busy !== null || loading}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              variant="ghost"
              size="compact"
              aria-label="Refresh branches and worktrees"
              title="Refresh"
              disabled={busy !== null}
              onClick={() => void run('refresh', refresh, () => undefined)}
            >
              <EditorIcon icon={faRotate} />
            </Button>
          </div>

          <MenuSeparator />
          <div className="vgai-worktree-results">
            {loading && state.worktrees.length === 0 && (
              <Text as="div" variant="caption" tone="dim" className="vgai-worktree-empty">
                Loading branches…
              </Text>
            )}
            {matchingIsolated.length > 0 && (
              <section aria-label="Isolated worktrees">
                <Text as="div" variant="caption" tone="dim" className="vgai-worktree-section-label">
                  Isolated
                </Text>
                {matchingIsolated.map((worktree) => (
                  <div key={worktree.id} className="vgai-worktree-row-shell">
                    <MenuItem
                      className="vgai-worktree-menu-item"
                      disabled={worktree.health !== 'healthy' || busy !== null}
                      title={`Open isolated editor on port ${worktree.editorPort}. Egress: ${worktree.egressHosts.join(', ')}`}
                      onSelect={() => {
                        window.open(
                          `http://127.0.0.1:${worktree.editorPort}/`,
                          '_blank',
                          'noopener,noreferrer',
                        );
                      }}
                    >
                      <span className="vgai-worktree-row-icon">
                        <EditorIcon icon={faShieldHalved} />
                      </span>
                      <span className="vgai-worktree-row-copy">
                        <span className="vgai-worktree-row-title">{worktree.branch}</span>
                        <span className="vgai-worktree-row-detail">
                          {isolatedWorktreeDetail(worktree)}
                        </span>
                      </span>
                    </MenuItem>
                    <Button
                      type="button"
                      size="compact"
                      variant="ghost"
                      aria-label={`Copy agent attach command for ${worktree.branch}`}
                      title="Copy agent attach command"
                      disabled={busy !== null}
                      onClick={() => {
                        void navigator.clipboard?.writeText(
                          `${productCommand() ?? '<editor command>'} isolate agent ${worktree.id} codex`,
                        );
                        setNotice(
                          'Attach command copied. Authentication stays inside the container.',
                        );
                      }}
                    >
                      <EditorIcon icon={faTerminal} />
                    </Button>
                    <Button
                      type="button"
                      size="compact"
                      variant="ghost"
                      aria-label={`Show logs for ${worktree.branch}`}
                      title="Show startup logs"
                      disabled={busy !== null}
                      onClick={() => {
                        void isolatedEditorWorktreeLogs(worktree.id)
                          .then((logs) => setNotice(logs || 'No container logs yet.'))
                          .catch((cause) =>
                            setError(cause instanceof Error ? cause.message : String(cause)),
                          );
                      }}
                    >
                      <EditorIcon icon={faCopy} />
                    </Button>
                    <Button
                      type="button"
                      size="compact"
                      variant="ghost"
                      aria-label={`Export ${worktree.branch}`}
                      title="Export committed branch before teardown"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          `export:${worktree.id}`,
                          () => exportIsolatedEditorWorktree(worktree.id),
                          () => {
                            setNotice('Isolated branch exported as a Git bundle.');
                            void refresh(true);
                          },
                        )
                      }
                    >
                      <EditorIcon icon={faFileExport} />
                    </Button>
                    <Button
                      type="button"
                      size="compact"
                      variant="ghost"
                      aria-label={`Stop ${worktree.branch}`}
                      title="Stop after a current export"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          `stop-isolated:${worktree.id}`,
                          () => stopIsolatedEditorWorktree(worktree.id, false),
                          () => setOpen(false),
                        )
                      }
                    >
                      <EditorIcon icon={faStop} />
                    </Button>
                    <Button
                      type="button"
                      size="compact"
                      variant="ghost"
                      aria-label={`Discard ${worktree.branch}`}
                      title="Discard container and all unexported work"
                      disabled={busy !== null}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Discard ${worktree.branch}? Unexported commits and files cannot be recovered.`,
                          )
                        ) {
                          return;
                        }
                        void run(
                          `discard-isolated:${worktree.id}`,
                          () => stopIsolatedEditorWorktree(worktree.id, true),
                          () => setOpen(false),
                        );
                      }}
                    >
                      <EditorIcon icon={faTrash} />
                    </Button>
                  </div>
                ))}
              </section>
            )}
            {visibleWorktrees.length > 0 && (
              <section aria-label="Worktrees">
                <Text as="div" variant="caption" tone="dim" className="vgai-worktree-section-label">
                  Worktrees
                </Text>
                {visibleWorktrees.map((worktree) => {
                  const label = worktree.branch ?? 'Detached HEAD';
                  return (
                    <div key={worktree.worktreeId} className="vgai-worktree-row-shell">
                      <MenuItem
                        className="vgai-worktree-menu-item"
                        data-current={worktree.current || undefined}
                        disabled={worktree.current || !worktree.project || busy !== null}
                        aria-current={worktree.current ? 'true' : undefined}
                        title={worktree.root}
                        onSelect={() =>
                          void run(
                            worktree.worktreeId,
                            () => openEditorWorktree(worktree.worktreeId),
                            () => setOpen(false),
                          )
                        }
                      >
                        <span className="vgai-worktree-row-icon">
                          {worktree.current && <EditorIcon icon={faCheck} />}
                        </span>
                        <span className="vgai-worktree-row-copy">
                          <span className="vgai-worktree-row-title">
                            {label}
                            {worktree.dirty && (
                              <span className="vgai-worktree-dirty-dot" aria-hidden="true" />
                            )}
                          </span>
                          <span className="vgai-worktree-row-detail">
                            {busy === worktree.worktreeId ? 'Opening…' : worktreeDetail(worktree)}
                          </span>
                        </span>
                        <WorktreePresence worktree={worktree} />
                      </MenuItem>
                      {!worktree.current && worktree.sessions[0]?.sessionId && (
                        <Button
                          type="button"
                          size="compact"
                          variant="ghost"
                          aria-label={`Stop editor for ${label}`}
                          title="Stop editor session"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(
                              `stop:${worktree.worktreeId}`,
                              () =>
                                stopEditorWorktreeSession(
                                  worktree.worktreeId,
                                  worktree.sessions[0]!.sessionId!,
                                ),
                              () => setOpen(false),
                            )
                          }
                        >
                          <EditorIcon icon={faStop} />
                        </Button>
                      )}
                      {!worktree.current && worktree.sessions.length === 0 && !worktree.dirty && (
                        <Button
                          type="button"
                          size="compact"
                          variant="ghost"
                          aria-label={`Archive worktree ${label}`}
                          title="Archive clean worktree"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(
                              `archive:${worktree.worktreeId}`,
                              () => archiveEditorWorktree(worktree.worktreeId),
                              () => setOpen(false),
                            )
                          }
                        >
                          <EditorIcon icon={faBoxArchive} />
                        </Button>
                      )}
                    </div>
                  );
                })}
                {hiddenWorktrees > 0 && (
                  <Text as="div" variant="caption" tone="dim" className="vgai-worktree-more">
                    {hiddenWorktrees} more worktrees — search to narrow
                  </Text>
                )}
              </section>
            )}

            {visibleBranches.length > 0 && (
              <section aria-label="Local branches">
                <Text as="div" variant="caption" tone="dim" className="vgai-worktree-section-label">
                  Local branches
                </Text>
                {visibleBranches.map((branch) => (
                  <MenuItem
                    key={branch.name}
                    className="vgai-worktree-menu-item"
                    disabled={busy !== null}
                    onSelect={() =>
                      void run(
                        branch.name,
                        () => createEditorWorktree(branch.name),
                        () => setOpen(false),
                      )
                    }
                  >
                    <span className="vgai-worktree-row-icon" />
                    <span className="vgai-worktree-row-copy">
                      <span className="vgai-worktree-row-title">{branch.name}</span>
                      <span className="vgai-worktree-row-detail">
                        {busy === branch.name ? 'Creating worktree…' : 'Open in a new worktree'}
                      </span>
                    </span>
                  </MenuItem>
                ))}
                {hiddenBranches > 0 && (
                  <Text as="div" variant="caption" tone="dim" className="vgai-worktree-more">
                    {hiddenBranches} more {candidate ? 'matches' : 'branches'} — search to narrow
                  </Text>
                )}
              </section>
            )}

            {!loading && !hasMatches && !candidate && (
              <Text as="div" variant="caption" tone="dim" className="vgai-worktree-empty">
                No branches found.
              </Text>
            )}
          </div>

          {candidate && !exactBranch && !loading && (
            <>
              <MenuSeparator />
              <MenuItem
                className="vgai-worktree-create-command"
                disabled={busy !== null}
                onSelect={() =>
                  void run(
                    'create',
                    () => createEditorWorktree(candidate),
                    () => setOpen(false),
                  )
                }
              >
                <span className="vgai-worktree-row-icon">+</span>
                <span className="vgai-worktree-row-copy">
                  <span className="vgai-worktree-row-title">Create branch “{candidate}”</span>
                  <span className="vgai-worktree-row-detail">
                    {busy === 'create'
                      ? 'Creating worktree…'
                      : `From ${currentLabel}, in a new worktree`}
                  </span>
                </span>
              </MenuItem>
            </>
          )}

          {!candidate && (
            <>
              <MenuSeparator />
              {delegateOpen ? (
                <DelegateTaskForm
                  currentLabel={currentLabel}
                  onDone={(result) => {
                    if (result['isolation'] === 'container') {
                      const command =
                        typeof result['command'] === 'string' ? result['command'] : null;
                      const task = typeof result['task'] === 'string' ? result['task'] : null;
                      setNotice(
                        [
                          typeof result['message'] === 'string' ? result['message'] : null,
                          command ? `Attach: ${command}` : null,
                          task ? `Task: ${task}` : null,
                        ]
                          .filter(Boolean)
                          .join('\n'),
                      );
                      setDelegateOpen(false);
                      void refresh(true);
                      return;
                    }
                    setDelegateOpen(false);
                    setOpen(false);
                    void refresh(true);
                  }}
                  onError={setError}
                />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  className="vgai-worktree-delegate-open"
                  onClick={() => setDelegateOpen(true)}
                >
                  Delegate to agent…
                </Button>
              )}
              <MenuSeparator />
              <VersionControlSection />
            </>
          )}

          {error && (
            <Text
              as="div"
              variant="caption"
              tone="danger"
              role="alert"
              className="vgai-worktree-error"
            >
              {error}
            </Text>
          )}
          {notice && (
            <Text as="div" variant="caption" role="status" className="vgai-worktree-notice">
              {notice}
            </Text>
          )}
        </AnchoredMenu>
      )}
    </div>
  );
}
