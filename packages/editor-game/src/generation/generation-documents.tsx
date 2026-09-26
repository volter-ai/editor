import type { GenerationBilling, GenerationJob } from '@volter/editor-sdk/generations';
import { useEffect, useState, useSyncExternalStore } from 'react';
import './GenerationGallery.css';
import {
  accountSnapshot,
  accountVersion,
  contributionAccount,
  subscribeAccount,
} from '@volter/editor-sdk/kit/account-client';
import { toolContributionSurfaces } from '@volter/editor-sdk/kit/components/ToolContributionSurfaces';
import { ToolErrorBoundary } from '@volter/editor-core/components/ToolHost';
import { openToolDocument } from '@volter/editor-core/components/tool-documents';
import {
  subscribeToolContributionPlay,
  toolContributionPlay,
  toolContributionPlayKey,
} from '@volter/editor-sdk/kit/tool-contribution-play';
import {
  getGenerationResultContribution,
  getGlobalToolContributions,
  getToolContributionClient,
  subscribeToolContributions,
} from '@volter/editor-core/tool-loader';
import {
  closeWorkspaceDocument,
  openWorkspaceDocument,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { Button, TextInput } from '@volter/editor-sdk/widgets';
import {
  acceptGenerationJob,
  forgetGenerationJob,
  generationJobsSnapshot,
  inspectGenerationJob,
  subscribeGenerationJobs,
} from './generation-jobs';
import {
  GENERATION_STATE_LABEL,
  generationCardState,
  generationRemovable,
  generationSaveRetryable,
} from './generation-presentation';

const PREFIX = 'generation:';
export const GENERATION_CREATE_DOCUMENT_ID = 'generation:create';

function billingLabel(billing: GenerationBilling): string {
  if (billing.route === 'mock') return 'Free mock';
  if (billing.route === 'managed') {
    if (billing.settledCredits !== undefined) return `${billing.settledCredits} credits settled`;
    if (billing.estimatedCredits !== undefined) return `Up to ${billing.estimatedCredits} credits`;
    return 'VGAI subscription · estimate unavailable';
  }
  if (billing.settledAmount !== undefined) return `$${billing.settledAmount.toFixed(3)} settled`;
  if (billing.estimatedAmount !== undefined) return `Up to $${billing.estimatedAmount.toFixed(3)}`;
  return 'BYOK · estimate unavailable';
}

export function openGenerationDocument(job: GenerationJob): string {
  return openWorkspaceDocument({
    id: `${PREFIX}${job.id}`,
    title: job.label,
    kind: 'generation',
    workspaceRole: 'authored-subject',
    provenance: { origin: `${job.provider}:${job.externalId}` },
    Content: GenerationDocumentContent,
    closeable: true,
    presentation: () => ({ kind: 'generation', id: job.id }),
  });
}

export function openGenerationCreateDocument(): string {
  return openWorkspaceDocument({
    id: GENERATION_CREATE_DOCUMENT_ID,
    title: 'Create Asset',
    kind: 'generation',
    workspaceRole: 'workspace-task',
    provenance: { origin: 'registered generation tools' },
    Content: GenerationCreateDocumentContent,
    closeable: true,
    presentation: () => ({ kind: 'generation', id: 'create' }),
  });
}

export function GenerationCreateDocumentContent() {
  useSyncExternalStore(subscribeToolContributions, getGlobalToolContributions);
  useSyncExternalStore(subscribeAccount, accountVersion, accountVersion);
  const account = accountSnapshot();
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const tools = getGlobalToolContributions()
    .filter(
      (item) => item.point === 'workspace.document' && item.tool?.generation?.role === 'submit',
    )
    .filter((item) => {
      if (!normalized) return true;
      return [
        item.title,
        item.tool?.generation?.provider,
        item.tool?.summary,
        item.tool?.description,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  const providers = new Map<string, typeof tools>();
  for (const item of tools) {
    const provider = item.tool?.generation?.provider ?? 'other';
    providers.set(provider, [...(providers.get(provider) ?? []), item]);
  }
  return (
    <div className="vgai-tool-page" data-testid="generation-create-catalog">
      <header className="vgai-tool-header">
        <div className="vgai-tool-eyebrow">Installed provider extensions</div>
        <h2 className="vgai-tool-title">Create an asset</h2>
        <p className="vgai-tool-description">
          Choose a native provider operation. Mock, managed, and BYOK execution remain explicit in
          the operation you open. Current default: {account.preferredRoute}.
        </p>
      </header>
      <TextInput
        type="search"
        aria-label="Search generation tools"
        placeholder="Search operations or providers…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {[...providers.entries()].map(([provider, contributions]) => (
        <section className="vgai-tool-card" key={provider}>
          <h3 className="vgai-tool-section-title">{provider}</h3>
          <div className="vgai-generation-create-grid">
            {contributions.map((contribution) => (
              <Button
                variant="ghost"
                className="vgai-generation-create-card"
                key={contribution.id}
                onClick={() => openToolDocument(contribution.id)}
              >
                <strong>{contribution.title}</strong>
                <span>{contribution.tool?.summary}</span>
              </Button>
            ))}
          </div>
        </section>
      ))}
      {tools.length === 0 && (
        <div className="vgai-generation-document-empty">
          No installed generation operation matches this search.
        </div>
      )}
    </div>
  );
}

function ProviderResult({
  job,
  result,
  documentId,
  active,
}: {
  job: GenerationJob;
  result: unknown;
  documentId: string;
  active: boolean;
}) {
  // Subscribe to contribution discovery/HMR even though this document does
  // not otherwise consume the global document contribution list.
  useSyncExternalStore(subscribeToolContributions, getGlobalToolContributions);
  useSyncExternalStore(
    subscribeToolContributionPlay,
    toolContributionPlayKey,
    toolContributionPlayKey,
  );
  const contribution = getGenerationResultContribution(job.poll.tool, job, result);
  if (!contribution) {
    return <pre className="vgai-generation-native-result">{JSON.stringify(result, null, 2)}</pre>;
  }
  const Component = contribution.Component;
  return (
    <ToolErrorBoundary file={contribution.file}>
      <Component
        tool={contribution.tool}
        contributionId={contribution.id}
        client={getToolContributionClient()}
        surfaces={toolContributionSurfaces}
        account={contributionAccount()}
        play={toolContributionPlay()}
        documentId={documentId}
        active={active}
        job={job}
        result={result}
      />
    </ToolErrorBoundary>
  );
}

export function GenerationDocumentContent({ documentId, active }: WorkspaceDocumentContentProps) {
  const { jobs } = useSyncExternalStore(
    subscribeGenerationJobs,
    generationJobsSnapshot,
    generationJobsSnapshot,
  );
  const jobId = documentId.startsWith(PREFIX) ? documentId.slice(PREFIX.length) : documentId;
  const job = jobs.find((candidate) => candidate.id === jobId);
  const [result, setResult] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inspect = async (current: GenerationJob) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await inspectGenerationJob(current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!job) return;
    void inspect(job);
    // Re-inspect when a background transition reaches a new provider state;
    // polling within one state does not create a render loop.
  }, [job?.id, job?.status]);

  if (!job) {
    return (
      <div className="vgai-generation-document-empty">
        This generation is no longer in project activity.
      </div>
    );
  }

  // A finished job's recorded error is a failed SAVE, and the server has
  // already spent its automatic attempts — so it is stated here as a result,
  // with no promise of another try, and the Retry button is the door.
  const alert =
    error ??
    (generationCardState(job) === 'save-failed'
      ? `Could not save into the project: ${job.pollError}`
      : null);

  return (
    <div className="vgai-generation-document" data-status={job.status}>
      <header className="vgai-generation-document-header">
        <div>
          <div className="vgai-tool-eyebrow">
            {job.provider} · {job.operation}
          </div>
          <h2 className="vgai-tool-title">{job.label}</h2>
          <div className="vgai-generation-job-meta">
            {GENERATION_STATE_LABEL[generationCardState(job)]} · {billingLabel(job.billing)}
          </div>
        </div>
        <div className="vgai-tool-actions">
          <Button
            size="compact"
            variant="ghost"
            disabled={loading}
            onClick={() => void inspect(job)}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          {generationSaveRetryable(job, error) && (
            // ONE rule, shared with the gallery card: the server reconciler
            // saves a finished output on its own, so this is only ever the
            // RETRY door for a save that failed — never an approval gate, and
            // never a blocking browser dialog.
            <Button
              size="compact"
              variant="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void acceptGenerationJob(job)
                  .catch((cause) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Saving…' : 'Retry save'}
            </Button>
          )}
        </div>
      </header>

      {job.message && <div className="vgai-tool-status">{job.message}</div>}
      {alert && (
        <div className="vgai-tool-status" data-tone="error" role="alert">
          {alert}
        </div>
      )}

      <section className="vgai-generation-result" aria-label="Generation result">
        {result === undefined ? (
          <div className="vgai-generation-document-empty">
            {loading ? 'Loading provider result…' : 'No provider result is available yet.'}
          </div>
        ) : (
          <ProviderResult job={job} result={result} documentId={documentId} active={active} />
        )}
      </section>

      {job.outputPaths && job.outputPaths.length > 0 && (
        <section className="vgai-generation-output-paths">
          <strong>Project assets</strong>
          {job.outputPaths.map((path) => (
            <code key={path}>{path}</code>
          ))}
        </section>
      )}

      {generationRemovable(job) && (
        <div className="vgai-generation-document-footer">
          <Button
            size="compact"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void forgetGenerationJob(job.id)
                .then(() => closeWorkspaceDocument(documentId))
                .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
                .finally(() => setBusy(false));
            }}
          >
            Remove from activity
          </Button>
        </div>
      )}
    </div>
  );
}
