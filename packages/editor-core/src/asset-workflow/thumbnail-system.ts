import { z } from 'zod';
import { projectFiles } from '../files/project-files';
import type { StorageBackend } from '../storage';
import type { AssetCatalog } from './asset-types';

/**
 * The deterministic render profile a generated thumbnail is stamped with.
 *
 * Every key here is a recipe step something in this repo actually PERFORMS. A
 * profile that describes work nobody does is a declaration with no reader — the
 * inverse of the manifest-schema rule, and the way a heuristic acquires
 * provenance it never earned.
 *
 * The representative STATE of a component is its STORY: the editor captures
 * `StoryComponentThumbnail`'s registered story, which the author wrote and can
 * change. That is a declaration, and it is why no name-matching pose heuristic
 * lives here (ARCHITECTURE-CORE §The editor protocol, "Zero inference").
 */
export const THUMBNAIL_PROFILE = {
  version: 'vgai-thumbnail-v2',
  width: 256,
  height: 256,
  background: 'neutral',
  framing: 'bounds-isometric-1.3',
  lighting: 'studio-key-fill-v1',
  colorManagement: 'srgb-aces-filmic',
} as const;

export const thumbnailManifestSchema = z
  .object({
    version: z.literal(1),
    /**
     * Which profile last REGENERATED this manifest — a record, not a gate.
     *
     * It was `z.literal(THUMBNAIL_PROFILE.version)`, which made a profile bump
     * (v2 → v3) fail every manifest already on disk. The read collapsed that
     * into `null`, the toolbar read `null` as "no manifest yet", and the next
     * framing save wrote `entries: {}` — so bumping this constant silently
     * DESTROYED every hand-authored camera framing in the project.
     *
     * A bump must migrate or preserve, and preserving is the honest answer here:
     * each entry already carries its own `profileVersion`, which is precisely
     * what tells a consumer that entry was rendered by an older profile and
     * wants regenerating. Nothing is gained by throwing the framing away too.
     * `version` below stays a literal on purpose — that is the DOCUMENT format,
     * and an unrecognized one is refused rather than overwritten.
     */
    profile: z.string().min(1),
    generatedAt: z.string(),
    entries: z.record(
      z.string(),
      z
        .object({
          state: z.enum(['generated', 'upstream', 'fallback', 'unsupported', 'failed']),
          path: z.string().optional(),
          profileVersion: z.string(),
          sourceHash: z.string().optional(),
          resultHash: z.string().optional(),
          issueCode: z.string().optional(),
          framing: z
            .object({
              position: z.tuple([z.number(), z.number(), z.number()]),
              target: z.tuple([z.number(), z.number(), z.number()]),
              fov: z.number().positive().lt(180).optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type ThumbnailManifest = z.infer<typeof thumbnailManifestSchema>;

export const THUMBNAIL_MANIFEST_PATH = '.vgai/thumbnails.json';

/**
 * The three OUTCOMES of reading `.vgai/thumbnails.json`, which used to be one
 * `null`.
 *
 * `absent` and `unreadable` are opposite instructions and collapsing them lost
 * a project's work: a rebuild-and-write is correct when the file is not there
 * and DESTRUCTIVE when it is there and merely could not be parsed. Every
 * consumer that only READS may treat both as "no thumbnails"; the one consumer
 * that WRITES must refuse on `unreadable`.
 */
export type ThumbnailManifestRead =
  | { readonly status: 'absent' }
  | { readonly status: 'ok'; readonly manifest: ThumbnailManifest }
  | { readonly status: 'unreadable'; readonly reason: string };

let manifestPromise: Promise<ThumbnailManifestRead> | null = null;

/**
 * Optional project thumbnail metadata must never block live fallback previews,
 * and must never be silently discarded either.
 *
 * `absent` covers the two ways the file genuinely is not there: `read` rejects
 * (the documented `StorageBackend.read` contract for a missing path), and an
 * HTTP-backed project answering with the Vite HTML shell instead of a 404.
 * Everything else — a truncated or hand-broken JSON document, a shape this
 * schema does not recognize — is `unreadable`, and the caller decides.
 */
export async function readProjectThumbnailManifest(
  backend: Pick<StorageBackend, 'read'>,
): Promise<ThumbnailManifestRead> {
  let text: string;
  try {
    text = await backend.read(THUMBNAIL_MANIFEST_PATH);
  } catch {
    return { status: 'absent' };
  }
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.startsWith('<')) return { status: 'absent' };
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (cause) {
    return {
      status: 'unreadable',
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
  const parsed = thumbnailManifestSchema.safeParse(json);
  return parsed.success
    ? { status: 'ok', manifest: parsed.data }
    : { status: 'unreadable', reason: parsed.error.issues.map((i) => i.message).join('; ') };
}

export function loadProjectThumbnailManifest(): Promise<ThumbnailManifestRead> {
  if (!manifestPromise) {
    manifestPromise = readProjectThumbnailManifest(projectFiles).then(async (read) => {
      // Reported ONCE per cache lifetime (the promise is memoized), and
      // through the editor console because a file the editor refuses to
      // rewrite is remaining work, not log noise.
      if (read.status === 'unreadable') {
        const { editorConsole } = await import('../editor-console');
        editorConsole.error(
          `${THUMBNAIL_MANIFEST_PATH} is present but could not be read (${read.reason}). ` +
            'Thumbnail framing will not be saved until it is fixed or deleted; previews ' +
            'fall back to live renders.',
          'asset-workflow',
        );
      }
      return read;
    });
  }
  return manifestPromise;
}
export function resetProjectThumbnailManifestCache(): void {
  manifestPromise = null;
}

interface QueueJob<T> {
  key: string;
  priority: number;
  consumers: number;
  started: boolean;
  resolve(value: T): void;
  reject(error: unknown): void;
  promise: Promise<T>;
}

/** Bounded, priority-aware, deduplicating fallback queue shared by all visible cards. */
export class ThumbnailJobQueue<T> {
  private active = 0;
  private readonly jobs = new Map<string, QueueJob<T>>();
  private pending: QueueJob<T>[] = [];
  constructor(
    private readonly execute: (key: string) => Promise<T>,
    readonly concurrency = 2,
  ) {}
  request(key: string, priority = 0): { promise: Promise<T>; cancel(): void } {
    let job = this.jobs.get(key);
    if (!job) {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      job = { key, priority, consumers: 0, started: false, resolve, reject, promise };
      this.jobs.set(key, job);
      this.pending.push(job);
    }
    job.consumers++;
    job.priority = Math.max(job.priority, priority);
    this.pending.sort((a, b) => b.priority - a.priority);
    this.pump();
    let cancelled = false;
    return {
      promise: job.promise,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        job!.consumers--;
        if (!job!.started && job!.consumers === 0) {
          this.pending = this.pending.filter((item) => item !== job);
          this.jobs.delete(job!.key);
          job!.reject(new DOMException('Thumbnail request cancelled', 'AbortError'));
        }
      },
    };
  }
  snapshot(): { active: number; pending: number; keys: number } {
    return { active: this.active, pending: this.pending.length, keys: this.jobs.size };
  }
  private pump(): void {
    while (this.active < this.concurrency) {
      const job = this.pending.shift();
      if (!job) return;
      if (job.consumers === 0) continue;
      job.started = true;
      this.active++;
      void this.execute(job.key)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.jobs.delete(job.key);
          this.pump();
        });
    }
  }
}

export interface ThumbnailQualitySample {
  alphaCoverage: number;
  luminanceVariance: number;
  edgeCoverage: number;
}
export function auditThumbnailQuality(sample: ThumbnailQualitySample): string[] {
  const issues: string[] = [];
  if (sample.alphaCoverage < 0.01) issues.push('thumbnail.blank-transparent');
  if (sample.luminanceVariance < 0.0005 && sample.edgeCoverage < 0.01)
    issues.push('thumbnail.near-uniform');
  if (sample.edgeCoverage > 0.45) issues.push('thumbnail.possibly-clipped');
  return issues;
}

export function catalogThumbnailCoverage(catalog: AssetCatalog): {
  total: number;
  generated: number;
  upstream: number;
  fallback: number;
  unsupported: number;
  failed: number;
} {
  const result = { total: 0, generated: 0, upstream: 0, fallback: 0, unsupported: 0, failed: 0 };
  for (const family of catalog.families) {
    for (const variant of family.variants) {
      result.total++;
      result[variant.thumbnail.state]++;
    }
  }
  return result;
}
