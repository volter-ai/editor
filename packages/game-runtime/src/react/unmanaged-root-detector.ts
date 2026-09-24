export interface UnmanagedReactRootFinding {
  readonly file: string;
  readonly line: number;
  readonly api: 'createRoot' | 'hydrateRoot' | 'ReactDOM.render';
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

/**
 * The project's own `dom`-root adapter implementation, which is ALLOWED to
 * create a React root because creating it is the whole job.
 *
 * The rule here is "a React root must come from a declared manifest root, not
 * from game code mounting a second lifecycle beside it". That held trivially
 * while the only `createRoot` in existence lived in the engine. It stopped
 * holding when the `react-root` capability moved INTO the project (`vgai add
 * react-root`): its `createRoot` is precisely what serves a declared `dom`
 * root — the opposite of bypassing the manifest.
 *
 * Matched on the capability's DIRECTORY rather than a filename, so that
 * editing the copied source — the entire point of the copied-source model —
 * cannot re-arm the rule against itself. A Vue or Svelte replacement never
 * trips it at all: only React DOM's own API is detected.
 */
const DOM_ROOT_ADAPTER_DIR = /(^|[/\\])src[/\\]lib[/\\]react-root[/\\]/;

/**
 * Find project-owned React DOM root creation. VGAI hosts React through
 * manifest adapter roots, so any of these calls in game source creates an
 * unmanaged second lifecycle and is a hard validation error — except in the
 * project's own dom-root adapter (see {@link DOM_ROOT_ADAPTER_DIR}).
 *
 * The exemption lives HERE, in the detector, rather than in either caller:
 * the editor's validate-on-change watcher and `vgai validate` both scan the
 * same tree, and a rule that means two different things depending on who asks
 * is worse than no rule.
 */
export function detectUnmanagedReactRoots(
  source: string,
  file: string,
): UnmanagedReactRootFinding[] {
  if (DOM_ROOT_ADAPTER_DIR.test(file)) return [];
  const findings: UnmanagedReactRootFinding[] = [];
  const aliases = new Map<string, 'createRoot' | 'hydrateRoot'>();

  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]react-dom\/client['"]/g)) {
    for (const member of (match[1] ?? '').split(',')) {
      const parsed = member.trim().match(/^(createRoot|hydrateRoot)(?:\s+as\s+([\w$]+))?$/);
      if (parsed) aliases.set(parsed[2] ?? parsed[1]!, parsed[1] as 'createRoot' | 'hydrateRoot');
    }
  }

  for (const [alias, api] of aliases) {
    const call = new RegExp(`\\b${alias.replace(/[$]/g, '\\$&')}\\s*\\(`, 'g');
    for (const match of source.matchAll(call)) {
      findings.push({ file, line: lineAt(source, match.index ?? 0), api });
    }
  }

  const namespaceNames = new Set<string>();
  for (const match of source.matchAll(
    /import\s+(?:\*\s+as\s+|)([\w$]+)\s+from\s*['"]react-dom(?:\/client)?['"]/g,
  )) {
    namespaceNames.add(match[1]!);
  }
  namespaceNames.add('ReactDOM');
  for (const name of namespaceNames) {
    for (const api of ['createRoot', 'hydrateRoot', 'render'] as const) {
      const call = new RegExp(`\\b${name}\\.${api}\\s*\\(`, 'g');
      for (const match of source.matchAll(call)) {
        findings.push({
          file,
          line: lineAt(source, match.index ?? 0),
          api: api === 'render' ? 'ReactDOM.render' : api,
        });
      }
    }
  }

  return findings.filter(
    (finding, index) =>
      findings.findIndex(
        (candidate) =>
          candidate.file === finding.file &&
          candidate.line === finding.line &&
          candidate.api === finding.api,
      ) === index,
  );
}
