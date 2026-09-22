import { z } from 'zod';
import { GenerationBillingSchema } from '@volter/editor-sdk/generations';

export const PROJECT_PROVENANCE_PATH = '.vgai/provenance.json';

export const ProjectProvenanceOutputSchema = z
  .object({
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.string().optional(),
    role: z.enum(['asset', 'prefab', 'provenance', 'other']).optional(),
  })
  .strict();

export const ProjectProvenanceExecutionSchema = z
  .object({
    mode: z.enum(['mock', 'direct', 'managed']),
    provider: z.string(),
    operation: z.string().optional(),
    model: z.string().optional(),
    requestId: z.string().optional(),
    taskId: z.string().optional(),
    managedJobId: z.string().optional(),
    billing: GenerationBillingSchema.optional(),
  })
  .strict();

/**
 * THE KIND FOR A FILE AN EDITOR SESSION WROTE INTO THE PROJECT.
 *
 * A generated binary under `public/` normally arrives from an operation that
 * ran here: a bake, a provider acceptance, a library acquisition. A file a
 * SESSION produced has no such operation — the bytes were made by a script an
 * agent ran inside the tab (`export_scene.gltf` in the Blender session's own
 * worker filesystem) and reached disk through the write-back door that mirrors
 * the session's files out. Measured 2026-09-18: those landed with no record at
 * all, which is the one state `scripts/validate-project-provenance.mjs` calls
 * fatal.
 *
 * The producing PROGRAM is the session, so what the record can honestly name is
 * the session — see {@link ProjectProvenanceSessionSchema}. That block is
 * REQUIRED on a record of this kind, and the validator enforces it, for the
 * same reason `project.provenance.unknown` must carry a written reason: a kind
 * that can be claimed without evidence becomes the cheapest way past the gate.
 *
 * `scripts/validate-project-provenance.mjs` spells this literal itself (it is a
 * plain `.mjs` gate and imports no TypeScript); changing it here means changing
 * it there.
 */
export const PROJECT_SESSION_WRITE_OPERATION = 'project.session.write';

/**
 * WHICH SESSION wrote the bytes, and what it had modelled at the time.
 *
 * Not a provider execution: no vendor ran, nothing was billed, and there is no
 * request to re-issue. What re-derives the file is the session's own state, so
 * the identity (which session, reached on which port) and the `revision` that
 * state was at are the facts worth keeping.
 */
export const ProjectProvenanceSessionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "The session's own id, as the session names itself to the tab in every " +
          'frame it presents. Distinguishes two sessions of the same project, ' +
          'including one restarted between two writes to the same path.',
      ),
    port: z
      .number()
      .int()
      .positive()
      .describe(
        'The machine-local editor port the writer reached that session on — the ' +
          "project's own reserved port, which is how a person or an agent gets " +
          'back to the tab this file came out of.',
      ),
    revision: z
      .number()
      .int()
      .nonnegative()
      .describe(
        "The session's frame revision at the moment the file was listed for " +
          'write-back: the model state that produced these bytes. It advances ' +
          'once per present, and a script presents when it finishes, so this is ' +
          'the revision the writing script left behind.',
      ),
    callId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The transport's own id for the call that ran the script, when the " +
          'transport has one (the MCP request id). Absent when the write did not ' +
          'arrive through a call the transport numbered.',
      ),
  })
  .strict();

/**
 * THE KIND FOR BYTES ALREADY ON DISK, RE-RECORDED AGAINST A LIVE DOOR.
 *
 * The ledger is an append-only log of operations that really happened, so a
 * record whose `operation.source` names a tool that has since been deleted or
 * renamed cannot be rewritten — it is what happened. What it can no longer do
 * is tell a reader which door rebuilds the file. An ATTEST record is the
 * append that answers that: nothing ran, nothing was re-baked, the bytes were
 * hashed where they lie, and `input.attests` names the operation that would
 * produce them today.
 *
 * It is the weakest claim in the vocabulary, so it pays the same price as
 * `project.provenance.unknown`: `input.reason` is REQUIRED and
 * `scripts/validate-project-provenance.mjs` enforces it, because a kind that
 * can be claimed with no evidence is the cheapest way past a gate. An attest
 * is never a substitute for running the door when the door CAN be run — it
 * exists for the case where re-running would change the bytes a project
 * already ships.
 *
 * Written by `attestExistingProjectOutputs`
 * (`packages/editor/server/project-output-writer.ts`), driven by
 * `scripts/attest-project-output.ts`. The validator spells this literal
 * itself (it is a plain `.mjs` gate and imports no TypeScript); changing it
 * here means changing it there.
 */
export const PROJECT_ATTEST_OPERATION = 'project.provenance.attest';

export const ProjectProvenanceOperationSchema = z
  .object({
    createdAt: z.string().datetime(),
    operation: z
      .object({
        name: z.string(),
        source: z.string().optional(),
      })
      .strict(),
    execution: ProjectProvenanceExecutionSchema.optional(),
    executions: z.array(ProjectProvenanceExecutionSchema).min(2).optional(),
    session: ProjectProvenanceSessionSchema.optional().describe(
      'The editor session that wrote these bytes. Required on a ' +
        '`project.session.write` record, and meaningless on any other kind.',
    ),
    input: z.json().optional(),
    inputs: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        'Project-relative paths of the project FILES these bytes were produced ' +
          'from — a session-written GLB names the `src/models/<name>.blend` it ' +
          'was exported from. This is what lets a reader go DOWN by kind: a ' +
          'prefab uses a glTF, and opening that glTF\'s model needs the export ' +
          'to name its input (ARCHITECTURE-CORE §Roots, "Drilling goes DOWN by ' +
          'kind"). Distinct from `input`, which is the operation\'s ARGUMENTS; ' +
          'these are files on disk, and `scripts/validate-project-provenance.mjs` ' +
          'reports one that no longer exists as DANGLING rather than fatal — a ' +
          'renamed source is history, not a broken ledger.',
      ),
    outputs: z.array(ProjectProvenanceOutputSchema).min(1),
  })
  .strict();

export const ProjectProvenanceDocumentSchema = z
  .object({
    version: z.literal(1),
    operations: z.record(z.string(), ProjectProvenanceOperationSchema),
  })
  .strict();

export type ProjectProvenanceDocument = z.infer<typeof ProjectProvenanceDocumentSchema>;
export type ProjectProvenanceOperation = z.infer<typeof ProjectProvenanceOperationSchema>;
export type ProjectProvenanceExecution = z.infer<typeof ProjectProvenanceExecutionSchema>;
export type ProjectProvenanceSession = z.infer<typeof ProjectProvenanceSessionSchema>;

export const ProjectAttributionEntrySchema = z
  .object({
    key: z.string(),
    name: z.string().optional(),
    source: z.string().optional(),
    sourceUrl: z.string().url().optional(),
    author: z.string(),
    license: z.string(),
    text: z.string(),
    operationIds: z.array(z.string()),
    outputPaths: z.array(z.string()),
  })
  .strict();

export const ProjectAttributionReportSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(ProjectAttributionEntrySchema),
  })
  .strict();

export type ProjectAttributionEntry = z.infer<typeof ProjectAttributionEntrySchema>;
export type ProjectAttributionReport = z.infer<typeof ProjectAttributionReportSchema>;

export function emptyProjectProvenanceDocument(): ProjectProvenanceDocument {
  return { version: 1, operations: {} };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function attributionEntry(
  operationId: string,
  operation: ProjectProvenanceOperation,
): ProjectAttributionEntry | null {
  const input = objectRecord(operation.input);
  if (!input) return null;
  const nested = objectRecord(input['attribution']) ?? {};
  const author = stringField(nested, 'author') ?? stringField(input, 'author');
  const license = stringField(nested, 'license') ?? stringField(input, 'license');
  if (!author || !license) return null;
  const name = stringField(nested, 'name') ?? stringField(input, 'name');
  const source = stringField(nested, 'source') ?? stringField(input, 'source');
  const sourceUrl = stringField(nested, 'sourceUrl') ?? stringField(input, 'sourceUrl');
  const text = stringField(nested, 'text') ?? `${name ? `${name} by ` : ''}${author} (${license})`;
  const key = JSON.stringify([sourceUrl ?? '', author, license, text]);
  return ProjectAttributionEntrySchema.parse({
    key,
    ...(name ? { name } : {}),
    ...(source ? { source } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    author,
    license,
    text,
    operationIds: [operationId],
    outputPaths: operation.outputs
      .filter((output) => output.role !== 'provenance')
      .map((output) => output.path),
  });
}

/**
 * Project credits are a projection of central provenance, never another
 * persisted ledger or a set of per-asset files.
 */
export function deriveProjectAttributionReport(
  document: ProjectProvenanceDocument,
): ProjectAttributionReport {
  const grouped = new Map<string, ProjectAttributionEntry>();
  for (const [operationId, operation] of Object.entries(document.operations)) {
    const entry = attributionEntry(operationId, operation);
    if (!entry) continue;
    const prior = grouped.get(entry.key);
    if (!prior) {
      grouped.set(entry.key, entry);
      continue;
    }
    prior.operationIds.push(...entry.operationIds);
    prior.outputPaths.push(...entry.outputPaths);
  }
  const entries = [...grouped.values()]
    .map((entry) => ({
      ...entry,
      operationIds: [...new Set(entry.operationIds)].sort(),
      outputPaths: [...new Set(entry.outputPaths)].sort(),
    }))
    .sort(
      (left, right) => left.text.localeCompare(right.text) || left.key.localeCompare(right.key),
    );
  return ProjectAttributionReportSchema.parse({ version: 1, entries });
}

/** Deterministic human-readable projection of the machine report. */
export function formatProjectAttributionMarkdown(report: ProjectAttributionReport): string {
  const sections = report.entries.map((entry) => {
    const heading = entry.name ?? entry.text;
    return [
      `## ${heading}`,
      '',
      entry.text,
      '',
      `Author: ${entry.author}  `,
      `License: ${entry.license}${entry.sourceUrl ? `  \nSource: ${entry.sourceUrl}` : ''}`,
    ].join('\n');
  });
  return `# Asset attribution\n${sections.length > 0 ? `\n${sections.join('\n\n')}` : '\nNo attributed project assets are currently present.'}\n`;
}
