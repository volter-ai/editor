const PROVENANCE_PATH = '.vgai/provenance.json';

export interface ProjectOutputProvenance {
  readonly operationId: string;
  readonly createdAt: string;
  readonly operationName: string;
  readonly operationSource?: string;
  readonly input?: unknown;
  readonly output: {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly mediaType?: string;
    readonly role?: string;
  };
}

/** The project-root-relative FILE behind a served asset path — the served path
 *  with `public/` put back, which is where a writer's bytes have to land. */
export function projectOutputPath(assetPath: string): string {
  const clean = assetPath.split(/[?#]/, 1)[0]!.replace(/^\/+/, '');
  return clean.startsWith('public/') ? clean : `public/${clean}`;
}

async function readProjectProvenance(): Promise<unknown> {
  // NOT read through `editor-server-response.ts`: this route's GET half serves
  // raw file bytes as `text/plain` (routes/project-source.ts), and that reader
  // asserts `application/json` — it would reject the success case.
  const response = await fetch(
    `/__editor/vgai-file?${new URLSearchParams({ path: PROVENANCE_PATH })}`,
  );
  if (!response.ok) return null;
  return JSON.parse(await response.text());
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsedOutput(
  value: unknown,
  expectedPath: string,
): ProjectOutputProvenance['output'] | null {
  const output = record(value);
  if (
    output?.['path'] !== expectedPath ||
    typeof output['bytes'] !== 'number' ||
    typeof output['sha256'] !== 'string'
  )
    return null;
  const mediaType = output['mediaType'];
  const role = output['role'];
  return {
    path: expectedPath,
    bytes: output['bytes'],
    sha256: output['sha256'],
    ...(typeof mediaType === 'string' ? { mediaType } : {}),
    ...(typeof role === 'string' ? { role } : {}),
  };
}

function operationMatches(
  operationId: string,
  value: unknown,
  expectedPath: string,
): ProjectOutputProvenance[] {
  const operation = record(value);
  const identity = record(operation?.['operation']);
  const outputs = operation?.['outputs'];
  const createdAt = operation?.['createdAt'];
  const operationName = identity?.['name'];
  if (
    !operation ||
    !identity ||
    typeof createdAt !== 'string' ||
    typeof operationName !== 'string' ||
    !Array.isArray(outputs)
  )
    return [];
  const operationSource = identity['source'];
  return outputs.flatMap((value) => {
    const output = parsedOutput(value, expectedPath);
    if (!output) return [];
    return [
      {
        operationId,
        createdAt,
        operationName,
        ...(typeof operationSource === 'string' ? { operationSource } : {}),
        ...(operation['input'] !== undefined ? { input: operation['input'] } : {}),
        output,
      },
    ];
  });
}

/** Resolve the newest central provenance operation that produced this asset path. */
export async function provenanceForProjectAsset(
  assetPath: string,
): Promise<ProjectOutputProvenance | null> {
  const document = record(await readProjectProvenance());
  const operations = record(document?.['operations']);
  if (!operations) return null;
  const expectedPath = projectOutputPath(assetPath);
  const matches = Object.entries(operations).flatMap(([operationId, operation]) =>
    operationMatches(operationId, operation, expectedPath),
  );
  return matches.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export function __projectOutputPathForTest(assetPath: string): string {
  return projectOutputPath(assetPath);
}
