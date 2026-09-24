/**
 * The `IngestGame` descriptor — the mountable shape `ingest/mount-three-ingest-root.ts`
 * (`mountThreeIngestRoot`) and `authoring/ingest-root-adapter.ts`
 * (`mountIngestGame`) consume, regardless of where it came from.
 *
 * It is the common contract every discovery frontend builds:
 * `ingest/surface-three.ts`'s glob-based discovery of the in-tree fixture games
 * under `ingest/games/<id>/vgai.project.json`, `binding-resolver.ts`'s
 * `resolveIngestDescriptor` (an arbitrary project folder's manifest, mounted
 * through the dev server), and `ingest/discovery-public-ingest.ts` (a game
 * served out of the repo's public dir, by id).
 *
 * Every field is a mounting FACT. The host runs the game's own entry module in
 * the editor's realm — there is no choice of route to declare.
 */
export interface IngestGame {
  /** Stable id (used by the launcher + conformance test; == the manifest world id). */
  id: string;
  /** Human label shown in the editor's game menu (== the manifest's game name). */
  name: string;
  /** One-line description (== the manifest world's optional `description`, or `''`). */
  description: string;
  /**
   * Import + run the unmodified game module. When the manifest declares a
   * `contractShim`, this thunk imports that module first — same realm, same
   * tick order the shim's timing contract describes.
   */
  load: () => Promise<unknown>;
  /**
   * The game's own DATA writer, when it declares one (`ingest.dataWriter`) —
   * the module that turns an authored move of an object the game placed from a
   * level file into new bytes of that file. Carried as its specifier plus a
   * loader, because the loader is the only thing that knows how this game's
   * files are served (globbed fixture, `public/` url, `/@fs/` folder) and the
   * specifier is what a refusal has to name. Absent ⇒ this game's authorable
   * truth is source only, and a record-anchored object refuses by name.
   */
  dataWriter?: { specifier: string; load: () => Promise<unknown> };
  /**
   * The PROJECT-RELATIVE paths of the game's own source modules this root
   * declares — its `entry` and, when it names one, `world.entry`.
   *
   * The lane decision reads them (`authoring/ingest-root-adapter.ts`,
   * `ingestSourceRoots`): their parent directories are the scope in which a
   * serve-time OID stamp counts as THIS root's. Carried as declared strings
   * rather than resolved paths because a discovery frontend does not always
   * know the project's absolute location; the mount does (`getCurrentProject`).
   * Absent ⇒ only the project folder itself scopes the serve-time door.
   */
  sourceModules?: readonly string[];
  /** How long to wait for the game's first captured frame before failing. */
  captureTimeoutMs?: number;
  /**
   * Map of game-relative-path substring → served asset URL. The ingest adapter
   * installs a `THREE.DefaultLoadingManager` URL modifier that rewrites any
   * requested URL containing a key to its value.
   */
  assets?: Record<string, string>;
  /**
   * Element ids the game expects to already exist in the DOM (e.g. an FPS game's
   * `#blocker`/`#instructions` overlay). The host creates hidden stub elements
   * with these ids before running the game, so DOM-dependent games stay
   * unmodified.
   */
  domStubs?: string[];
  /**
   * The game's own manifest `version` (D9 — orphan/mismatch detection), when
   * this descriptor was built straight from a manifest that has one.
   * `ingest/surface-three.ts`'s in-tree fixture route and
   * `ingest/discovery-public-ingest.ts` set this from the parsed manifest's
   * `version`; `ingest/resolve-three.ts`'s `resolveIngestDescriptor` (the
   * CLI-on-folder / manifest-world route) cannot — it only has a
   * `ResolvedAdapterRoot`, not the manifest's top-level `version`.
   */
  gameVersion?: string;
}
