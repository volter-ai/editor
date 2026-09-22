/**
 * Read-only first-contact inspection for a folder the user may want to open
 * or adapt. Detection is deliberately evidence-based and never writes files.
 */

export type ProjectWorkspaceState =
  | 'vgai-project'
  | 'adaptable-project'
  | 'empty-folder'
  | 'unknown-project';

export type SuggestedAdapterSurface = 'three' | 'canvas' | 'dom';

export interface ProjectInspection {
  workspaceState: ProjectWorkspaceState;
  detectedTechnologies: string[];
  suggestedSurface: SuggestedAdapterSurface | null;
  entryCandidates: string[];
  /** Evidence that makes automatic one-file metadata adaptation unsafe. */
  adaptationBlockers: string[];
  hasManifest: boolean;
  writesPerformed: false;
  summary: string;
  nextAction: string;
}

export interface ProjectInspectionReader {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  list(path: string): Promise<ProjectInspectionEntry[]>;
}

export interface ProjectInspectionEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

export interface IngestManifestOptions {
  name: string;
  engineVersion: string;
  surface?: SuggestedAdapterSurface | undefined;
  entry?: string | undefined;
}

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.vgai',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const MAX_VISITED_FILES = 500;
const MAX_DIRECTORY_DEPTH = 4;

function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot).toLowerCase();
}

function dependencyNames(value: unknown): Set<string> {
  if (!value || typeof value !== 'object') return new Set();
  const record = value as Record<string, unknown>;
  const names = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const dependencies = record[field];
    if (!dependencies || typeof dependencies !== 'object') continue;
    for (const name of Object.keys(dependencies as Record<string, unknown>)) names.add(name);
  }
  return names;
}

async function readPackageDependencies(reader: ProjectInspectionReader): Promise<Set<string>> {
  if (!(await reader.exists('package.json'))) return new Set();
  try {
    return dependencyNames(JSON.parse(await reader.read('package.json')));
  } catch {
    return new Set();
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: bounded breadth-first file evidence collection keeps traversal limits and filtering in one place.
async function collectSourceFiles(reader: ProjectInspectionReader): Promise<string[]> {
  const files: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
  while (queue.length > 0 && files.length < MAX_VISITED_FILES) {
    const current = queue.shift();
    if (!current) break;
    let entries: ProjectInspectionEntry[];
    try {
      entries = await reader.list(current.path);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.type === 'dir') {
        if (current.depth < MAX_DIRECTORY_DEPTH && !IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push({ path: entry.path, depth: current.depth + 1 });
        }
      } else if (SOURCE_EXTENSIONS.has(extension(entry.path)) || entry.path === 'index.html') {
        files.push(entry.path);
        if (files.length >= MAX_VISITED_FILES) break;
      }
    }
  }
  return files;
}

function candidateEntries(files: string[]): string[] {
  const preferredNames = [
    'src/vgai-entry.tsx',
    'src/vgai-entry.ts',
    'src/vgai-host.tsx',
    'src/vgai-host.ts',
    'src/adapter.tsx',
    'src/adapter.ts',
    'src/main.tsx',
    'src/main.ts',
    'src/index.tsx',
    'src/index.ts',
    'src/main.jsx',
    'src/main.js',
    'src/index.jsx',
    'src/index.js',
    'index.html',
  ];
  const available = new Set(files);
  const preferred = preferredNames.filter((name) => available.has(name));
  return [...preferred, ...files.filter((name) => !preferred.includes(name))].slice(0, 8);
}

/** Inspect a folder without mutating it or assuming that it is already VGAI-shaped. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one ordered evidence-to-recommendation decision table.
export async function inspectProject(reader: ProjectInspectionReader): Promise<ProjectInspection> {
  if (await reader.exists('vgai.project.json')) {
    return {
      workspaceState: 'vgai-project',
      detectedTechnologies: ['Volter Editor'],
      suggestedSurface: null,
      entryCandidates: [],
      adaptationBlockers: [],
      hasManifest: true,
      writesPerformed: false,
      summary: 'This folder is already a Volter Editor project.',
      nextAction: 'Open it in the editor.',
    };
  }

  // An inaccessible root is not an empty folder. Propagate the read failure
  // so callers can report it honestly instead of offering to scaffold over
  // a location they could not inspect.
  const rootEntries = await reader.list('');
  if (rootEntries.length === 0) {
    return {
      workspaceState: 'empty-folder',
      detectedTechnologies: [],
      suggestedSurface: null,
      entryCandidates: [],
      adaptationBlockers: [],
      hasManifest: false,
      writesPerformed: false,
      summary: 'This folder is empty.',
      nextAction: 'Create a new Volter Editor project here.',
    };
  }

  const dependencies = await readPackageDependencies(reader);
  const files = await collectSourceFiles(reader);
  const technologies: string[] = [];
  if (dependencies.has('@react-three/fiber')) technologies.push('React Three Fiber');
  if (dependencies.has('three')) technologies.push('three.js');
  if (dependencies.has('pixi.js') || [...dependencies].some((name) => name.startsWith('@pixi/'))) {
    technologies.push('PixiJS');
  }
  if (dependencies.has('react')) technologies.push('React');
  if (dependencies.has('vite')) technologies.push('Vite');

  const suggestedSurface: SuggestedAdapterSurface | null = technologies.some(
    (name) => name === 'three.js' || name === 'React Three Fiber',
  )
    ? 'three'
    : technologies.includes('PixiJS')
      ? 'canvas'
      : technologies.includes('React')
        ? 'dom'
        : null;
  const entries = candidateEntries(files);
  const adaptationBlockers: string[] = [];
  if (suggestedSurface && entries.length === 0) {
    adaptationBlockers.push('No JavaScript or TypeScript entry candidate was found.');
  }
  if (suggestedSurface === 'dom' && entries[0]) {
    let entrySource = '';
    try {
      entrySource = await reader.read(entries[0]);
    } catch {
      adaptationBlockers.push(`The suggested React entry ${entries[0]} could not be read.`);
    }
    if (/\b(?:ReactDOM\s*\.\s*render|createRoot|hydrateRoot)\s*\(/.test(entrySource)) {
      adaptationBlockers.push(
        `The React app mounts itself in ${entries[0]}; Volter Editor ingest requires a host-shim module that default-exports the mounted component and preserves the app's providers.`,
      );
    } else if (!/\bexport\s+default\b/.test(entrySource)) {
      adaptationBlockers.push(
        `The React entry ${entries[0]} does not default-export a component; create a host-shim module that does before adding Volter Editor metadata.`,
      );
    }
  }
  const adaptable = suggestedSurface !== null && adaptationBlockers.length === 0;

  return {
    workspaceState: adaptable ? 'adaptable-project' : 'unknown-project',
    detectedTechnologies: technologies,
    suggestedSurface,
    entryCandidates: entries,
    adaptationBlockers,
    hasManifest: false,
    writesPerformed: false,
    summary: adaptable
      ? `This looks like an existing ${technologies.join(' + ') || 'web'} project.`
      : suggestedSurface
        ? `This ${technologies.join(' + ') || 'web'} project needs an adapter step before Volter Editor metadata can be added safely.`
        : 'This folder is not empty, but its game framework could not be identified.',
    nextAction: adaptable
      ? 'Review the detected entry and adapter, then add Volter Editor metadata without rewriting the game source.'
      : (adaptationBlockers[0] ??
        'Choose the entry point and adapter explicitly before adding Volter Editor metadata.'),
  };
}

/**
 * Build the one-file, source-preserving metadata bridge for a detected app.
 * The caller is responsible for obtaining explicit consent before writing it.
 */
export function createIngestManifest(
  inspection: ProjectInspection,
  options: IngestManifestOptions,
): Record<string, unknown> {
  const surface = options.surface ?? inspection.suggestedSurface;
  const entry = options.entry ?? inspection.entryCandidates[0];
  const portableEntry = entry?.replace(/\\/g, '/');
  const entryEscapesProject =
    portableEntry !== undefined &&
    (portableEntry.startsWith('/') ||
      portableEntry.startsWith('//') ||
      /^[A-Za-z]:\//.test(portableEntry) ||
      portableEntry.split('/').includes('..'));
  const explicitUnknownOverride =
    inspection.workspaceState === 'unknown-project' &&
    options.surface !== undefined &&
    options.entry !== undefined;
  if (
    (inspection.workspaceState !== 'adaptable-project' && !explicitUnknownOverride) ||
    !surface ||
    !entry ||
    entryEscapesProject
  ) {
    throw new Error(
      entryEscapesProject
        ? 'Adapter entry must be a project-relative path that stays inside the selected folder.'
        : (inspection.adaptationBlockers[0] ??
            'Choose a supported adapter surface and source entry before adapting this folder.'),
    );
  }
  return {
    manifestVersion: 2,
    name: options.name,
    version: '0.1.0',
    engine: { version: options.engineVersion },
    roots: [
      {
        id: 'game',
        adapter: { surface, ingest: {} },
        entry,
      },
    ],
  };
}
