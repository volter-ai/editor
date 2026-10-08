import { GAME_MANIFEST_VERSION } from '@volter/project/manifest/schema';
import { commandLine, productNames } from '@volter/sdk/kit/product-command';

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
      /** The reason in a few words, for the tab title (`pinned to X, editor is Y`). */
      summary?: string;
    }
  | {
      /**
       * The engine pin and the editor disagree, and the served product has an
       * `upgrade [version]` verb (`@volter/sdk/session/project-upgrade`)
       * that moves the project's @volter packages and its `engine.version`
       * together.
       */
      kind: 'upgrade-project';
      title: 'Upgrade this project';
      guidance: string;
      verbs: readonly [`upgrade ${string}`];
      /** As on `use-compatible-editor`. */
      summary?: string;
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
    case 'upgrade-project':
      return verbs !== null && /^upgrade \S+$/.test(verbs);
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
 * there is nothing in it that a `@volter/project` version could break — and
 * nothing an upgrade could rewrite if the pin did complain. Found
 * source-mounting SimCity: the project scaffolded at an older pin, and the
 * editor refused to open it with an instruction to upgrade the project, that
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
 * reads `volter.project.json` for every project, ingest or not, so a v1
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

export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
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
  const pinned = `This project is pinned to @volter/project ${projectEngine}, but this editor is running ${editorEngine}.`;
  // THE MESSAGE CARRIES ITS OWN FIX. It is the one string every door repeats —
  // the tab, the console ledger the editor's `status` command prints, and the
  // `edit` command's refusal — so a reader of any one of them learns what to
  // run, not just what is wrong. Measured on the owner's stream 2026-10-06: a
  // 0.5.185 pin under a 0.5.189 editor sat behind "Starting Blender…" with the
  // cause only in `status`, and nothing anywhere said how to move the pin.
  // Upgrading the packages never moves it, so every upgrade arrives here.
  const upgrades = productNames()?.upgrade === true;
  const summary = `pinned to ${projectEngine}, editor is ${editorEngine}`;
  if (comparison === -1) {
    const manual = `set "engine": { "version": "${editorEngine}" } in volter.project.json`;
    if (upgrades) {
      throw new ProjectCompatibilityError(
        `${pinned} To fix it, run ${commandLine(`upgrade ${editorEngine}`)} in the project folder, or ${manual}.`,
        {
          kind: 'upgrade-project',
          title: 'Upgrade this project',
          guidance: "Upgrading the @volter packages does not move the project's engine pin; `upgrade` moves both together.",
          verbs: [`upgrade ${editorEngine}`],
          summary,
        },
      );
    }
    throw new ProjectCompatibilityError(`${pinned} To fix it, ${manual}.`, {
      kind: 'use-compatible-editor',
      title: 'Use a compatible editor',
      guidance:
        `The project's engine pin is older than this editor. The one-line fix is to ${manual}; ` +
        'this product does not rewrite project source on its own.',
      summary,
    });
  }

  if (comparison === 1 && upgrades) {
    throw new ProjectCompatibilityError(
      `${pinned} To fix it, run ${commandLine(`upgrade ${projectEngine}`)} in the project folder, then \`npm install\`.`,
      {
        kind: 'upgrade-project',
        title: 'Upgrade this project',
        // AND THE CASE `upgrade` CANNOT FIX: the project's packages are already at its pin,
        // and what is running is an older editor from somewhere else (a global install, another
        // checkout). `upgrade` then says "already on" and stops, so the guidance names the way
        // out the older message had: open it from the installation that matches.
        guidance:
          `This project targets a newer engine. \`upgrade\` moves its @volter packages to ${projectEngine}; npm install then installs that editor. ` +
          `If \`upgrade\` says the project is already on ${projectEngine}, this editor is not the project's own installation: ` +
          `open it from the matching newer one — ${commandLine('edit .')} run through the project's own install (\`npx\` in the project folder).`,
        verbs: [`upgrade ${projectEngine}`],
        summary,
      },
    );
  }

  throw new ProjectCompatibilityError(pinned, {
    kind: 'use-compatible-editor',
    title: 'Use a compatible editor',
    guidance:
      comparison === 1
        ? 'This project targets a newer engine. Open it from the matching newer Volter Editor checkout or installation.'
        : 'The engine identities differ. Open the project with the exact Volter Editor version it is pinned to.',
    summary,
  });
}
