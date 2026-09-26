/**
 * Atomic persistence boundary for files produced by project tools.
 *
 * Generators remain ordinary project/package code. They hand their completed
 * bytes to this writer only when they are ready to commit; the editor host
 * validates every path, stages the whole batch, and rolls the batch back if
 * any rename fails. A half-generated output set must never become
 * visible to the asset watcher.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, posix, relative, resolve, sep } from 'node:path';
import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';
import type { GenerationJob } from '@volter/editor-sdk/generations';
import { normalizeProjectOutputPath } from '@volter/editor-sdk/project/output-roots';
import {
  emptyProjectProvenanceDocument,
  PROJECT_ATTEST_OPERATION,
  PROJECT_PROVENANCE_PATH,
  ProjectProvenanceDocumentSchema,
  type ProjectProvenanceExecution,
  ProjectProvenanceOperationSchema,
} from './support/project/provenance';
import type {
  ProjectGeneratedOutput,
  ProjectGeneratedOutputFile,
  ProjectOutputFile,
  ProjectOutputProvenanceContext,
  ProjectOutputWriter,
} from '@volter/editor-sdk/tools/types';
import { withExclusiveLock } from '@volter/editor-sdk/kit/asset-workflow/ledger-write-lock';
import { ledgerLockIo } from './asset-ledger-store';
import { readGenerationJobs } from './generation-jobs';
import { consumeGenerativeExecutions } from './generative-execution-context';
import { sanitizeRecordedValue } from './redact-secrets';

type NormalizedOutputFile = ProjectOutputFile & { path: string };

interface HashedProjectFile extends ProjectGeneratedOutputFile {
  sha256: string;
}

const projectCommitQueues = new Map<string, Promise<unknown>>();

function withCapturedExecutions(
  provenanceContext: ProjectOutputProvenanceContext,
): ProjectOutputProvenanceContext {
  const captured = consumeGenerativeExecutions();
  const explicit = provenanceContext.executions
    ? [...provenanceContext.executions]
    : provenanceContext.execution
      ? [provenanceContext.execution]
      : [];
  if (
    captured.length > 0 &&
    explicit.length > 0 &&
    JSON.stringify(captured) !== JSON.stringify(explicit)
  ) {
    throw new Error('Explicit and automatically captured provider execution facts disagree.');
  }
  const executions = captured.length > 0 ? captured : explicit;
  const effective = { ...provenanceContext };
  delete effective.execution;
  delete effective.executions;
  if (executions.length === 1) effective.execution = executions[0]!;
  if (executions.length > 1) effective.executions = executions;
  return effective;
}

async function withGenerationBilling(
  projectRoot: string,
  provenanceContext: ProjectOutputProvenanceContext,
): Promise<ProjectOutputProvenanceContext> {
  const executions = provenanceContext.executions
    ? [...provenanceContext.executions]
    : provenanceContext.execution
      ? [provenanceContext.execution]
      : [];
  if (executions.length === 0) return provenanceContext;
  let jobs: GenerationJob[];
  try {
    jobs = (await readGenerationJobs(projectRoot)).jobs;
  } catch {
    // A direct callable may never have registered a job, and a damaged
    // operational ledger must not strand otherwise valid accepted bytes.
    return provenanceContext;
  }
  const enriched = executions.map((execution) => {
    const externalId = execution.requestId ?? execution.taskId;
    if (!externalId) return execution;
    const job = jobs.find(
      (candidate) =>
        candidate.provider === execution.provider && candidate.externalId === externalId,
    );
    return job ? { ...execution, billing: job.billing } : execution;
  });
  const effective = { ...provenanceContext };
  delete effective.execution;
  delete effective.executions;
  if (enriched.length === 1) effective.execution = enriched[0]!;
  if (enriched.length > 1) effective.executions = enriched;
  return effective;
}

/**
 * Project-relative, contained, and under one of the writable output roots —
 * `public/` (shipped game assets) or `references/` (reference material the
 * editor's Content panel indexes but no export copies). The root rule itself
 * lives in `@vgai/sdk/output-roots` because provider boundaries enforce the
 * same one; `isContainedRelativePath` stays here as the host's own escape
 * check, which knows about absolute Windows paths and NUL bytes.
 */
function normalizeOutputPath(path: string): string {
  const slashPath = path.split(sep).join('/');
  const normalized = posix.normalize(slashPath).replace(/^\.\//, '');
  if (!isContainedRelativePath(normalized)) {
    throw new Error(
      `Generated output path ${JSON.stringify(path)} is invalid; outputs must be project-relative files.`,
    );
  }
  return normalizeProjectOutputPath(normalized);
}

function byteLength(content: string | Uint8Array): number {
  return typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function existingFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Generated output target is not a file: ${path}`);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function validateBatch(files: readonly ProjectOutputFile[]): {
  normalized: NormalizedOutputFile[];
  summaries: ProjectGeneratedOutputFile[];
  totalBytes: number;
} {
  if (files.length === 0) throw new Error('Generated output batch must contain at least one file.');
  const normalized = files.map((file) => ({ ...file, path: normalizeOutputPath(file.path) }));
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of normalized) {
    if (paths.has(file.path)) {
      throw new Error(
        `Generated output batch contains duplicate path ${JSON.stringify(file.path)}.`,
      );
    }
    paths.add(file.path);
    totalBytes += byteLength(file.content);
  }
  return {
    normalized,
    totalBytes,
    summaries: normalized.map((file) => ({
      path: file.path,
      bytes: byteLength(file.content),
      ...(file.mediaType ? { mediaType: file.mediaType } : {}),
      ...(file.role ? { role: file.role } : {}),
    })),
  };
}

async function stageBatch(stagedRoot: string, files: readonly NormalizedOutputFile[]) {
  for (const file of files) {
    const staged = resolve(stagedRoot, file.path);
    await mkdir(dirname(staged), { recursive: true });
    await writeFile(staged, file.content);
  }
}

async function commitBatch(
  projectRoot: string,
  stagedRoot: string,
  backupRoot: string,
  files: readonly NormalizedOutputFile[],
): Promise<void> {
  const committed: Array<{ target: string; backup: string | null }> = [];
  try {
    for (const file of files) {
      const staged = resolve(stagedRoot, file.path);
      const target = resolve(projectRoot, file.path);
      const backup = resolve(backupRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      let prior: string | null = null;
      if (await existingFile(target)) {
        await mkdir(dirname(backup), { recursive: true });
        await rename(target, backup);
        prior = backup;
      }
      try {
        await rename(staged, target);
      } catch (error) {
        if (prior) await rename(prior, target);
        throw error;
      }
      committed.push({ target, backup: prior });
    }
  } catch (error) {
    for (const entry of committed.reverse()) {
      await rm(entry.target, { force: true });
      if (entry.backup) await rename(entry.backup, entry.target);
    }
    throw error;
  }
}

async function readProvenance(projectRoot: string) {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(resolve(projectRoot, PROJECT_PROVENANCE_PATH), 'utf8'),
    );
    return ProjectProvenanceDocumentSchema.parse(parsed);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    return emptyProjectProvenanceDocument();
  }
}

function jsonSafeInput(input: unknown): unknown {
  if (input === undefined) return undefined;
  return sanitizeRecordedValue(input, new WeakSet());
}

function provenanceOperation(
  provenanceContext: ProjectOutputProvenanceContext,
  outputs: readonly HashedProjectFile[],
) {
  return ProjectProvenanceOperationSchema.parse({
    createdAt: new Date().toISOString(),
    operation: {
      name: provenanceContext.operationName,
      ...(provenanceContext.operationSource ? { source: provenanceContext.operationSource } : {}),
    },
    ...(provenanceContext.execution ? { execution: provenanceContext.execution } : {}),
    ...(provenanceContext.executions ? { executions: provenanceContext.executions } : {}),
    ...(provenanceContext.session ? { session: provenanceContext.session } : {}),
    ...(provenanceContext.input === undefined
      ? {}
      : { input: jsonSafeInput(provenanceContext.input) }),
    ...(provenanceContext.inputs && provenanceContext.inputs.length > 0
      ? { inputs: [...provenanceContext.inputs] }
      : {}),
    outputs,
  });
}

async function nextProvenanceFile(
  projectRoot: string,
  provenanceOperationId: string,
  provenanceContext: ProjectOutputProvenanceContext,
  outputs: readonly HashedProjectFile[],
): Promise<NormalizedOutputFile> {
  const provenance = await readProvenance(projectRoot);
  const nextProvenance = ProjectProvenanceDocumentSchema.parse({
    ...provenance,
    operations: {
      ...provenance.operations,
      [provenanceOperationId]: provenanceOperation(provenanceContext, outputs),
    },
  });
  return {
    path: PROJECT_PROVENANCE_PATH,
    content: `${JSON.stringify(nextProvenance, null, 2)}\n`,
    mediaType: 'application/json',
    role: 'provenance',
  };
}

/**
 * Both halves of "a read-modify-write of `.vgai/provenance.json` never loses a
 * record", exactly as `asset-ledger-store.ts` holds them for `.vgai/assets.json`
 * — the queue below is the in-process half, and it CANNOT see another process.
 *
 * The other process is ordinary now, not exotic: `vgai blender-mcp` mirrors a
 * session's `public/` outputs in through this same writer while the editor
 * server it is talking to may be committing a bake for the same project. Both
 * read the whole document, add one operation, and write it back; interleaved,
 * the later write wins and the earlier record is gone with no error anywhere.
 */
async function serializeProjectCommit<T>(projectRoot: string, work: () => Promise<T>): Promise<T> {
  const guarded = async () => {
    const lockFile = `${resolve(projectRoot, PROJECT_PROVENANCE_PATH)}.lock`;
    await mkdir(dirname(lockFile), { recursive: true });
    return withExclusiveLock(ledgerLockIo(lockFile), work, { owner: `pid ${process.pid}` });
  };
  const previous = projectCommitQueues.get(projectRoot) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(guarded);
  projectCommitQueues.set(projectRoot, current);
  try {
    return await current;
  } finally {
    if (projectCommitQueues.get(projectRoot) === current) projectCommitQueues.delete(projectRoot);
  }
}

export function createProjectOutputWriter(
  projectRoot: string,
  provenanceContext: ProjectOutputProvenanceContext = {
    operationName: 'project.output.write',
  },
): ProjectOutputWriter {
  return {
    async write(files, options = {}): Promise<ProjectGeneratedOutput> {
      const { normalized, summaries, totalBytes } = validateBatch(files);
      if (options.dryRun === true) {
        return { files: summaries, totalBytes, dryRun: true };
      }

      // Capture request-scoped execution facts synchronously, then enqueue
      // before doing any filesystem-backed billing lookup. Otherwise two
      // writes invoked in order can reach the commit queue in the opposite
      // order when the first lookup yields longer than the second.
      const capturedProvenanceContext = withCapturedExecutions(provenanceContext);

      return serializeProjectCommit(projectRoot, async () => {
        const effectiveProvenanceContext = await withGenerationBilling(
          projectRoot,
          capturedProvenanceContext,
        );
        const provenanceOperationId = randomUUID();
        const hashedFiles: HashedProjectFile[] = normalized.map((file) => ({
          path: file.path,
          bytes: byteLength(file.content),
          sha256: sha256(file.content),
          ...(file.mediaType ? { mediaType: file.mediaType } : {}),
          ...(file.role ? { role: file.role } : {}),
        }));
        const provenanceFile = await nextProvenanceFile(
          projectRoot,
          provenanceOperationId,
          effectiveProvenanceContext,
          hashedFiles,
        );
        const committedFiles = [...normalized, provenanceFile];
        const transactionRoot = resolve(
          projectRoot,
          '.vgai',
          'tmp',
          `project-output-${provenanceOperationId}`,
        );
        const stagedRoot = resolve(transactionRoot, 'staged');
        const backupRoot = resolve(transactionRoot, 'backup');
        try {
          await stageBatch(stagedRoot, committedFiles);
          await commitBatch(projectRoot, stagedRoot, backupRoot, committedFiles);
        } finally {
          await rm(transactionRoot, { recursive: true, force: true });
        }

        return {
          files: summaries,
          totalBytes,
          dryRun: false,
          provenanceOperationId,
        };
      });
    },
  };
}

/** Idempotently repairs the permanent billing snapshot after an accept tool
 * returns its final settlement. Acceptance writes bytes before its provider
 * mapper can update the operational job, so this second phase is also run by
 * startup reconciliation to close the crash window between those commits. */
export async function reconcileAcceptedGenerationProvenance(
  projectRoot: string,
  job: GenerationJob,
): Promise<boolean> {
  if (!job.acceptedAt || !job.provenanceOperationId) return false;
  const provenanceOperationId = job.provenanceOperationId;
  return serializeProjectCommit(projectRoot, async () => {
    const provenance = await readProvenance(projectRoot);
    const operation = provenance.operations[provenanceOperationId];
    if (!operation) return false;
    const matches = (execution: ProjectProvenanceExecution) =>
      execution.provider === job.provider &&
      (execution.requestId === job.externalId || execution.taskId === job.externalId);
    let changed = false;
    let nextOperation = operation;
    if (operation.execution && matches(operation.execution)) {
      changed = JSON.stringify(operation.execution.billing) !== JSON.stringify(job.billing);
      nextOperation = { ...operation, execution: { ...operation.execution, billing: job.billing } };
    } else if (operation.executions) {
      const executions = operation.executions.map((execution) => {
        if (!matches(execution)) return execution;
        if (JSON.stringify(execution.billing) !== JSON.stringify(job.billing)) changed = true;
        return { ...execution, billing: job.billing };
      });
      nextOperation = { ...operation, executions };
    }
    if (!changed) return false;
    const next = ProjectProvenanceDocumentSchema.parse({
      ...provenance,
      operations: { ...provenance.operations, [provenanceOperationId]: nextOperation },
    });
    const path = resolve(projectRoot, PROJECT_PROVENANCE_PATH);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
    try {
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return true;
  });
}

/** The `mediaType` an output's extension implies. Exported because every
 *  writer that commits bytes it did not choose the type of needs the same
 *  table — the CLI's Blender write-back door among them — and two tables
 *  drift. */
export function projectOutputMediaType(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case '.glb':
      return 'model/gltf-binary';
    case '.gltf':
      return 'model/gltf+json';
    case '.png':
      return 'image/png';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.json':
      return 'application/json';
    case '.hdr':
      return 'image/vnd.radiance';
    default:
      return undefined;
  }
}

function stagedRole(path: string): ProjectOutputFile['role'] {
  if (path.endsWith('/.vgai-thumbnail.webp')) return 'other';
  return 'asset';
}

async function describeStagedDirectory(
  stagedDirectory: string,
  destinationProjectPath: string,
): Promise<HashedProjectFile[]> {
  const outputs: HashedProjectFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `Staged project output contains an unsupported filesystem entry: ${absolute}`,
        );
      }
      const relativeFile = relative(stagedDirectory, absolute).split(sep).join('/');
      const path = posix.join(destinationProjectPath, relativeFile);
      const info = await stat(absolute);
      const mediaType = projectOutputMediaType(path);
      outputs.push({
        path,
        bytes: info.size,
        sha256: await sha256File(absolute),
        ...(mediaType ? { mediaType } : {}),
        role: stagedRole(path),
      });
    }
  }
  await walk(stagedDirectory);
  outputs.sort((left, right) => left.path.localeCompare(right.path));
  if (outputs.length === 0) throw new Error('Staged project output directory is empty.');
  return outputs;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * RE-RECORD BYTES THAT ARE ALREADY ON DISK, against the door that builds them
 * today — without touching a single one of them.
 *
 * Every other path here WRITES: it stages bytes a generator just produced and
 * commits them with the record of the operation that produced them. This one
 * writes nothing but the ledger. It hashes the files where they lie and
 * appends ONE `project.provenance.attest` operation naming them.
 *
 * WHEN IT IS THE RIGHT ANSWER, and it is a narrow case: a project ships a
 * binary whose ledger record names a tool that no longer exists (renamed,
 * folded into another capability, deleted), so nothing tells a reader which
 * door rebuilds it — and re-running the live door WOULD change the bytes the
 * project ships. Re-baking is the better answer whenever the bytes may move;
 * an attest is for when they may not. It never edits or removes the old
 * record: that record is what happened.
 *
 * The claim it makes is deliberately weak, and `input.reason` is REQUIRED by
 * `scripts/validate-project-provenance.mjs` to keep it honest — see
 * {@link PROJECT_ATTEST_OPERATION}. `attests` names the live operation.
 *
 * Driven by `scripts/attest-project-output.ts`.
 */
export async function attestExistingProjectOutputs(options: {
  projectRoot: string;
  /** Project-relative paths that must ALREADY exist. Nothing is written to them. */
  paths: readonly string[];
  /** Why the door was not simply re-run. Recorded verbatim as `input.reason`. */
  reason: string;
  /** The operation that produces these bytes today, and where it lives. */
  attests: { operation: string; source?: string; input?: unknown };
}): Promise<{ provenanceOperationId: string; files: ProjectGeneratedOutputFile[] }> {
  if (options.paths.length === 0) throw new Error('attest: no output paths given.');
  if (options.reason.trim().length === 0) {
    throw new Error(
      'attest: `reason` is required and must be non-empty — an attest is the weakest ' +
        'claim in the ledger and says in writing why the door was not re-run.',
    );
  }
  const outputs: HashedProjectFile[] = [];
  for (const raw of options.paths) {
    const path = normalizeOutputPath(raw);
    const absolute = resolve(options.projectRoot, path);
    if (!(await existingFile(absolute))) {
      throw new Error(
        `attest: ${path} does not exist. An attest records bytes already on disk; ` +
          'it never creates them.',
      );
    }
    const info = await stat(absolute);
    const mediaType = projectOutputMediaType(path);
    outputs.push({
      path,
      bytes: info.size,
      sha256: await sha256File(absolute),
      ...(mediaType ? { mediaType } : {}),
      role: 'asset',
    });
  }
  outputs.sort((left, right) => left.path.localeCompare(right.path));

  return serializeProjectCommit(options.projectRoot, async () => {
    const provenanceOperationId = randomUUID();
    const provenanceFile = await nextProvenanceFile(
      options.projectRoot,
      provenanceOperationId,
      {
        operationName: PROJECT_ATTEST_OPERATION,
        input: {
          reason: options.reason,
          attests: {
            operation: options.attests.operation,
            ...(options.attests.source ? { source: options.attests.source } : {}),
            ...(options.attests.input === undefined ? {} : { input: options.attests.input }),
          },
        },
      },
      outputs,
    );
    const transactionRoot = resolve(
      options.projectRoot,
      '.vgai',
      'tmp',
      `project-attest-${provenanceOperationId}`,
    );
    try {
      await stageBatch(resolve(transactionRoot, 'staged'), [provenanceFile]);
      await commitBatch(
        options.projectRoot,
        resolve(transactionRoot, 'staged'),
        resolve(transactionRoot, 'backup'),
        [provenanceFile],
      );
    } finally {
      await rm(transactionRoot, { recursive: true, force: true });
    }
    return {
      provenanceOperationId,
      files: outputs.map(({ sha256: _sha256, ...file }) => file),
    };
  });
}

/**
 * Commits an already-streamed directory and the central provenance rewrite as
 * one rollback-safe project transaction. Catalog acquisition uses this path so
 * large assets never need to be buffered into ProjectOutputFile.content.
 */
export async function commitStagedProjectDirectory(options: {
  projectRoot: string;
  stagedDirectory: string;
  destination: string;
  provenance: ProjectOutputProvenanceContext;
}): Promise<ProjectGeneratedOutput> {
  const destinationProjectPath = normalizeOutputPath(
    relative(options.projectRoot, options.destination).split(sep).join('/'),
  );
  const outputs = await describeStagedDirectory(options.stagedDirectory, destinationProjectPath);
  const summaries: ProjectGeneratedOutputFile[] = outputs.map(
    ({ sha256: _sha256, ...file }) => file,
  );
  const totalBytes = summaries.reduce((total, file) => total + file.bytes, 0);

  return serializeProjectCommit(options.projectRoot, async () => {
    if (await pathExists(options.destination)) {
      throw new Error(`Destination already exists and was not overwritten: ${options.destination}`);
    }
    const provenanceOperationId = randomUUID();
    const provenanceFile = await nextProvenanceFile(
      options.projectRoot,
      provenanceOperationId,
      options.provenance,
      outputs,
    );
    const transactionRoot = resolve(
      options.projectRoot,
      '.vgai',
      'tmp',
      `project-directory-${provenanceOperationId}`,
    );
    const stagedRoot = resolve(transactionRoot, 'staged');
    const backupRoot = resolve(transactionRoot, 'backup');
    let directoryCommitted = false;
    try {
      await stageBatch(stagedRoot, [provenanceFile]);
      await mkdir(dirname(options.destination), { recursive: true });
      await rename(options.stagedDirectory, options.destination);
      directoryCommitted = true;
      await commitBatch(options.projectRoot, stagedRoot, backupRoot, [provenanceFile]);
    } catch (error) {
      if (directoryCommitted) {
        try {
          await rename(options.destination, options.stagedDirectory);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Project directory transaction and its rollback both failed.',
          );
        }
      }
      throw error;
    } finally {
      await rm(transactionRoot, { recursive: true, force: true });
    }
    return {
      files: summaries,
      totalBytes,
      dryRun: false,
      provenanceOperationId,
    };
  });
}
