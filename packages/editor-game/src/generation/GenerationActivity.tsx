/**
 * Generations — the project's generated ASSETS, shown as the assets they are.
 *
 * Every card's subject is the file the job produced: the image, the video with
 * its own controls, the model's rendered thumbnail. Job vocabulary (state,
 * model, charge, prompt) frames that preview instead of replacing it, and the
 * preview is never fabricated — a file the browser cannot show honestly gets a
 * named file row, not a decorative stand-in.
 */

import { faFile, faFileLines, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { GenerationJob } from '@volter/editor-sdk/generations';
import { useState, useSyncExternalStore } from 'react';
import './GenerationGallery.css';
import { assetCapabilities, assetDocumentKind } from '@volter/editor-sdk/kit/asset-capabilities';
import { openAssetDocument } from '@volter/editor-sdk/kit/components/asset-documents';
import { AudioAssetThumb, ModelThumbnail } from '@volter/editor-sdk/kit/components/asset-thumbnails';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { modelThumbnailFormat } from '@volter/editor-threejs/kit/model-thumbnail';
import {
  Button,
  EditorBadge,
  EditorBanner,
  EditorIcon,
  EditorToolbar,
  Spacer,
  StateSurface,
  type StateSurfaceTone,
  Text,
} from '@volter/editor-sdk/widgets';
import { openGenerationCreateDocument, openGenerationDocument } from './generation-documents';
import {
  acceptGenerationJob,
  forgetGenerationJob,
  generationJobIsActive,
  generationJobIsUnread,
  generationJobsError,
  generationJobsSnapshot,
  markGenerationJobRead,
  pollActiveGenerationJobs,
  refreshGenerationJobs,
  subscribeGenerationJobs,
} from './generation-jobs';
import {
  GENERATION_STATE_LABEL,
  type GenerationCardState,
  type GenerationOutput,
  generationAge,
  generationBillingLabel,
  generationBillingSettled,
  generationCardState,
  generationModelLabel,
  generationOutputs,
  generationPrompt,
  generationRemovable,
  generationRouteLabel,
  generationSaveRetryable,
  generationTitle,
} from './generation-presentation';

/** One produced file, painted the way that file can honestly be shown. */
function OutputPreview({
  output,
  onOpen,
}: {
  output: GenerationOutput;
  onOpen?: (() => void) | undefined;
}) {
  const src = output.url;

  if (src && output.kind === 'image') {
    const preview = (
      <img className="vgai-generation-output-media" src={src} alt={output.name} loading="lazy" />
    );
    return onOpen ? (
      // The preview itself opens the asset — the gesture a gallery implies.
      <Button
        variant="ghost"
        className="vgai-generation-output-open"
        onClick={onOpen}
        aria-label={`Open ${output.name}`}
      >
        {preview}
      </Button>
    ) : (
      preview
    );
  }
  if (src && output.kind === 'video') {
    return (
      // Deliberately no autoplay and no `muted` autoplay trick: a gallery that
      // starts sound is the failure this panel is replacing.
      <video
        className="vgai-generation-output-media"
        src={src}
        controls
        preload="metadata"
        playsInline
        title={output.name}
      />
    );
  }
  if (src && output.kind === 'audio') {
    return (
      <div className="vgai-generation-output-audio">
        <AudioAssetThumb url={src} name={output.name} />
        <audio src={src} controls preload="metadata" title={output.name} />
      </div>
    );
  }
  if (output.url && output.kind === 'model' && modelThumbnailFormat(output.url)) {
    return <ModelThumbnail url={output.url} />;
  }
  return (
    <div className="vgai-generation-output-file">
      <EditorIcon icon={output.kind === 'model' ? faFile : faFileLines} />
      <Text variant="caption" tone="muted">
        {output.name}
      </Text>
      {onOpen && (
        <Button size="compact" variant="ghost" onClick={onOpen}>
          Open file
        </Button>
      )}
    </div>
  );
}

const STATE_TONE: Record<GenerationCardState, StateSurfaceTone> = {
  queued: 'loading',
  running: 'loading',
  saving: 'loading',
  'save-failed': 'error',
  ready: 'success',
  'no-asset': 'neutral',
  failed: 'error',
  cancelled: 'neutral',
};

/** What each state means, in a game developer's terms. */
const STATE_DESCRIPTION: Record<GenerationCardState, (job: GenerationJob) => string> = {
  queued: (job) =>
    job.queuePosition === undefined
      ? 'Waiting for the provider to start.'
      : `Position ${job.queuePosition} in the provider queue.`,
  running: (job) => job.message ?? 'The provider is working on it.',
  saving: () => 'Downloading the finished output into this project.',
  // The provider's own result is fine; the DOWNLOAD into the project is what
  // failed, and the server has stopped trying. Nothing here promises another
  // automatic attempt — the retry is the button.
  'save-failed': (job) => job.pollError ?? 'The finished output could not be saved.',
  ready: () => 'Saved into this project.',
  'no-asset': () => 'The operation finished without a file this project can hold.',
  failed: (job) => job.message ?? 'The provider reported a failure.',
  cancelled: () => 'This generation was cancelled.',
};

/** The media region while a job has produced nothing to show yet. */
function StateMedia({ job, state }: { job: GenerationJob; state: GenerationCardState }) {
  const pending = state === 'queued' || state === 'running' || state === 'saving';
  const failing = state === 'failed' || state === 'save-failed';
  return (
    <div className="vgai-generation-state-media" data-state={state}>
      <StateSurface
        compact
        tone={STATE_TONE[state]}
        {...(failing ? { icon: <EditorIcon icon={faTriangleExclamation} /> } : {})}
        title={GENERATION_STATE_LABEL[state]}
        description={STATE_DESCRIPTION[state](job)}
      />
      {pending && (
        // Determinate ONLY when the provider reported progress; otherwise the
        // native indeterminate bar, which claims nothing.
        <progress
          className="vgai-generation-progress"
          aria-label={`${job.label} progress`}
          {...(state === 'running' && job.progress !== undefined
            ? { value: job.progress, max: 1 }
            : {})}
        />
      )}
    </div>
  );
}

function CardActions({
  job,
  busy,
  error,
  run,
}: {
  job: GenerationJob;
  busy: boolean;
  error: string | null;
  run: (action: () => Promise<void>) => void;
}) {
  return (
    <div className="vgai-generation-card-actions">
      {generationSaveRetryable(job, error) && (
        // There is NO add-to-project gate: the server accepts a finished
        // output on its own. This appears only once a save has actually
        // failed, and runs that same accept operation again by hand.
        <Button
          size="compact"
          variant="primary"
          disabled={busy}
          onClick={() => run(() => acceptGenerationJob(job))}
        >
          {busy ? 'Saving…' : 'Retry save'}
        </Button>
      )}
      <Button size="compact" variant="ghost" onClick={() => openGenerationDocument(job)}>
        Details
      </Button>
      {generationRemovable(job) && (
        <Button
          size="compact"
          variant="ghost"
          disabled={busy}
          onClick={() => run(() => forgetGenerationJob(job.id))}
        >
          Remove
        </Button>
      )}
    </div>
  );
}

function GenerationCard({
  job,
  busy,
  error,
  run,
}: {
  job: GenerationJob;
  busy: boolean;
  error: string | null;
  run: (action: () => Promise<void>) => void;
}) {
  const state = generationCardState(job);
  const outputs = generationOutputs(job);
  const prompt = generationPrompt(job);
  const unread = generationJobIsUnread(job);
  const openOutput = (output: GenerationOutput): (() => void) | undefined => {
    if (!output.url) return undefined;
    const kind = assetDocumentKind(assetCapabilities(output.name));
    if (!kind) return undefined;
    return () => openAssetDocument(output.url as string, kind);
  };

  return (
    <article
      className="vgai-generation-card"
      data-state={state}
      aria-busy={generationJobIsActive(job)}
      aria-label={generationTitle(job)}
      onClickCapture={() => {
        if (unread) {
          void markGenerationJobRead(job.id).catch((cause) => {
            editorConsole.warn(
              `Could not mark generation as seen: ${cause instanceof Error ? cause.message : String(cause)}`,
              'generations',
            );
          });
        }
      }}
    >
      <div className="vgai-generation-card-media" data-outputs={Math.min(outputs.length, 4)}>
        {outputs.length === 0 ? (
          <StateMedia job={job} state={state} />
        ) : (
          outputs.map((output) => (
            <div className="vgai-generation-output" key={output.path} title={output.path}>
              <OutputPreview output={output} onOpen={openOutput(output)} />
            </div>
          ))
        )}
      </div>

      <div className="vgai-generation-card-body">
        <div className="vgai-generation-card-heading">
          <Text variant="label" truncate title={generationTitle(job)}>
            {generationTitle(job)}
          </Text>
          <EditorBadge className="vgai-generation-chip" data-state={state}>
            {GENERATION_STATE_LABEL[state]}
            {state === 'running' && job.progress !== undefined
              ? ` · ${Math.round(job.progress * 100)}%`
              : ''}
          </EditorBadge>
          {unread && (
            <EditorBadge className="vgai-generation-chip" data-state="new">
              New
            </EditorBadge>
          )}
        </div>

        <Text variant="caption" tone="muted" truncate title={generationModelLabel(job)}>
          {job.provider} · {generationModelLabel(job)}
        </Text>
        <Text variant="caption" tone="dim">
          {generationBillingLabel(job.billing)}
          {generationBillingSettled(job.billing) ? '' : ' (est.)'} · {generationRouteLabel(job)} ·{' '}
          {generationAge(job.updatedAt)}
        </Text>

        {prompt && (
          <p className="vgai-generation-card-prompt" title={prompt}>
            {prompt}
          </p>
        )}

        {(error ?? job.pollError) && (
          // An ACTIVE job's poll error is transient — the server is still
          // polling, and saying so is true. A finished job's error is a failed
          // SAVE, whose automatic attempts the server has already spent, so the
          // text promises nothing and the retry button carries it instead.
          <EditorBanner
            tone={error || state === 'save-failed' ? 'error' : 'warning'}
            className="vgai-generation-card-alert"
          >
            {error ??
              (state === 'save-failed'
                ? `Could not save into the project: ${job.pollError}`
                : `Polling will retry: ${job.pollError}`)}
          </EditorBanner>
        )}

        <CardActions job={job} busy={busy} error={error} run={run} />
      </div>
    </article>
  );
}

export function GenerationActivity() {
  const { jobs } = useSyncExternalStore(
    subscribeGenerationJobs,
    generationJobsSnapshot,
    generationJobsSnapshot,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const activeCount = jobs.filter(generationJobIsActive).length;
  const savingCount = jobs.filter((job) => generationCardState(job) === 'saving').length;

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    setActionErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setActionErrors((current) => ({ ...current, [id]: message }));
    } finally {
      setBusy(null);
    }
  };

  const storeError = generationJobsError();

  return (
    <div className="vgai-generation-gallery">
      <EditorToolbar label="Generations" compact className="vgai-generation-gallery-bar">
        <Text variant="label">Generations</Text>
        <Text variant="caption" tone="muted">
          {jobs.length} {jobs.length === 1 ? 'generation' : 'generations'}
          {activeCount > 0 ? ` · ${activeCount} running` : ''}
          {savingCount > 0 ? ` · ${savingCount} saving` : ''}
        </Text>
        <Spacer />
        <Button
          size="compact"
          variant="ghost"
          onClick={() => void pollActiveGenerationJobs().then(refreshGenerationJobs)}
        >
          Refresh
        </Button>
        <Button size="compact" variant="primary" onClick={() => openGenerationCreateDocument()}>
          New asset
        </Button>
      </EditorToolbar>

      {storeError && (
        <EditorBanner tone="error" className="vgai-generation-gallery-alert">
          {storeError}
        </EditorBanner>
      )}

      {jobs.length === 0 ? (
        <StateSurface
          className="vgai-generation-gallery-empty"
          title="No generated assets yet"
          description="Preview generated images, video, audio and models here. Create an asset to get started."
          action={
            <Button size="compact" variant="primary" onClick={() => openGenerationCreateDocument()}>
              New asset
            </Button>
          }
        />
      ) : (
        <section className="vgai-generation-grid" aria-label="Generated assets">
          {jobs.map((job) => (
            <GenerationCard
              key={job.id}
              job={job}
              busy={busy === job.id}
              error={actionErrors[job.id] ?? null}
              run={(action) => void run(job.id, action)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
