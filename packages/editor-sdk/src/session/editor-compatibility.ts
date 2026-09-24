import { GAME_MANIFEST_VERSION } from '@volter/editor-project/manifest/schema';

export interface EditorServerCompatibility {
  apiVersion: 1;
  engineVersion: string | null;
  manifestVersion: number;
  startedAt: string;
  source:
    | { state: 'current' }
    | { state: 'restart-required'; changedPath: string; changedAt: string };
}

/**
 * What a person runs to recover. `verbs` are the product command's verbs, run
 * in order — the kit names no product; the page prefixes the served product's
 * command (`@volter/editor-core/product-command`'s `commandSequence`).
 */
export type StartupRecovery =
  | {
      kind: 'retry-editor';
      title: 'Editor server unavailable';
      guidance: string;
      verbs: readonly ['edit .'];
    }
  | {
      kind: 'restart-editor';
      title: 'Restart this editor';
      guidance: string;
      verbs: readonly ['edit .'] | readonly ['close', 'edit .'];
    }
  | {
      kind: 'use-compatible-editor';
      title: 'Use a compatible editor';
      guidance: string;
    };

export class ProjectCompatibilityError extends Error {
  readonly recovery: StartupRecovery;

  constructor(message: string, recovery: StartupRecovery) {
    super(message);
    this.name = 'ProjectCompatibilityError';
    this.recovery = recovery;
  }
}

export function editorServerUnavailableError(detail?: string): ProjectCompatibilityError {
  return new ProjectCompatibilityError(
    `Could not reach the local editor server${detail ? `: ${detail}` : '.'}`,
    {
      kind: 'retry-editor',
      title: 'Editor server unavailable',
      guidance: 'Make sure the local editor is running, then retry this operation.',
      verbs: ['edit .'],
    },
  );
}

export function isStartupRecovery(value: unknown): value is StartupRecovery {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['title'] !== 'string' || typeof candidate['guidance'] !== 'string') {
    return false;
  }
  const verbs = Array.isArray(candidate['verbs']) ? (candidate['verbs'] as unknown[]).join(' | ') : null;
  switch (candidate['kind']) {
    case 'retry-editor':
      return verbs === 'edit .';
    case 'restart-editor':
      return verbs === 'edit .' || verbs === 'close | edit .';
    case 'use-compatible-editor':
      return candidate['verbs'] === undefined;
    default:
      return false;
  }
}

interface ProjectIdentity {
  manifestVersion?: unknown;
  engine?: { version?: unknown } | undefined;
  /**
   * The manifest's `roots`, RAW or resolved — read only by
   * `usesNoPinnedEngineApi` below, structurally, so either shape works. Left
   * `unknown` on purpose: this module is the pre-Zod identity check, and
   * inventing a typed root here would duplicate the loader it runs before.
   */
  roots?: unknown;
}

/**
 * Does this project mount through the engine's PINNED API at all? (S-7.)
 *
 * The engine-version pin below is an identity pin on the API a project's own
 * source compiles against. An INGEST root has no such source: the game is
 * foreign, unmodified, and reaches the host through the adapter seam, so
 * there is nothing in it that a `@volter/editor-project` version could break — and
 * nothing `vgai upgrade` could rewrite if the pin did complain. Found
 * source-mounting SimCity: the project scaffolded at an older pin, and the
 * editor refused to open it with "run vgai upgrade", an instruction that
 * could not be carried out because the project has no engine surface to
 * upgrade.
 *
 * The discriminator is the manifest itself — a root whose adapter carries an
 * `ingest` block (raw) / resolves to `type: 'ingest'` — never a new opt-out
 * flag, which would be a second thing to keep true. EVERY root must be an
 * ingest for the exemption to apply: one first-party root and the project
 * does compile against the pinned API, so the pin means exactly what it says.
 *
 * Note what this does NOT exempt: the manifest FORMAT version. The editor
 * reads `vgai.project.json` for every project, ingest or not, so a v1
 * manifest is still an upgrade this editor genuinely requires.
 */
export function usesNoPinnedEngineApi(project: ProjectIdentity): boolean {
  const roots = project.roots;
  if (!Array.isArray(roots) || roots.length === 0) return false;
  return roots.every((root) => {
    if (!root || typeof root !== 'object') return false;
    const adapter = (root as { adapter?: unknown }).adapter;
    if (!adapter || typeof adapter !== 'object') return false;
    const shape = adapter as { ingest?: unknown; type?: unknown };
    return shape.type === 'ingest' || (shape.ingest !== undefined && shape.ingest !== null);
  });
}

const EXACT_SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const aMatch = EXACT_SEMVER.exec(a);
  const bMatch = EXACT_SEMVER.exec(b);
  if (!aMatch || !bMatch) return null;
  for (let index = 1; index <= 3; index++) {
    const aPart = Number(aMatch[index]);
    const bPart = Number(bMatch[index]);
    if (aPart < bPart) return -1;
    if (aPart > bPart) return 1;
  }
  return 0;
}

export function missingCompatibilityError(): ProjectCompatibilityError {
  return new ProjectCompatibilityError(
    'The editor page is newer than its local server. The running server does not expose the compatibility handshake this page expects.',
    {
      kind: 'restart-editor',
      title: 'Restart this editor',
      guidance: 'From the project folder, restart the local editor and then reopen this page.',
      verbs: ['close', 'edit .'],
    },
  );
}

/** Verify that the browser bundle and its long-running local server still agree. */
export function assertEditorCompatibility(identity: EditorServerCompatibility): void {
  if (identity.source.state === 'restart-required') {
    throw new ProjectCompatibilityError(
      `The local editor server is stale. ${identity.source.changedPath} changed after this server started at ${identity.startedAt}.`,
      {
        kind: 'restart-editor',
        title: 'Restart this editor',
        guidance:
          'The browser has newer source than the running Node process. Run the editor command again from the project folder; it will replace the stale server on the same port.',
        verbs: ['edit .'],
      },
    );
  }

  if (identity.manifestVersion !== GAME_MANIFEST_VERSION) {
    throw new ProjectCompatibilityError(
      `The editor page supports project format v${GAME_MANIFEST_VERSION}, but its local server supports v${identity.manifestVersion}.`,
      {
        kind: 'restart-editor',
        title: 'Restart this editor',
        guidance: 'The browser and server are from different editor builds. Restart them together.',
        verbs: ['close', 'edit .'],
      },
    );
  }
}

/**
 * The manifest FORMAT half of the check below. Split out so the pin half
 * stays readable next to its S-7 exemption; no behavior of its own beyond
 * what it always did.
 */
function assertManifestVersionCompatibility(project: ProjectIdentity): void {
  if (
    typeof project.manifestVersion === 'number' &&
    project.manifestVersion !== GAME_MANIFEST_VERSION
  ) {
    if (project.manifestVersion < GAME_MANIFEST_VERSION) {
      throw new ProjectCompatibilityError(
        `This project uses manifest format v${project.manifestVersion}; this editor requires v${GAME_MANIFEST_VERSION}.`,
        {
          kind: 'use-compatible-editor',
          title: 'Use a compatible editor',
          guidance:
            'Open this project with the editor version that created it. This product does not provide an automatic project-format upgrade.',
        },
      );
    }
    throw new ProjectCompatibilityError(
      `This project uses manifest format v${project.manifestVersion}, which is newer than this editor's v${GAME_MANIFEST_VERSION} format.`,
      {
        kind: 'use-compatible-editor',
        title: 'Use a compatible editor',
        guidance: 'Open this project with the newer Volter Editor checkout or installation that created it.',
      },
    );
  }
}

/** Verify the lightweight identity fields before full Zod manifest parsing. */
export function assertProjectCompatibility(
  project: ProjectIdentity,
  editor: EditorServerCompatibility,
): void {
  assertManifestVersionCompatibility(project);

  const projectEngine = project.engine?.version;
  const editorEngine = editor.engineVersion;
  if (typeof projectEngine !== 'string' || !editorEngine || projectEngine === editorEngine) return;
  // S-7: a project that mounts nothing through the pinned API is not gated by
  // it. See `usesNoPinnedEngineApi` for why, and for why it is the manifest —
  // not a flag — that decides.
  if (usesNoPinnedEngineApi(project)) return;

  const comparison = compareSemver(projectEngine, editorEngine);
  if (comparison === -1) {
    throw new ProjectCompatibilityError(
      `This project is pinned to @volter/editor-project ${projectEngine}, but this editor is running ${editorEngine}.`,
      {
        kind: 'use-compatible-editor',
        title: 'Use a compatible editor',
        guidance:
          'Open the project with the editor version matching its pinned project API. This product does not automatically rewrite project source.',
      },
    );
  }

  throw new ProjectCompatibilityError(
    `This project is pinned to @volter/editor-project ${projectEngine}, but this editor is running ${editorEngine}.`,
    {
      kind: 'use-compatible-editor',
      title: 'Use a compatible editor',
      guidance:
        comparison === 1
          ? 'This project targets a newer engine. Open it from the matching newer Volter Editor checkout or installation.'
          : 'The engine identities differ. Open the project with the exact Volter Editor version it is pinned to.',
    },
  );
}
