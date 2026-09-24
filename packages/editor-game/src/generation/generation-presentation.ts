/**
 * What the Generations gallery SHOWS about a job — derived entirely from the
 * durable `GenerationJob` ledger, never from a second store or a provider poll.
 *
 * The gallery is asset-first: a card's subject is the file the job produced,
 * so everything here answers "which bytes, of what kind, under what name",
 * plus the small amount of text (state, model, charge) that frames them.
 */

import { ASSET_ROOTS, assetRootServingUrl } from '@editor/asset-workflow/project-asset-roots';
import type { GenerationBilling, GenerationJob } from '@vgai/sdk/generations';

/**
 * The state a card presents, which is NOT `job.status` alone.
 *
 * `succeeded` splits four ways because the server reconciler accepts a
 * finished job's outputs AUTOMATICALLY — there is no manual add-to-project
 * gate anywhere in this surface. Until `acceptedAt` lands, a succeeded job
 * that still carries an `accept` operation is mid-SAVE; if that save recorded
 * an error it is `save-failed` (the server stops after its own bounded
 * attempts, so the card must stop claiming progress and offer the retry); and
 * a succeeded job that never had an `accept` produced nothing to hold.
 *
 * `save-failed` is deliberately its own value rather than folded into
 * `failed`: both read as a failure to the eye (same tone, same border), but
 * only one of them has a save to retry, and only the other means the provider
 * itself failed.
 */
export type GenerationCardState =
  | 'queued'
  | 'running'
  | 'saving'
  | 'save-failed'
  | 'ready'
  | 'no-asset'
  | 'failed'
  | 'cancelled';

export function generationCardState(job: GenerationJob): GenerationCardState {
  switch (job.status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      if (job.acceptedAt) return 'ready';
      if (!job.accept) return 'no-asset';
      return job.pollError ? 'save-failed' : 'saving';
  }
}

/**
 * Whether forgetting the job now can lose nothing in flight — the one rule
 * both the gallery card and the detail document offer "Remove" by.
 */
export function generationRemovable(job: GenerationJob): boolean {
  const state = generationCardState(job);
  return state !== 'queued' && state !== 'running' && state !== 'saving';
}

/** Whether the job's own accept operation is still worth running by hand. */
export function generationSaveRetryable(job: GenerationJob, actionError: string | null): boolean {
  return (
    job.status === 'succeeded' &&
    Boolean(job.accept) &&
    !job.acceptedAt &&
    Boolean(job.pollError ?? actionError)
  );
}

/** Short, human state word for the card's status chip. */
export const GENERATION_STATE_LABEL: Record<GenerationCardState, string> = {
  queued: 'Queued',
  running: 'Running',
  saving: 'Saving',
  'save-failed': "Couldn't save",
  ready: 'In project',
  'no-asset': 'No file',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** How a produced file can be shown. `file` means "no honest preview exists". */
export type GenerationPreviewKind = 'image' | 'video' | 'audio' | 'model' | 'file';

const PREVIEW_KINDS: ReadonlyMap<string, GenerationPreviewKind> = new Map([
  ...(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'bmp'] as const).map(
    (extension) => [extension, 'image'] as const,
  ),
  // Provider video output is what `<video controls>` decodes natively; an
  // extension outside this set gets the file row, never a guessed player.
  ...(['mp4', 'webm', 'ogv', 'mov', 'm4v'] as const).map(
    (extension) => [extension, 'video'] as const,
  ),
  ...(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'] as const).map(
    (extension) => [extension, 'audio'] as const,
  ),
  ...(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'dae', '3ds', 'usdz', 'spz'] as const).map(
    (extension) => [extension, 'model'] as const,
  ),
]);

export interface GenerationOutput {
  /** Project-relative path exactly as the ledger recorded it. */
  readonly path: string;
  /** File name, for the card's name and the preview's alt text. */
  readonly name: string;
  readonly kind: GenerationPreviewKind;
  /**
   * Root-relative URL the dev server answers, or null for an output that does
   * does not live under either project asset root.
   */
  readonly url: string | null;
}

export function generationOutputExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

export function generationOutputs(job: GenerationJob): readonly GenerationOutput[] {
  return (job.outputPaths ?? []).map((path) => {
    const root = ASSET_ROOTS.find((root) => path.startsWith(`${root}/`));
    const url = root ? assetRootServingUrl(root, path.slice(root.length + 1)) : null;
    return {
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      kind: PREVIEW_KINDS.get(generationOutputExtension(path)) ?? 'file',
      url,
    };
  });
}

function shorten(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A concise card name.
 *
 * A job's `label` is the submitted PROMPT, already truncated by the provider
 * extension — it reads as a sentence, not a name, so once files exist the file
 * is the name. Two sibling outputs of one job are named by their folder.
 */
export function generationTitle(job: GenerationJob): string {
  const named = recordedOutputName(job);
  if (named) return named;
  const outputs = generationOutputs(job);
  if (outputs.length === 0) return shorten(job.label, 64);
  const first = outputs[0] as GenerationOutput;
  const folder = descriptiveFolder(first.path);
  if (outputs.length > 1) {
    return folder ? `${folder} · ${outputs.length} files` : `${outputs.length} files`;
  }
  // `image-1.png` names nothing on its own. A descriptive folder carries it
  // (`motion/video.mp4`); a per-request hash folder carries nothing, so the
  // prompt is a better name than an opaque id.
  if (!GENERIC_OUTPUT_NAME.test(first.name)) return first.name;
  return folder ? `${folder}/${first.name}` : shorten(job.label, 64);
}

const GENERIC_OUTPUT_NAME = /^(image|video|audio|model|panorama|output)(-\d+)?\./;

/** A hash/uuid segment names nothing to a human; a written word does. */
function descriptiveFolder(path: string): string | null {
  const folder = path.split('/').slice(-2, -1)[0];
  if (!folder) return null;
  const opaque = /^[0-9a-f]{8,}$/i.test(folder) || /^[0-9a-f-]{16,}$/i.test(folder);
  return opaque ? null : folder;
}

/**
 * The name the submitting operation asked its output to be written as, when it
 * recorded one. This is the naming the accept operation itself owns; the
 * gallery only reads it.
 */
function recordedOutputName(job: GenerationJob): string | null {
  const input = job.accept?.input;
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)['outputName'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The submitted prompt, when the job's own recorded operation input carries
 * one. Providers keep native request shapes, so this reads the recorded
 * `accept`/`poll` input a level or two deep and gives up rather than guessing —
 * a card never invents prompt text.
 */
export function generationPrompt(job: GenerationJob): string | null {
  for (const root of [job.accept?.input, job.poll.input]) {
    const found = findPrompt(root, 0);
    if (found) return found;
  }
  return null;
}

function findPrompt(value: unknown, depth: number): string | null {
  if (depth > 3 || typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const direct = record['prompt'];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
  for (const nested of Object.values(record)) {
    const found = findPrompt(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Provider-native model/endpoint identity, e.g. `fal-ai/nano-banana-2/edit`. */
export function generationModelLabel(job: GenerationJob): string {
  return job.operation;
}

export function generationRouteLabel(job: GenerationJob): string {
  if (job.mode === 'managed') return 'VGAI subscription';
  if (job.mode === 'direct') return 'Your provider key';
  return 'Mock';
}

/** The charge, settled where the provider reported one, estimate otherwise. */
export function generationBillingLabel(billing: GenerationBilling): string {
  if (billing.route === 'mock') return 'Free · mock';
  if (billing.route === 'managed') {
    if (billing.settledCredits !== undefined) return `${billing.settledCredits} credits`;
    if (billing.estimatedCredits !== undefined) return `Up to ${billing.estimatedCredits} credits`;
    return 'Credit estimate unavailable';
  }
  if (billing.settledAmount !== undefined) return `$${billing.settledAmount.toFixed(3)}`;
  if (billing.estimatedAmount !== undefined) return `Up to $${billing.estimatedAmount.toFixed(3)}`;
  return 'USD estimate unavailable';
}

/** True once the provider has settled the charge, so the figure is final. */
export function generationBillingSettled(billing: GenerationBilling): boolean {
  if (billing.route === 'mock') return true;
  if (billing.route === 'managed') return billing.settledCredits !== undefined;
  return billing.settledAmount !== undefined;
}

/** Local to the gallery: coarse age, at the resolution a card can show. */
export function generationAge(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
