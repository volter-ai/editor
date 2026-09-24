/**
 * How an ingested game's modules are run: the game's own entry module, in the
 * editor's realm, preceded by the host-added contract module the manifest names
 * in `ingest.contractShim` when it declares one.
 *
 * ORDER IS THE WHOLE CONTRACT. The shim assigns `window.vgaiGame` synchronously
 * at top level (see the field's schema description), so it must be evaluated
 * BEFORE the game's entry — a game that reads the declaration during its own
 * module evaluation would otherwise see nothing, and a shim that lazily
 * `import()`s a game module inside a verb closure would reorder the game's own
 * module side effects if it were evaluated after. Every discovery frontend
 * (the in-tree fixture glob, the manifest/project-folder resolver, the vendored
 * by-id fetcher) composes its two loaders through this one function rather than
 * open-coding the sequence three times.
 */
/**
 * The manifest's `ingest.dataWriter`, resolved against however THIS discovery
 * frontend serves the game's folder — the same three-way split `load` already
 * has (globbed fixture, `public/` url, `/@fs/` project folder), spelled once so
 * a fourth frontend cannot forget the field.
 *
 * The writer is deliberately NOT composed into `load`: it is not part of
 * booting the game and must not be evaluated at mount. It is imported lazily,
 * the first time an edit needs it, and a game that never has one edited never
 * pays for it.
 */
export function ingestDataWriter(
  specifier: string | undefined,
  loader: (relPath: string) => () => Promise<unknown>,
): { dataWriter?: { specifier: string; load: () => Promise<unknown> } } {
  return specifier === undefined ? {} : { dataWriter: { specifier, load: loader(specifier) } };
}

/**
 * The game's OWN source modules this root declares — see
 * {@link import('./types').IngestGame.sourceModules}. Spelled once here, beside
 * `ingestDataWriter`, for the same reason: every discovery frontend must fill
 * the field the same way or the lane decision's scope silently differs by route.
 */
export function declaredSourceModules(
  entry: string | undefined,
  worldEntry: string | undefined,
): string[] {
  return [entry, worldEntry].filter((path): path is string => typeof path === 'string');
}

export function composeIngestLoad(
  entry: () => Promise<unknown>,
  contractShim: (() => Promise<unknown>) | undefined,
): () => Promise<unknown> {
  if (!contractShim) return entry;
  return async () => {
    await contractShim();
    return entry();
  };
}
