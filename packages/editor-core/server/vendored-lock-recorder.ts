/**
 * The RECORDER for a repo-vendored game's own source.
 *
 * A vendored game is somebody else's code we ship at the ZERO UNRECORDED DIFF
 * bar (`vendor/games/verify-unaltered.mjs`): every byte in the folder is in
 * exactly one declared bucket of `vendor/games/<id>.UPSTREAM.lock`, and each
 * bucket is hashed. That bar has never forbidden divergence — it forbids
 * SILENT divergence. So an authored edit to a vendored game is not a special
 * case to be refused; it is an edit whose RECORDER is the lock instead of the
 * user's own git.
 *
 * That is the whole content of this module. `server/creation-site-write.ts`
 * decides whether an edit may be written at all (ownership, containment, the
 * checksum guard) and `src/creation-site-edit.ts` decides what the new bytes
 * are; when those two say yes and the target happens to live inside a vendored
 * game, this module performs the write AND the lock update as one operation, so
 * the folder is never in a state the verifier would call an unrecorded diff.
 *
 * ## What it writes into the lock
 *
 * Nothing new: the existing `patches` bucket, whose contract is exactly what an
 * authored edit needs — a unified diff plus the two shas, with the verifier
 * REVERSE-APPLYING the diff and checking the result re-derives upstream. The
 * recorded diff IS the authoring edit, so that leg keeps working by
 * construction. The reconciliation is a pure function of the file's bytes:
 *
 *   bytes === upstream   → the path belongs in `sha256_manifest`, patch deleted
 *   bytes !== upstream   → the path belongs in `patches`, with a fresh diff
 *
 * which is what makes UNDO symmetric for free. Undo hands the previous bytes
 * back through the same `/__ingest-source/apply` route, the reconciliation runs
 * again, and the last undo — the one that restores upstream's own bytes —
 * removes the patch entry and puts the path back in the manifest. No direction
 * flag, no separate "unrecord" path that could disagree with the recording one.
 *
 * A `host_added` file (the contract shim) has no upstream at all, so its record
 * is a single sha and that is what gets refreshed.
 *
 * ## Why upstream's bytes are never fetched
 *
 * They are already in the folder, twice over: for a pristine file the on-disk
 * bytes ARE upstream (the manifest's sha proves it), and for an already-patched
 * file reverse-applying the recorded diff reproduces them (the verifier's own
 * leg 2, run here for the same reason). So the recorder is hermetic — no
 * network, no clone — and it REFUSES rather than guesses when either derivation
 * disagrees with the lock, because a lock that already disagrees with its
 * folder is not a base anything may record onto.
 *
 * ## The crash window, and the journal that closes it
 *
 * Two files must move together and no filesystem moves two files atomically.
 * The order used here is: plan everything (any refusal happens before a byte
 * moves) → write a ROLL-FORWARD JOURNAL naming the complete end state → write
 * the artifacts → delete the journal. A process that dies mid-write leaves the
 * journal, and {@link settleVendoredWrite} — called by every `/__ingest-source/*`
 * handler before it reads or writes the game — completes it. The journal lives
 * in `<game>/.vgai/`, the host-state directory the verifier already excludes and
 * git already ignores, so it is never itself a diff.
 *
 * ## Why every path here is bytes, not text
 *
 * A vendored game's files are not all source. A level-based game's placed
 * objects live in a binary level file — megabytes of it — so authoring one is a
 * write to a BINARY file and this module has to
 * record it like any other. Two measured facts shape the code below:
 *
 *  - **UTF-8 is lossy and silent.** Round-tripping a 2.3 MB binary level file
 *    through a string turned 2,339,773 bytes into 3,169,557. Nothing throws;
 *    the file is simply a
 *    different file. So every read, write, hash and journal field here carries
 *    `Buffer`, and the only `utf8` left is on the lock and the patch text, which
 *    are genuinely text.
 *  - **`git diff` says nothing about binary unless asked.** Without `--binary`
 *    it emits `Binary files a/x and b/x differ` — 233 bytes of prose that
 *    `git apply -R` cannot reverse, which would record a patch the verifier
 *    could never check. With `--binary` it emits a GIT binary patch carrying
 *    BOTH directions (a forward and a reverse delta, ~4.8 KB for a 12-byte
 *    change in that 2.3 MB file) and `git apply -R` reverses it exactly.
 *
 * `--binary` is therefore passed unconditionally rather than behind a
 * content-type test: measured on a text file it produces byte-identical output
 * to leaving it off, so one code path serves both and there is no sniffing rule
 * to get wrong. The verifier needs no counterpart change — it already copies
 * bytes (`copyFileSync`), already hashes a `Buffer`, and `git apply -R` is the
 * same tool on either kind of patch.
 */

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Where every lock lives, whatever the game is or how it is vendored — and,
 * for a `source-tree` game, where its folder lives too. Exported because
 * `creation-site-write.ts` resolves a vendored anchor against this same home
 * (a repo-vendored module's creation site is recorded relative to it, by
 * `vite-plugin-creation-site` through `ingestGameShadowRoots`), and two
 * spellings of one path is how they drift apart.
 */
export const LOCKS_DIR = ['vendor', 'games'];

/**
 * Host-authored state inside a game folder — the same two names
 * `verify-unaltered.mjs` excludes for every game. Writing here is never a diff,
 * so it is never recorded.
 */
const HOST_STATE_DIRS = ['.vgai', 'logs'];

/** `verify-unaltered.mjs`'s `DEFAULT_EXCLUDED_DIRS`, applied when a lock
 *  declares no `excluded` block of its own. */
const DEFAULT_EXCLUDED_DIRS = ['node_modules', 'dist', 'dist-ssr'];

/**
 * One DEVIATION in a file's recorded diff.
 *
 * A patched file can carry more than one, applied at different times by
 * different hands — `src/gameseq.js` carries a hand-written accessor-export
 * deviation and, on top of it, an editor-authored anchor. The patch reverse-
 * applies to upstream as a UNIT, so the two share one diff and one pair of
 * shas; only the rationale is per-layer.
 *
 * `onto_sha256` is the file's content BEFORE this layer was applied, and it is
 * what makes the stack reversible: an editor undo arrives as ordinary bytes,
 * and the only way to know it removes the TOP layer rather than adding a third
 * is that the incoming bytes hash to the top layer's own base.
 */
interface WhyLayer {
  why: string;
  onto_sha256: string;
  /** True when the recorder wrote this layer's prose, false/absent for a
   *  rationale a person wrote. The recorder may re-word its own and must never
   *  re-word a person's. */
  generated?: boolean;
}

interface PatchSpec {
  why: string;
  /** Present only once a file carries MORE THAN ONE deviation, or once the
   *  recorder has added one of its own on top of an existing rationale — a
   *  single hand-written patch keeps the shape it has always had. */
  why_layers?: WhyLayer[];
  patch: string;
  upstream_sha256: string;
  patched_sha256: string;
}

interface VendorLock {
  id: string;
  kind?: string;
  bundle_dir?: string;
  excluded?: { dirs?: string[]; files?: string[]; why?: string };
  patches?: Record<string, PatchSpec>;
  host_added?: { why?: string; files?: Record<string, string> };
  tracked_file_count?: number;
  sha256_manifest: Record<string, string>;
}

/** A file that resolved inside a lock-recorded vendored game. */
export interface VendoredTarget {
  readonly id: string;
  /** Absolute path of `vendor/games/<id>.UPSTREAM.lock`. */
  readonly lockPath: string;
  /** Absolute path of the directory the lock's manifest is rooted at. */
  readonly gameDir: string;
  /** The file's POSIX path relative to `gameDir` — the key every bucket uses. */
  readonly rel: string;
}

export type VendoredWriteResult =
  | { readonly ok: true; readonly recorded: string }
  | { readonly ok: false; readonly error: string };

/** Hashes BYTES, so it agrees with the verifier's `sha256(readFileSync(path))`
 *  for every file — text and binary alike. */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Git's own heuristic: a NUL byte near the front means "not text". Used only to
 * describe an edit in the lock, never to decide how it is recorded — that path
 * is one code path for both kinds on purpose.
 */
function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

function posix(path: string): string {
  return path.split(sep).join('/');
}

function isAtOrInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function readLock(lockPath: string): VendorLock {
  return JSON.parse(readFileSync(lockPath, 'utf8')) as VendorLock;
}

/** The directory a lock's manifest is rooted at — `gameDirFor` in the verifier,
 *  which is the one place this correspondence has to stay true. */
function gameDirFor(lock: VendorLock, engineRoot: string): string | null {
  if ((lock.kind ?? 'source-tree') === 'bundle') {
    return lock.bundle_dir ? resolve(engineRoot, lock.bundle_dir) : null;
  }
  return resolve(engineRoot, ...LOCKS_DIR, lock.id);
}

/** One lock's IDENTITY — everything {@link findVendoredTarget} answers with,
 *  and nothing that a recorded write changes. */
interface VendoredRoot {
  readonly id: string;
  readonly lockPath: string;
  /** Both spellings of the game's folder — see the symlink note below. */
  readonly bases: readonly string[];
}

/**
 * The root table, memoized per locks directory — because resolving it costs
 * 1.1 MB of JSON and ~28 `realpathSync` calls, and the answer for the
 * overwhelmingly common input is `null`.
 *
 * MEASURED on this repo's 28-lock estate: an uncached lookup of a path in a
 * user's own project — every read and every write the editor makes, since a
 * vendored game is the rare case — cost **3.83 ms**, all of it spent proving a
 * negative. Cached, the same lookup is a string-prefix walk. The write point
 * paid this per write; once the READ points settle too (which is why this
 * memo exists) it would have been paid per edit gesture as well.
 *
 * WHAT IS CACHED IS ONLY THE IDENTITY — `id`, `lockPath`, and the folder the
 * manifest is rooted at. Those come from `id`/`kind`/`bundle_dir`, which a
 * recorded write never touches; the mutable half (`patches`, `sha256_manifest`)
 * is re-read from disk by every caller that needs it, so a recorded write can
 * never be served a stale lock through here.
 *
 * REVALIDATION is the locks directory's own `mtimeMs` plus its entry list —
 * two syscalls. Adding, removing or renaming a lock changes both, and the
 * recorder writes locks through `renameSync` INTO this directory, so an
 * ordinary recorded write bumps the mtime and refreshes the table on its own.
 * The one edit this cannot see is a lock's `kind`/`bundle_dir` being rewritten
 * IN PLACE by hand, which relocates an existing game's folder — a repo-level
 * change, not a runtime one, and it takes a dev-server restart like every
 * other.
 */
const rootTableByLocksDir = new Map<
  string,
  { readonly mtimeMs: number; readonly names: string; readonly roots: readonly VendoredRoot[] }
>();

function vendoredRoots(engineRoot: string): readonly VendoredRoot[] {
  const locksDir = resolve(engineRoot, ...LOCKS_DIR);
  let mtimeMs: number;
  let names: string[];
  try {
    mtimeMs = statSync(locksDir).mtimeMs;
    names = readdirSync(locksDir).filter((name) => name.endsWith('.UPSTREAM.lock'));
  } catch {
    rootTableByLocksDir.delete(locksDir);
    return [];
  }
  const key = names.join(' ');
  const cached = rootTableByLocksDir.get(locksDir);
  if (cached && cached.mtimeMs === mtimeMs && cached.names === key) return cached.roots;

  const roots: VendoredRoot[] = [];
  for (const name of names) {
    const lockPath = join(locksDir, name);
    let lock: VendorLock;
    try {
      lock = readLock(lockPath);
    } catch {
      continue;
    }
    const gameDir = gameDirFor(lock, engineRoot);
    if (!gameDir) continue;
    // `absPath` arrives realpath-resolved (the containment check in
    // `creation-site-write.ts` is realpath-based), while `engineRoot` — and so
    // `gameDir` — is whatever spelling the server was constructed with. On a
    // checkout reached through a symlink (macOS `/tmp` → `/private/tmp` is the
    // everyday case) the two spellings of the SAME directory diverge, and a
    // prefix miss does not refuse anything: the caller falls through to
    // the plain unrecorded write, which is exactly the silent-drift failure
    // this module exists to make impossible. So both spellings are kept.
    roots.push({ id: lock.id, lockPath, bases: [...new Set([gameDir, realOrSelf(gameDir)])] });
  }
  rootTableByLocksDir.set(locksDir, { mtimeMs, names: key, roots });
  return roots;
}

/**
 * The lock-recorded vendored game whose folder contains `absPath` (or IS
 * `absPath`), or `null` when no lock covers it — a user's own project, where
 * their version control is the recorder and nothing here has anything to do.
 *
 * Pure: it reads locks and answers. The repair pass is
 * {@link settleVendoredWrite}, deliberately a separate call so a lookup never
 * has a side effect.
 */
export function findVendoredTarget(absPath: string, engineRoot: string): VendoredTarget | null {
  for (const root of vendoredRoots(engineRoot)) {
    for (const base of root.bases) {
      if (!isAtOrInside(base, absPath)) continue;
      return {
        id: root.id,
        lockPath: root.lockPath,
        gameDir: base,
        rel: posix(relative(base, absPath)),
      };
    }
  }
  return null;
}

/** The realpath when the directory exists, the spelling itself when it does
 *  not — a missing dir cannot contain `absPath` either way. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// ────────────────────────────────────────────────────────────── the journal

interface PendingVendoredWrite {
  readonly version: 2;
  readonly gameFile: string;
  /** Base64, because the journal is JSON and the game file may be binary — a
   *  string field here would silently re-encode 2.3 MB of level data. */
  readonly gameFileBase64: string;
  readonly lockPath: string;
  readonly lockContent: string;
  /** Absolute path of the patch file, when this write has one to write OR to
   *  delete; `patchContent === null` means delete. */
  readonly patchPath: string | null;
  readonly patchContent: string | null;
}

function journalPathFor(target: VendoredTarget): string {
  return join(target.gameDir, '.vgai', 'vendored-lock-write.json');
}

function hostStateDir(target: VendoredTarget): string {
  return join(target.gameDir, '.vgai');
}

/**
 * Write `content` to `path` through a rename, staging the temporary file in the
 * game's own host-state directory so a torn write is never visible AS A FILE to
 * the verifier's directory walk (which excludes `.vgai/`) or to git.
 */
function writeThroughRename(path: string, content: Buffer, stageDir: string): void {
  mkdirSync(stageDir, { recursive: true });
  mkdirSync(dirname(path), { recursive: true });
  const staged = join(stageDir, `stage-${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(staged, content);
  renameSync(staged, path);
}

/** Text artifacts — the lock and the patch — are genuinely text; only the game
 *  file itself may be binary. */
function writeTextThroughRename(path: string, content: string, stageDir: string): void {
  writeThroughRename(path, Buffer.from(content, 'utf8'), stageDir);
}

function applyPending(pending: PendingVendoredWrite, stageDir: string): void {
  if (pending.patchPath) {
    if (pending.patchContent === null) rmSync(pending.patchPath, { force: true });
    else writeTextThroughRename(pending.patchPath, pending.patchContent, stageDir);
  }
  writeTextThroughRename(pending.lockPath, pending.lockContent, stageDir);
  writeThroughRename(pending.gameFile, Buffer.from(pending.gameFileBase64, 'base64'), stageDir);
}

/**
 * Finish any write that died between its artifacts, so no caller ever reads or
 * writes a vendored game whose lock and bytes disagree because of us.
 *
 * Roll-FORWARD only, and therefore idempotent: the journal names the complete
 * end state, so re-writing all of it is always correct no matter how far the
 * interrupted attempt got.
 *
 * Returns whether it actually rolled anything forward. That answer is not
 * bookkeeping: settling REPLACES THE FILE'S BYTES, so a caller that serves
 * modules (the dev server) has to invalidate what it had cached for that file,
 * exactly as it does after a write of its own. `false` — the ordinary case —
 * means nothing moved and there is nothing to invalidate.
 */
export function settleVendoredWrite(target: VendoredTarget): boolean {
  const journal = journalPathFor(target);
  if (!existsSync(journal)) return false;
  const pending = JSON.parse(readFileSync(journal, 'utf8')) as PendingVendoredWrite;
  if (pending.version !== 2) {
    // FAIL CLOSED, LOUDLY. A journal exists because a write may have died
    // between the game's bytes and its lock; one this build cannot read means
    // we do not know whether they agree, and every route calls this precisely so
    // nothing plans, reads or writes against bytes in that state. Returning
    // quietly — which is what this did — let the very next request act on a
    // possibly half-written vendored game with no signal anywhere.
    const message =
      `${target.id}: ${journal} is a pending vendored write this build cannot settle ` +
      `(journal version ${String(pending.version)}, expected 2). The game's bytes and its lock ` +
      'may disagree. Check the game with `node vendor/games/verify-unaltered.mjs`, then delete ' +
      'the journal once the tree is consistent.';
    console.error(`[vendored-lock-recorder] ${message}`);
    throw new Error(message);
  }
  applyPending(pending, hostStateDir(target));
  rmSync(journal, { force: true });
  return true;
}

// ─────────────────────────────────────────────────────────── diff plumbing

/**
 * `git`, run in a throwaway directory OUTSIDE any working tree.
 *
 * The verifier reverse-applies recorded diffs with `git apply -R`, so the
 * recorded diffs are produced by `git diff` — the same tool, at zero fuzz. A
 * hand-rolled unified diff would be a second implementation of the format the
 * gate reads, which is the one place a subtle disagreement would show up as a
 * red gate nobody could explain.
 */
function inScratch<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'vgai-vendored-record-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `git`, forced to treat the scratch directory as OUTSIDE every repository —
 * enforced, not assumed.
 *
 * `tmpdir()` is `TMPDIR`, and `TMPDIR` can point INSIDE a working tree (an
 * agent worktree sets a short one because a checkout path can overrun the
 * ~104-byte unix-socket limit). When it does, `git apply -R` resolves the
 * patch's paths against the enclosing repo's TOPLEVEL instead of `cwd`, finds
 * nothing to change, and EXITS 0 — measured: the reverse-apply returned the
 * patched bytes unchanged, so `upstreamBytesOf` computed a sha that was not
 * upstream's and every write to that game was refused with "the lock is not a
 * base anything may record onto", which names the wrong thing entirely.
 *
 * `GIT_CEILING_DIRECTORIES` at the scratch dir's PARENT stops repository
 * discovery before it can leave the scratch dir, so the same command behaves
 * identically wherever `TMPDIR` points. (`--unsafe-paths` was measured NOT to
 * fix it; a `git init` in the scratch dir does, at the cost of a second
 * process.)
 */
function gitInScratch(dir: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir) },
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A unified diff taking `before` to `after` for `rel`, in the `a/`+`b/` shape
 *  the recorded patches already use, or `null` when the two are identical. */
function unifiedDiff(rel: string, before: Buffer, after: Buffer): string | null {
  if (before.equals(after)) return null;
  return inScratch((dir) => {
    const a = join(dir, 'a', rel);
    const b = join(dir, 'b', rel);
    mkdirSync(dirname(a), { recursive: true });
    mkdirSync(dirname(b), { recursive: true });
    writeFileSync(a, before);
    writeFileSync(b, after);
    let out = '';
    try {
      // `--binary` is what makes this work for a binary level file: without
      // it git emits only `Binary files … differ`, which reverse-applies to
      // nothing. On text it changes the output not at all.
      out = gitInScratch(dir, [
        'diff',
        '--binary',
        '--no-index',
        '--no-prefix',
        '--no-color',
        '--',
        `a/${rel}`,
        `b/${rel}`,
      ]);
    } catch (error) {
      // `git diff --no-index` exits 1 WHEN THERE IS A DIFFERENCE — the normal
      // case here. The diff text is still on stdout; only an empty stdout is a
      // real failure.
      out = String((error as { stdout?: string }).stdout ?? '');
    }
    if (!out.trim()) throw new Error(`git produced no diff for ${rel}`);
    if (/^Binary files .* differ$/m.test(out)) {
      // Belt and braces: if this ever reappears, the recorded patch would be
      // unreversible and the verifier would fail later, on somebody else's
      // commit. Refuse here instead, where the cause is still visible.
      throw new Error(
        `git described the change to ${rel} only as "Binary files differ" — that cannot be ` +
          'reverse-applied, so it is not a record and will not be written',
      );
    }
    return out;
  });
}

/** The content reverse-applying `patchText` to `patched` yields — the verifier's
 *  own leg 2, returning the bytes instead of their digest. */
function reverseApply(rel: string, patched: Buffer, patchText: string): Buffer {
  return inScratch((dir) => {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, patched);
    writeFileSync(join(dir, '.recorded.patch'), patchText, 'utf8');
    gitInScratch(dir, ['apply', '-R', '--whitespace=nowarn', '.recorded.patch']);
    return readFileSync(target);
  });
}

/** `src/render.js` → `src-render.js.patch`, the convention already on disk. */
function patchFileNameFor(rel: string): string {
  return `${rel.split('/').join('-')}.patch`;
}

/** Reuse a patch record's own path once it exists. For a new record, keep the
 * readable convention unless another source path already owns that name; the
 * digest suffix makes the collision resolution deterministic and injective. */
function patchPathFor(
  lock: VendorLock,
  target: VendoredTarget,
  bucket: 'files' | 'patches',
): string {
  const lockDir = dirname(target.lockPath);
  if (bucket === 'patches') return join(lockDir, lock.patches![target.rel]!.patch);
  const directory = join(lockDir, `${target.id}.patches`);
  const readable = patchFileNameFor(target.rel);
  const relativeCandidate = posix(relative(lockDir, join(directory, readable)));
  const occupied = new Set(Object.values(lock.patches ?? {}).map((spec) => spec.patch));
  if (!occupied.has(relativeCandidate)) return join(directory, readable);
  const suffix = sha256(Buffer.from(target.rel, 'utf8')).slice(0, 10);
  return join(directory, readable.replace(/\.patch$/, `-${suffix}.patch`));
}

// ─────────────────────────────────────────────────────────── reconciliation

type Bucket = 'files' | 'patches' | 'host_added' | 'excluded' | 'undeclared';

function bucketOf(lock: VendorLock, rel: string): Bucket {
  const top = rel.split('/')[0] ?? '';
  const excludedDirs = new Set([
    ...(lock.excluded?.dirs ?? DEFAULT_EXCLUDED_DIRS),
    ...HOST_STATE_DIRS,
  ]);
  if (excludedDirs.has(top)) return 'excluded';
  if ((lock.excluded?.files ?? []).includes(rel)) return 'excluded';
  if (lock.sha256_manifest[rel] !== undefined) return 'files';
  if (lock.patches?.[rel] !== undefined) return 'patches';
  if (lock.host_added?.files?.[rel] !== undefined) return 'host_added';
  return 'undeclared';
}

/**
 * Put `key` back into a key-ordered map at the position it sorts to, leaving
 * every other key's relative order alone.
 *
 * The manifests on disk are ASCII-sorted, and an undo that returns a path to
 * the manifest should leave a one-line diff there rather than a re-ordered
 * file. Appending would do that today and drift forever after.
 */
function insertOrdered<T>(map: Record<string, T>, key: string, value: T): Record<string, T> {
  const out: Record<string, T> = {};
  let placed = false;
  for (const [existing, existingValue] of Object.entries(map)) {
    if (!placed && existing > key) {
      out[key] = value;
      placed = true;
    }
    out[existing] = existingValue;
  }
  if (!placed) out[key] = value;
  return out;
}

/** The generated `why` for an editor-authored deviation. Names the edit in the
 *  terms a reviewer reads the lock in: what moved, where, and by whom. */
function describeEdit(
  rel: string,
  note: string | undefined,
  before: Buffer,
  after: Buffer,
): string {
  // Where the bytes moved, in the terms the file itself is read in: a line
  // number for source, a byte offset for data. Naming a "line" in a 2.3 MB
  // level archive would be a number nobody could look up.
  const where = (() => {
    if (looksBinary(before) || looksBinary(after)) {
      let at = 0;
      while (at < before.length && at < after.length && before[at] === after[at]) at++;
      return `byte ${at} (binary; ${before.length} → ${after.length} bytes)`;
    }
    const a = before.toString('utf8').split('\n');
    const b = after.toString('utf8').split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) return `${rel}:${i + 1}`;
    }
    return `${rel}:1`;
  })();
  // The note names the EDIT (which property, at which creation site); the
  // derived location names where the bytes actually moved, which is not the same
  // place — a property is often written a line or two below its `new`.
  const what = note ? `${note}; ` : '';
  return (
    `EDITOR-AUTHORED (creation-site write-back): ${what}changed at ${where}. ` +
    'Written into the game’s own source by the editor at the moment of the edit, and recorded ' +
    'here in the same operation — the diff IS the authoring edit, so it reverse-applies to ' +
    'upstream by construction.'
  );
}

/**
 * The promise a SINGLE recorder-authored deviation may make, spelled once
 * because it is both appended (when composing one layer) and stripped (when an
 * older single-layer record becomes layer one of a stack, where it stops being
 * true).
 */
const UNDO_TO_UPSTREAM =
  ' Undoing the edit in the editor removes this entry and returns the path to `sha256_manifest`.';

/**
 * The `why` a stack of layers reads as — and the ONE place the undo promise is
 * made, because that promise depends on how many layers there are.
 *
 * A single layer keeps the shape a lock has always had. A later layer is
 * APPENDED, and deliberately not renumbered into a list: the prose already
 * there may itself describe several deviations (`src/gameseq.js`'s does), and
 * re-labelling it "(1)" produced a record that opened "2 layered deviations …
 * (1) TWO layered deviations …". Leaving what someone wrote exactly as they
 * wrote it and adding after it reads correctly however many they described.
 *
 * The tail states the real undo condition, which is the defect this exists to
 * prevent: a `why` that called an accessor-export patch editor-authored and
 * promised an undo straight back to `sha256_manifest` that could not happen
 * while the accessor hunks remained.
 */
function composeWhy(layers: readonly WhyLayer[]): string {
  const [first, ...rest] = layers;
  if (!first) {
    throw new Error(
      'a recorded patch always has at least one deviation to explain — a stack that emptied ' +
        'means the file is back to upstream, which removes the record rather than re-writing it',
    );
  }
  if (rest.length === 0) return first.generated ? `${first.why}${UNDO_TO_UPSTREAM}` : first.why;
  const added = rest.map((layer) => `AND, ON TOP OF THAT: ${layer.why}`).join(' ');
  return (
    `${first.why} ${added} These deviations were recorded separately and share one diff (the ` +
    'patch reverse-applies to upstream as a unit). Undoing the last edit in the editor removes ' +
    'only its own layer; the path returns to `sha256_manifest` only when EVERY deviation above ' +
    'is gone.'
  );
}

/**
 * The layer stack a patch entry already carries.
 *
 * A lock written before layering — or by hand — has a `why` and no `why_layers`,
 * and that `why` is layer one: it describes the whole deviation as it stands,
 * applied onto upstream. Seeding it that way is what lets a person's rationale
 * survive the next editor edit intact, which is the whole point.
 */
function existingLayers(spec: PatchSpec | undefined, upstreamSha: string): WhyLayer[] {
  if (!spec) return [];
  if (spec.why_layers && spec.why_layers.length > 0) return spec.why_layers.map((l) => ({ ...l }));
  // A single-layer record the recorder itself wrote ends with a promise that is
  // only true while it IS the only layer. Strip it here — on an EXACT match with
  // our own sentence, so a person's prose is never touched — and let
  // `composeWhy` re-add or replace it from the stack's real shape.
  return spec.why.endsWith(UNDO_TO_UPSTREAM.trimStart())
    ? [
        {
          why: spec.why.slice(0, -UNDO_TO_UPSTREAM.trimStart().length).trimEnd(),
          onto_sha256: upstreamSha,
          generated: true,
        },
      ]
    : [{ why: spec.why, onto_sha256: upstreamSha }];
}

interface Reconciled {
  readonly lock: VendorLock;
  readonly patchPath: string | null;
  readonly patchContent: string | null;
  readonly recorded: string;
}

/**
 * The buckets with no upstream counterpart to diff against.
 *
 * `host_added` is a file WE ship (the contract shim), so its record is one sha
 * and re-hashing it is the whole update. The other two are not records at all:
 * a path the lock has never heard of is ALREADY an unrecorded diff, and a path
 * the lock excludes is outside the estate's accounting entirely — writing
 * either through the recorder would be claiming an accounting that does not
 * exist, so both refuse by name.
 */
function reconcileWithoutUpstream(
  next: VendorLock,
  target: VendoredTarget,
  current: Buffer,
  after: Buffer,
  bucket: Exclude<Bucket, 'files' | 'patches'>,
): Reconciled {
  const rel = target.rel;
  if (bucket === 'undeclared') {
    throw new Error(
      `${rel} is not declared in ${target.id}'s lock — a file the lock does not know about ` +
        'is already an unrecorded diff, so the editor will not add a second one on top of it',
    );
  }
  if (bucket === 'excluded') {
    throw new Error(`${rel} is excluded from ${target.id}'s lock and needs no record`);
  }
  const recorded = next.host_added?.files?.[rel];
  if (!recorded || sha256(current) !== recorded) {
    throw new Error(
      `${rel} does not match the sha256 ${target.id}'s host_added record claims — the file ` +
        'already changed outside the recorder, so this edit will not absorb that divergence',
    );
  }
  const files = { ...(next.host_added?.files ?? {}) };
  files[rel] = sha256(after);
  next.host_added = { ...(next.host_added ?? {}), files };
  return {
    lock: next,
    patchPath: null,
    patchContent: null,
    recorded: `${target.id}: host-added ${rel} re-hashed in the lock`,
  };
}

/**
 * Upstream's own bytes for a file that is on disk right now, derived from the
 * folder itself — no network, no clone.
 *
 * Both derivations are CHECKED against the lock, and a disagreement throws
 * rather than proceeds: recording onto a base that already diverges from its
 * lock would launder somebody else's unrecorded diff into a sanctioned one,
 * which is the one failure mode that would make this whole lane worse than the
 * refusal it replaces.
 */
function upstreamBytesOf(
  lock: VendorLock,
  target: VendoredTarget,
  current: Buffer,
  bucket: 'files' | 'patches',
): Buffer {
  const rel = target.rel;
  if (bucket === 'files') {
    if (sha256(current) !== lock.sha256_manifest[rel]) {
      throw new Error(
        `${rel} does not match the sha256 ${target.id}'s lock records for it — the folder ` +
          'already diverges from its own lock, so nothing may be recorded onto it',
      );
    }
    return current;
  }
  const spec = lock.patches![rel]!;
  const patchPath = join(dirname(target.lockPath), spec.patch);
  if (!existsSync(patchPath)) {
    throw new Error(`${target.id}'s lock points at a missing patch file for ${rel}`);
  }
  if (sha256(current) !== spec.patched_sha256) {
    throw new Error(
      `${rel} does not match the \`patched_sha256\` ${target.id}'s lock records for it — ` +
        'the folder already diverges from its own lock',
    );
  }
  const upstream = reverseApply(rel, current, readFileSync(patchPath, 'utf8'));
  if (sha256(upstream) !== spec.upstream_sha256) {
    throw new Error(
      `${target.id}'s recorded patch for ${rel} does not reverse-apply to the upstream sha ` +
        'it claims — the lock is not a base anything may record onto',
    );
  }
  return upstream;
}

/**
 * The lock as it must read once `after` is the file's content — the pure half,
 * so a test drives exactly what the server does.
 */
export function reconcileLock(
  lock: VendorLock,
  target: VendoredTarget,
  current: Buffer,
  after: Buffer,
  note: string | undefined,
): Reconciled {
  const rel = target.rel;
  const next: VendorLock = JSON.parse(JSON.stringify(lock)) as VendorLock;
  const bucket = bucketOf(lock, rel);
  if (bucket !== 'files' && bucket !== 'patches') {
    return reconcileWithoutUpstream(next, target, current, after, bucket);
  }

  const upstream = upstreamBytesOf(lock, target, current, bucket);
  const patchFile = patchPathFor(lock, target, bucket);

  if (sha256(after) === sha256(upstream)) {
    // Back to upstream's own bytes: the deviation is gone, so its record goes
    // with it and the path returns to the manifest.
    if (next.patches) {
      delete next.patches[rel];
      if (Object.keys(next.patches).length === 0) delete next.patches;
    }
    next.sha256_manifest = insertOrdered(next.sha256_manifest, rel, sha256(upstream));
    syncTrackedCount(lock, next);
    return {
      lock: next,
      patchPath: bucket === 'patches' ? patchFile : null,
      patchContent: null,
      recorded: `${target.id}: ${rel} is upstream’s own bytes again — its patch record removed`,
    };
  }

  const patchText = unifiedDiff(rel, upstream, after);
  if (patchText === null) throw new Error(`${rel} produced no diff against upstream`);

  // LAYERING, under one rule: THE RECORDER OWNS AT MOST ONE LAYER — the top one
  // — and never touches anything below it.
  //
  //  - Over a rationale a person wrote, an editor edit ADDS a layer. Replacing
  //    it was the shipped defect: it called an accessor-export patch
  //    editor-authored and promised an undo straight back to `sha256_manifest`
  //    that could not happen while the accessor hunks remained.
  //  - Over the recorder's OWN layer, a further editor edit REPLACES it, keeping
  //    that layer's `onto_sha256`. A second drag of the same robot is not a
  //    second deviation, and a `why` that grew a paragraph per gesture would be
  //    unreadable within a session.
  //  - Bytes that hash to the top layer's own base are an UNDO of that layer:
  //    pop it, and the rationale underneath comes back exactly as it was.
  const layers = existingLayers(lock.patches?.[rel], sha256(upstream));
  const top = layers[layers.length - 1];
  const undoingTop = top !== undefined && sha256(after) === top.onto_sha256;
  const fresh: WhyLayer = {
    why: describeEdit(rel, note, upstream, after),
    // The base is the state before the recorder's layer BEGAN, not before this
    // particular gesture — otherwise re-dragging an object would move the undo
    // target forward and the first edit could never be popped.
    onto_sha256: top?.generated ? top.onto_sha256 : sha256(current),
    generated: true,
  };
  const nextLayers: WhyLayer[] = undoingTop
    ? layers.slice(0, -1)
    : top?.generated
      ? [...layers.slice(0, -1), fresh]
      : [...layers, fresh];

  const spec: PatchSpec = {
    why: composeWhy(nextLayers),
    // The array is the machine-readable half and only earns its place once
    // there is something a single `why` cannot express.
    ...(nextLayers.length > 1 ? { why_layers: nextLayers } : {}),
    patch: posix(relative(dirname(target.lockPath), patchFile)),
    upstream_sha256: sha256(upstream),
    patched_sha256: sha256(after),
  };
  next.patches = { ...(next.patches ?? {}) };
  next.patches[rel] = spec;
  if (bucket === 'files') {
    delete next.sha256_manifest[rel];
    syncTrackedCount(lock, next);
  }
  return {
    lock: next,
    patchPath: patchFile,
    patchContent: patchText,
    recorded: undoingTop
      ? `${target.id}: ${rel}'s editor-authored layer removed; ${nextLayers.length} deviation(s) still recorded`
      : `${target.id}: ${rel} recorded as a patch (${spec.patch})`,
  };
}

/** Keep `tracked_file_count` meaning what it means — the manifest's length —
 *  and leave it alone when it never meant that in this lock. */
function syncTrackedCount(before: VendorLock, after: VendorLock): void {
  if (before.tracked_file_count === Object.keys(before.sha256_manifest).length) {
    after.tracked_file_count = Object.keys(after.sha256_manifest).length;
  }
}

/** The 2-space shape every lock on disk already has, with the trailing newline
 *  a text file gets. An emptied `patches` was DELETED by then, so the key
 *  disappears from the serialized lock rather than becoming `{}`. */
function serializeLock(lock: VendorLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

// ──────────────────────────────────────────────────────────────── the write

/**
 * Write `after` into a vendored game's file AND update the game's lock, as one
 * journalled operation.
 *
 * Every refusal happens before a byte moves — that is the point of planning the
 * whole end state first — and every refusal names what is wrong with the lock
 * or the folder, never a generic failure.
 */
export function writeRecordedVendoredFile(
  target: VendoredTarget,
  after: Buffer,
  note?: string,
): VendoredWriteResult {
  const absFile = join(target.gameDir, ...target.rel.split('/'));
  let plan: Reconciled;
  let current: Buffer;
  try {
    current = readFileSync(absFile);
    plan = reconcileLock(readLock(target.lockPath), target, current, after, note);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const pending: PendingVendoredWrite = {
    version: 2,
    gameFile: absFile,
    gameFileBase64: after.toString('base64'),
    lockPath: target.lockPath,
    lockContent: serializeLock(plan.lock),
    patchPath: plan.patchPath,
    patchContent: plan.patchContent,
  };
  const stage = hostStateDir(target);
  let journalWritten = false;
  try {
    writeTextThroughRename(journalPathFor(target), JSON.stringify(pending, null, 2), stage);
    journalWritten = true;
    applyPending(pending, stage);
    rmSync(journalPathFor(target), { force: true });
  } catch (error) {
    if (journalWritten) {
      return {
        ok: true,
        recorded:
          `${target.id}: the complete recorder state is committed to its roll-forward journal; ` +
          'the next source access will settle the pending artifacts',
      };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, recorded: plan.recorded };
}
