import type { Plugin } from 'vite';

const MANIFEST_ENTRIES_ID = 'virtual:vgai-manifest-entries';
const RESOLVED_MANIFEST_ENTRIES_ID = `\0${MANIFEST_ENTRIES_ID}`;

function collectManifestEntries(manifest: unknown): string[] {
  const rawWorlds =
    manifest && typeof manifest === 'object'
      ? (manifest as { roots?: unknown }).roots
      : undefined;
  const entries = [
    ...new Set(
      (Array.isArray(rawWorlds) ? rawWorlds : [])
        .map((world) =>
          world && typeof world === 'object' ? (world as { entry?: unknown }).entry : undefined,
        )
        .filter((entry): entry is string => typeof entry === 'string'),
    ),
  ];

  for (const entry of entries) {
    if (entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..')) {
      throw new Error(`vgai.project.json world entry must be project-relative: ${entry}`);
    }
  }

  return entries;
}

/**
 * Render imports for the manifest's exact `roots[].entry` declarations.
 * The manifest—not a filename convention—is the only discovery source.
 */
export function renderManifestEntryModule(manifest: unknown): string {
  const entries = collectManifestEntries(manifest);
  const imports = entries.map(
    (entry, index) => `import * as entry${index} from ${JSON.stringify(`/${entry}`)};`,
  );
  const members = entries.map((entry, index) => `${JSON.stringify(entry)}: entry${index}`);
  return `${imports.join('\n')}\nexport const manifestEntryModules = {${members.join(',')}};\n`;
}

export function manifestEntryModulesPlugin(manifest: unknown): Plugin {
  return {
    name: 'vgai:manifest-entry-modules',
    resolveId(id) {
      return id === MANIFEST_ENTRIES_ID ? RESOLVED_MANIFEST_ENTRIES_ID : undefined;
    },
    load(id) {
      return id === RESOLVED_MANIFEST_ENTRIES_ID ? renderManifestEntryModule(manifest) : undefined;
    },
  };
}
