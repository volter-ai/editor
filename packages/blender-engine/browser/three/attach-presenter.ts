/**
 * ONE PRESENTER, ATTACHED TO ONE BLENDER (WS-AC, cut 3).
 *
 * `vgai_three.py` ships inside our Blender and turns every
 * `bpy.ops.render.render` into an ASK on a directory it owns; this is the
 * other half, for a host that holds that directory as a filesystem in its own
 * realm. It is the whole of what a host must do: hand it the filesystem, the
 * root the program was told to ask at, and a presenter
 * (`./presenter`'s `createPresenter()`, or the editor's own document wrapped
 * around the same translation).
 *
 * ONE WRITER PER DIRECTORY, which is the channel's single structural rule:
 * the guest writes and unlinks `ask/<n>.*`, this file writes and unlinks
 * `reply/<n>.*`, and neither ever touches the other's. Under a snapshot-backed
 * skew (WALI) a crossing edit is not a race but a terminated program -- the
 * host refuses a patch whose base moved under it.
 *
 * THE TRIGGER IS THE GUEST'S OWN `.done` FILE, never a timer: the filesystem
 * announces the write, this serves the ask, and the guest's removal of its
 * `ask/<n>.json` is the acknowledgement that lets the reply be retired.
 */
import { columnsToTypedArrays, describeFrame } from '../session-frame.mts';

/** The host filesystem seam, in exactly the shape this file uses. */
export interface PresenterFileSystem {
  existsSync(path: string): boolean;
  readFile(path: string): Promise<Uint8Array>;
  writeFileSync(path: string, data: string | Uint8Array): void;
  readdirSync(path: string): string[];
  unlinkSync(path: string): void;
  on(event: 'change' | 'delete', listener: (path: string) => void): unknown;
  off(event: 'change' | 'delete', listener: (path: string) => void): unknown;
}

/** What `createPresenter()` returns, in the part this file uses. */
export interface AttachablePresenter {
  present(frame: unknown, description: unknown, capture?: unknown): Promise<unknown>;
}

export function attachPresenter(
  filesystem: PresenterFileSystem,
  root: string,
  presenter: AttachablePresenter,
): () => void {
  const askDirectory = `${root}/ask`;
  const decoder = new TextDecoder();
  /**
   * Asks answered and not yet acknowledged -- this is also the "already
   * served" test, and it may not be replaced by a highest-id watermark or a
   * set that outlives an ask.
   *
   * ONE PRESENTER SERVES MANY PROCESSES, and every process starts its ask
   * sequence at 0 again: the numbers are a conversation's, not a page's.
   * MEASURED 2026-09-20 in the substrate tab with a page-lifetime `served`
   * set: the first `blender -b … -a` photographed twelve frames at ~0.30 s,
   * and every later one had its `ask/0` ("hello") skipped as already served,
   * printed the no-presenter line and path traced with Cycles at ~1.40 s a
   * frame -- a fallback that looked like a slow success. The ack is what
   * closes an ask: the guest removes `ask/<n>.*` once it has read the reply,
   * and this set is emptied by that.
   */
  const replied = new Set<string>();
  let attached = true;
  let pumping: Promise<void> = Promise.resolve();

  async function answer(id: string): Promise<unknown> {
    const payload = JSON.parse(decoder.decode(await filesystem.readFile(`${askDirectory}/${id}.json`))) as {
      op?: string;
      frame?: unknown;
      capture?: unknown;
      arena?: string;
    };
    if (payload.op === 'hello') return { ok: true };
    const arena = await filesystem.readFile(payload.arena ?? `${root}/arena.bin`);
    const answered = (await presenter.present(
      columnsToTypedArrays(arena, payload.frame),
      await describeFrame(arena, payload.frame),
      payload.capture,
    )) as { capture?: unknown; held?: unknown };
    // THE CAPTURE IS THE ANSWER'S BODY and `held` rides beside it, exactly as
    // the editor's worker composes it: the guest reads a photograph's own
    // fields off this object.
    const body =
      typeof answered?.capture === 'object' && answered.capture !== null
        ? (answered.capture as Record<string, unknown>)
        : {};
    return { ...body, ...(answered && 'held' in answered ? { held: answered.held } : {}) };
  }

  async function pump(): Promise<void> {
    if (!attached) return;
    let names: string[];
    try {
      names = filesystem.readdirSync(askDirectory);
    } catch {
      return;
    }
    const raised = new Set(names.filter((name) => name.endsWith('.done')).map((name) => name.slice(0, -'.done'.length)));
    // THE GUEST'S ACK: its own ask is gone, so it has taken the reply and this
    // host may retire the two files IT wrote. `.done` goes last, as it does on
    // the guest's side, because `.done` is the token the other side watches.
    for (const id of [...replied]) {
      if (raised.has(id)) continue;
      filesystem.unlinkSync(`${root}/reply/${id}.json`);
      filesystem.unlinkSync(`${root}/reply/${id}.done`);
      replied.delete(id);
    }
    for (const id of [...raised].sort((left, right) => Number(left) - Number(right))) {
      if (replied.has(id) || !attached) continue;
      let body: unknown;
      try {
        body = await answer(id);
      } catch (error) {
        body = { error: error instanceof Error ? error.message : String(error) };
      }
      if (!attached) return;
      filesystem.writeFileSync(`${root}/reply/${id}.json`, JSON.stringify(body ?? null));
      filesystem.writeFileSync(`${root}/reply/${id}.done`, '1');
      replied.add(id);
    }
  }

  /** Serialized: one ask is answered at a time, and this host's own writes
   *  into `reply/` announce themselves here too. */
  const wake = (): void => {
    pumping = pumping.then(pump, pump);
  };
  const changed = (path: string): void => {
    if (path.startsWith(`${askDirectory}/`)) wake();
  };
  filesystem.on('change', changed);
  filesystem.on('delete', changed);
  wake();

  return () => {
    attached = false;
    filesystem.off('change', changed);
    filesystem.off('delete', changed);
  };
}
