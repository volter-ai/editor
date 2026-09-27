/**
 * THE WORKTREE'S VERSION CONTROL — the git half of what used to be one
 * `WorkspaceSessionControl` component taking a `section` prop.
 *
 * `components/ShareSessionPanel.tsx` rendered TWO unrelated surfaces out of
 * one 850-line function: share invitations, roles and tunnel health (the
 * collaboration lane's, and now `@vgai/collaboration`'s `ShareAccessSection`)
 * and this one — status, stage, checkpoint, publish, pull request. Only this
 * half had a host caller (`components/WorktreeSwitcher.tsx`), and moving a
 * project's changes into another checkout is the worktree board's job whether
 * or not anybody is sharing the session. The two halves shared exactly
 * `error` and `busy`, which is what a split costs.
 */

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  fontSizeVar,
  spaceVar,
  TextInput,
  themeVars,
} from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState } from 'react';
import {
  checkEditorGitReadiness,
  checkpointEditorGit,
  createEditorPullRequest,
  type EditorGitStatus,
  editorGitStatus,
  editorPullRequestStatus,
  fetchEditorGit,
  mergeEditorPullRequest,
  publishEditorGit,
  resolveEditorGitRebase,
  stageEditorGit,
  updateEditorGit,
} from '../editor-git-client';

export function VersionControlSection() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [git, setGit] = useState<EditorGitStatus | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [gitNotice, setGitNotice] = useState<string | null>(null);
  const [gitOperation, setGitOperation] = useState<string | null>(null);
  const [pullRequestTitle, setPullRequestTitle] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const gitAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    void editorGitStatus()
      .then((value) => {
        setGit(value);
        setSelectedPaths(value.changed.map((entry) => entry.path));
      })
      .catch((cause) => setError(String(cause)));
  }, []);

  const acceptGitStatus = (value: EditorGitStatus) => {
    setGit(value);
    setSelectedPaths((current) =>
      current.filter((path) => value.changed.some((item) => item.path === path)),
    );
  };

  const gitAction = async (
    action: (signal: AbortSignal) => Promise<EditorGitStatus>,
    notice: string,
    operation?: string,
  ) => {
    const controller = new AbortController();
    gitAbort.current = controller;
    setGitOperation(operation ?? null);
    setBusy(true);
    setError(null);
    setGitNotice(null);
    try {
      acceptGitStatus(await action(controller.signal));
      setGitNotice(notice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (gitAbort.current === controller) gitAbort.current = null;
      setGitOperation(null);
      setBusy(false);
    }
  };

  const createPullRequest = (title: string) => {
    setPullRequestTitle(null);
    void createEditorPullRequest({ title })
      .then((result) => {
        acceptGitStatus(result.status);
        setGitNotice(`Pull request: ${result.url}`);
      })
      .catch((cause) => setError(String(cause)));
  };

  const mergePullRequest = () => {
    setConfirmMerge(false);
    const controller = new AbortController();
    gitAbort.current = controller;
    setGitOperation('Merging pull request');
    setBusy(true);
    void mergeEditorPullRequest(controller.signal)
      .then((result) => setGitNotice(`Merged pull request: ${result.url}`))
      .catch((cause) => setError(String(cause)))
      .finally(() => {
        if (gitAbort.current === controller) gitAbort.current = null;
        setGitOperation(null);
        setBusy(false);
      });
  };

  return (
    <section className="vgai-worktree-version-control">
      {error && (
        <div
          style={{ color: themeVars.semantic.danger, fontSize: fontSizeVar.sm, marginBottom: 5 }}
        >
          {error}
        </div>
      )}
      {git?.available ? (
        <details style={{ marginTop: spaceVar[4] }}>
          <summary style={{ cursor: 'pointer', fontSize: fontSizeVar.sm }}>
            Git · {git.branch ?? 'detached'} ·{' '}
            {git.dirty ? `${git.changed.length} changed` : 'clean'}
            {git.baseAhead !== null && git.baseBehind !== null
              ? ` · base +${git.baseAhead}/-${git.baseBehind}`
              : ''}
            {git.ahead !== null && git.behind !== null
              ? ` · remote +${git.ahead}/-${git.behind}`
              : ''}
          </summary>
          <div style={{ display: 'grid', gap: 5, marginTop: 5, fontSize: fontSizeVar.sm }}>
            <span style={{ color: themeVars.content.dim }}>
              {git.repositoryId.slice(0, 20)} · {git.worktreeId.slice(0, 20)}
            </span>
            {git.changed.map((entry) => {
              const hunks = git.hunks.filter((hunk) => hunk.path === entry.path);
              return (
                <div key={entry.path} style={{ display: 'grid', gap: 3 }}>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <Checkbox
                      aria-label={`Include ${entry.path} in checkpoint`}
                      checked={selectedPaths.includes(entry.path)}
                      onChange={(event) =>
                        setSelectedPaths((current) =>
                          event.target.checked
                            ? [...current, entry.path]
                            : current.filter((path) => path !== entry.path),
                        )
                      }
                    />
                    <code style={{ minWidth: 0, flex: 1 }}>
                      {entry.index}
                      {entry.worktree} {entry.path}
                    </code>
                    <Button
                      type="button"
                      size="compact"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void gitAction(
                          () =>
                            stageEditorGit({
                              path: entry.path,
                              staged: entry.index !== ' ' && entry.index !== '?',
                            }),
                          entry.index !== ' ' && entry.index !== '?'
                            ? `Unstaged ${entry.path}.`
                            : `Staged ${entry.path}.`,
                        )
                      }
                    >
                      {entry.index !== ' ' && entry.index !== '?' ? 'Unstage file' : 'Stage file'}
                    </Button>
                  </div>
                  {hunks.map((hunk) => (
                    <div
                      key={hunk.id}
                      style={{ display: 'flex', gap: 5, paddingLeft: 22, alignItems: 'center' }}
                    >
                      <code style={{ minWidth: 0, flex: 1, color: themeVars.content.dim }}>
                        {hunk.header} · +{hunk.additions}/-{hunk.deletions}
                      </code>
                      <Button
                        type="button"
                        size="compact"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void gitAction(
                            () =>
                              stageEditorGit({
                                path: hunk.path,
                                hunkId: hunk.id,
                                staged: hunk.staged,
                              }),
                            hunk.staged ? 'Hunk unstaged.' : 'Hunk staged.',
                          )
                        }
                      >
                        {hunk.staged ? 'Unstage hunk' : 'Stage hunk'}
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })}
            {git.rebaseInProgress && (
              <div
                role="alert"
                style={{ display: 'grid', gap: 5, color: themeVars.semantic.warning }}
              >
                <span>
                  Rebase paused
                  {git.conflicts.length > 0 ? ` · conflicts: ${git.conflicts.join(', ')}` : ''}
                </span>
                <span style={{ display: 'flex', gap: 5 }}>
                  <Button
                    type="button"
                    size="compact"
                    variant="outline"
                    disabled={busy || git.conflicts.length > 0}
                    onClick={() =>
                      void gitAction(() => resolveEditorGitRebase('continue'), 'Rebase continued.')
                    }
                  >
                    Continue rebase
                  </Button>
                  <Button
                    type="button"
                    size="compact"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void gitAction(() => resolveEditorGitRebase('abort'), 'Rebase aborted.')
                    }
                  >
                    Abort rebase
                  </Button>
                </span>
              </div>
            )}
            {git.dirty && (
              <div style={{ display: 'flex', gap: 5 }}>
                <TextInput
                  aria-label="Git checkpoint message"
                  placeholder="Checkpoint message"
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  style={{ minWidth: 0, flex: 1 }}
                />
                <Button
                  type="button"
                  size="compact"
                  variant="outline"
                  disabled={busy || !commitMessage.trim() || selectedPaths.length === 0}
                  onClick={() =>
                    void gitAction(
                      () => checkpointEditorGit({ paths: selectedPaths, message: commitMessage }),
                      'Selected paths checkpointed with verified account attribution.',
                    ).then(() => setCommitMessage(''))
                  }
                >
                  Checkpoint
                </Button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <Button
                type="button"
                size="compact"
                variant="outline"
                disabled={busy || !git.remoteUrl}
                onClick={() =>
                  void gitAction(fetchEditorGit, 'Remote refs fetched and pruned.', 'Fetching')
                }
              >
                Fetch
              </Button>
              <Button
                type="button"
                size="compact"
                variant="outline"
                disabled={busy || git.dirty || !git.remoteUrl}
                onClick={() => void gitAction(publishEditorGit, 'Branch published.', 'Publishing')}
              >
                Publish
              </Button>
              <Button
                type="button"
                size="compact"
                variant="outline"
                disabled={busy || git.dirty || !git.baseRef}
                onClick={() =>
                  void gitAction(
                    updateEditorGit,
                    'Branch rebased onto its base.',
                    'Fetching and rebasing',
                  )
                }
              >
                Update from base
              </Button>
              <Button
                type="button"
                size="compact"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void checkEditorGitReadiness()
                    .then((result) => {
                      acceptGitStatus(result.status);
                      setGitNotice(
                        result.ready
                          ? 'Merge-ready; no merge was performed.'
                          : result.reasons.join(' '),
                      );
                    })
                    .catch((cause) => setError(String(cause)))
                }
              >
                Check merge readiness
              </Button>
              {git.github && git.upstream && (
                <>
                  <Button
                    type="button"
                    size="compact"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setPullRequestTitle(commitMessage || git.branch || 'Volter Editor changes')
                    }
                  >
                    Create PR
                  </Button>
                  <Button
                    type="button"
                    size="compact"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void editorPullRequestStatus()
                        .then((result) =>
                          setGitNotice(
                            result.available
                              ? `PR ${result.state ?? 'open'} · ${result.mergeState ?? 'status unknown'} · checks ${result.checks?.passed ?? 0} passed/${result.checks?.pending ?? 0} pending/${result.checks?.failed ?? 0} failed${result.reviewDecision ? ` · review ${result.reviewDecision}` : ''}${result.url ? ` · ${result.url}` : ''}`
                              : (result.reason ?? 'No pull request found.'),
                          ),
                        )
                        .catch((cause) => setError(String(cause)))
                    }
                  >
                    PR status
                  </Button>
                  <Button
                    type="button"
                    size="compact"
                    variant="outline"
                    disabled={busy || git.dirty || git.rebaseInProgress}
                    onClick={() => setConfirmMerge(true)}
                  >
                    Merge PR…
                  </Button>
                </>
              )}
            </div>
            {gitOperation && (
              <div role="status" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span>{gitOperation}…</span>
                <Button
                  type="button"
                  size="compact"
                  variant="ghost"
                  onClick={() => gitAbort.current?.abort()}
                >
                  Cancel
                </Button>
              </div>
            )}
            {git.history.length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', color: themeVars.content.dim }}>
                  Recent history
                </summary>
                <div style={{ display: 'grid', gap: 3, paddingTop: spaceVar[2] }}>
                  {git.history.map((commit) => (
                    <span key={commit.sha} title={`${commit.author} · ${commit.authoredAt}`}>
                      <code>{commit.shortSha}</code> · {commit.subject}
                    </span>
                  ))}
                </div>
              </details>
            )}
            {gitNotice && <span style={{ color: themeVars.semantic.success }}>{gitNotice}</span>}
          </div>
        </details>
      ) : (
        <span style={{ color: themeVars.content.dim, fontSize: fontSizeVar.sm }}>
          Loading version control…
        </span>
      )}
      {pullRequestTitle !== null && (
        <Dialog
          labelledBy="vgai-pull-request-title-heading"
          onDismiss={() => setPullRequestTitle(null)}
        >
          <DialogHeader
            titleId="vgai-pull-request-title-heading"
            title="Create pull request"
            description={`Opens a pull request for ${git?.branch ?? 'this branch'} on its remote.`}
          />
          <DialogBody>
            <TextInput
              aria-label="Pull request title"
              autoFocus
              value={pullRequestTitle}
              onChange={(event) => setPullRequestTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !pullRequestTitle.trim()) return;
                event.preventDefault();
                createPullRequest(pullRequestTitle.trim());
              }}
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPullRequestTitle(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!pullRequestTitle.trim()}
              onClick={() => createPullRequest(pullRequestTitle.trim())}
            >
              Create pull request
            </Button>
          </DialogFooter>
        </Dialog>
      )}
      {confirmMerge && (
        <Dialog labelledBy="vgai-merge-pr-heading" onDismiss={() => setConfirmMerge(false)}>
          <DialogHeader
            titleId="vgai-merge-pr-heading"
            title="Merge pull request"
            description={`Merging the pull request for ${git?.branch ?? 'this branch'} changes the remote repository.`}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmMerge(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={mergePullRequest}>
              Merge pull request
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </section>
  );
}
