/**
 * The DATA-WRITER seam — the half of ingest persistence for a game whose
 * authorable truth is not source.
 *
 * WHY THIS EXISTS. Creation-site write-back can only reach a value that a
 * `new` expression spells in the game's own code. A level-based game's placed
 * cargo does not: its enemies, pickups and objectives are binary records
 * inside a level file, parsed at load, and NO source literal mentions any of
 * them. An authored move of one is therefore an edit to the GAME'S OWN DATA —
 * the doctrine's third destination, not a fourth kind of overlay.
 *
 * WHY THE PLAN IS COMPUTED IN THE BROWSER, where every source plan is computed
 * on the server. Because a data write needs the RUNNING GAME, and the server
 * has no game. A level writer typically cannot place an object without knowing
 * which cell of the loaded level it landed in, and the only correct answer
 * comes from the game's own spatial lookup over the level it has parsed; a
 * server-side planner could
 * only take a client's word for that number, which would make "the server plans
 * against the real bytes" true in form and empty in substance. So the browser
 * reads the file's bytes through `/__ingest-source/read` (which already speaks
 * base64 for binary), the GAME'S OWN writer produces the next bytes, and
 * `/__ingest-source/apply` — the one guarded, checksum-matched, lock-recording
 * door — writes them. The server keeps every property it had: containment, the
 * `ifMatchSha` guard, and the vendored-lock recorder running INSIDE the apply
 * route, so a data edit to a vendored game still moves its lock in the same
 * operation.
 *
 * WHAT THE HOST KNOWS ABOUT ANY PARTICULAR GAME: nothing. The module is named
 * by the game's own manifest (`ingest.dataWriter`) and is validated against the
 * two exports below. There is no per-game branch here and there must never be
 * one.
 *
 * RESOURCE OWNERSHIP (brief-rule 4). The registration below is a module-level
 * slot owned by the ingest THREE mount (`ingest-root-adapter.ts`), which sets it
 * for every ingest mount — including to `null` for a game that declares no
 * writer, which is what tears the previous mount's registration down. Nothing
 * else writes it except {@link resetIngestDataWriterForTest}. It is scoped the
 * same way ingest ownership is: to the opened project, whose adapters are
 * rebuilt on a project switch.
 */

import type { NodeCreationSite } from '@vgai/project/adapter';
import type { ChannelValue } from '../creation-site-edit';

/**
 * The one `userData` key that anchors a live object to a record in its game's
 * own data file.
 *
 * The GAME declares it — a recorded patch or a contract shim stamps it where
 * the game itself builds the object from record `i`, which is the only place
 * the rendered object and its record are both in hand. The host never infers
 * one, never derives one from tree order, and never invents one for an object
 * that carries none: that object is unanchored, with its reason, and its edits
 * stay live-only (the anti-shim rule).
 */
export const DATA_RECORD_KEY = 'vgaiRecordIndex';

/** The record index a live object declares, or `null` when it declares none. */
export function dataRecordIndexOf(object: unknown): number | null {
  const userData = (object as { userData?: unknown } | null)?.userData;
  if (userData === null || typeof userData !== 'object') return null;
  const raw = (userData as Record<string, unknown>)[DATA_RECORD_KEY];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

/** One property edit, offered to a game's own data writer. */
export interface DataEditRequest {
  /** The index of the record this object is anchored to, in the writer's file. */
  readonly record: number;
  /** An editor property path (a `CREATION_SITE_CHANNELS` key). */
  readonly property: string;
  readonly baseline: ChannelValue;
  readonly next: ChannelValue;
}

export type DataEditPlan =
  | { readonly changed: true; readonly bytes: Uint8Array }
  | { readonly changed: false; readonly reason: string };

/** The contract a `ingest.dataWriter` module must satisfy, and all of it. */
export interface DataWriter {
  /** Project-relative path of the ONE file this writer edits. */
  readonly dataFile: string;
  /**
   * OPTIONAL, and the pre-edit half of {@link planDataEdit}: can this format
   * hold `property` at all, and if not, why not? Synchronous and cheap, because
   * it answers the sentence a surface shows BEFORE anyone drags anything.
   *
   * Without it, a property the writer will always refuse still reads as
   * "Persisting to …" until the user tries — which is the exact disagreement
   * `gate`/`describe` were unified to end, one layer down. A writer that
   * implements it must answer from the SAME table `planDataEdit` reads, so the
   * promise and the refusal cannot drift apart.
   */
  canPlace?(property: string): true | string;
  planDataEdit(bytes: Uint8Array, request: DataEditRequest): Promise<DataEditPlan> | DataEditPlan;
}

/** Where the declared writer got to. `absent` is not a failure — most games
 *  have no data file to write and say so by declaring nothing. */
export type DataWriterState =
  | { readonly state: 'absent' }
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly writer: DataWriter }
  | { readonly state: 'failed'; readonly reason: string };

let current: DataWriterState = { state: 'absent' };
let token = 0;

/**
 * Validate a loaded module against the contract, by NAME. A module that is
 * nearly right is refused rather than half-driven: a `planDataEdit` that is not
 * a function, or a `dataFile` that is not a string, cannot produce bytes anyone
 * should write to somebody else's game.
 */
export function readDataWriterModule(module: unknown, specifier: string): DataWriter {
  const m = module as Partial<DataWriter> | null;
  if (m === null || typeof m !== 'object') {
    throw new Error(`the data writer "${specifier}" did not export a module object`);
  }
  if (typeof m.dataFile !== 'string' || m.dataFile.length === 0) {
    throw new Error(
      `the data writer "${specifier}" exports no \`dataFile\` string — a writer must name the ` +
        'one project-relative file it edits',
    );
  }
  if (typeof m.planDataEdit !== 'function') {
    throw new Error(
      `the data writer "${specifier}" exports no \`planDataEdit\` function — that is the whole ` +
        'contract: (bytes, request) => {changed, bytes} | {changed, reason}',
    );
  }
  return {
    dataFile: m.dataFile,
    ...(typeof m.canPlace === 'function' ? { canPlace: m.canPlace.bind(m) } : {}),
    planDataEdit: m.planDataEdit.bind(m),
  };
}

/**
 * Register (or clear) the data writer this mount's game declares.
 *
 * The load is started immediately and its result lands asynchronously; until it
 * does, the state is `loading` and every surface says so rather than pretending
 * an object is unwritable. A load that arrives after a LATER registration is
 * dropped on its stale token — a fast project switch must not resurrect the
 * previous game's writer.
 */
export function setIngestDataWriter(
  declaration: { readonly specifier: string; readonly load: () => Promise<unknown> } | null,
): void {
  const mine = ++token;
  if (declaration === null) {
    current = { state: 'absent' };
    return;
  }
  current = { state: 'loading' };
  void declaration
    .load()
    .then((module) => {
      if (token !== mine) return;
      current = { state: 'ready', writer: readDataWriterModule(module, declaration.specifier) };
    })
    .catch((error) => {
      if (token !== mine) return;
      current = {
        state: 'failed',
        reason: `this game's declared data writer (${declaration.specifier}) could not be loaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    });
}

export function ingestDataWriterNow(): DataWriterState {
  return current;
}

/**
 * The reason this game's data format cannot hold `property` at all, or `null`
 * when it can (or when the writer declines to say, which is the honest floor:
 * an unanswered question is not a refusal).
 */
export function dataPlacementRefusal(property: string): string | null {
  const state = current;
  if (state.state !== 'ready' || !state.writer.canPlace) return null;
  const verdict = state.writer.canPlace(property);
  return verdict === true ? null : verdict;
}

/** Test-only: put the slot back to its boot state. */
export function resetIngestDataWriterForTest(): void {
  token++;
  current = { state: 'absent' };
}

/**
 * The anchor for an object that declares record `record`.
 *
 * An object that names a record but whose game has no reachable writer is
 * UNANCHORED WITH A REASON — never quietly re-anchored to the source line that
 * happened to construct its mesh. That fallback would be the shim this doctrine
 * forbids: it would report a `file:line` an edit can never be written at, and
 * the refusal the user finally got would name the wrong obstacle.
 */
export function dataRecordAnchor(record: number): NodeCreationSite {
  const state = current;
  switch (state.state) {
    case 'ready':
      return {
        anchored: true,
        kind: 'data',
        file: state.writer.dataFile,
        record,
        display: `${state.writer.dataFile} record ${record}`,
      };
    case 'loading':
      return {
        anchored: false,
        reason: `this object is record ${record} of its game's own level data; the game's data writer is still loading`,
      };
    case 'failed':
      return { anchored: false, reason: `this object is record ${record}, but ${state.reason}` };
    default:
      return {
        anchored: false,
        reason:
          `this object is record ${record} of its game's own level data, and this game declares ` +
          'no data writer (`ingest.dataWriter`) that could write that record back',
      };
  }
}
