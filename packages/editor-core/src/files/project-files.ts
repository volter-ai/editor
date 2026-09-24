/**
 * THE ONE FILE API over the open project, in PROJECT-RELATIVE paths — the
 * editor's half of `@volter/editor-sdk/host`'s `files` door (U5).
 *
 * Under the FRAME this is VS Code's `IFileService`/`ITextFileService` over the
 * workspace folder, installed as a provider by the Code-OSS bridge. Under the
 * HOST — standalone `vgai edit`, and the hosted browser build — it is today's
 * transports, and this module is the ONE place that says which transport owns
 * which path. That statement used to be spread across five files' doc
 * comments; it is written down once, here, because the fragmentation is the
 * fact U5 measured:
 *
 *   | path class            | the session's route          |
 *   |-----------------------|------------------------------|
 *   | read, anything        | Vite `/@fs/<root>/<path>`    |
 *   | write `public/**`     | `POST /__editor/save-file`   |
 *   | write `.vgai/**`      | `POST /__editor/vgai-file`   |
 *   | write `src/**` source | `POST /__ui-source/apply`    | the storage source-write backend |
 *   | list `public/**`      | `GET /__editor/assets`       | StorageBackend |
 *   | watch                 | `EventSource /__editor/events` | StorageBackend.watch |
 *
 * A path class with no host transport is REFUSED BY NAME, naming the route
 * that does own it. It is not this door's business to invent a general
 * project-root write route on the session: each of those routes is
 * deliberately narrow (`/__editor/vgai-file` accepts only `.vgai/**`,
 * `/__editor/data-file` only `src/data/**\/*.data.json`), and their own header
 * comments record that as defence in depth. Under the frame the question does
 * not arise — the workbench's file service owns the whole folder.
 *
 * `StorageBackend`'s paths are NOT this door's paths, and that difference is
 * the measurement the door exists for: `HttpStorage` is rooted at
 * `<project>/public/` while a project-rooted backend is rooted at the
 * project root. Callers that still speak `StorageBackend` keep doing so; what
 * they get under the frame is `storage/host-files-storage.ts`, a `public/`
 * view onto this door.
 */

import { bytesToBase64 } from '@volter/editor-sdk/kit/bytes-codec';
import { getProjectDefinePath } from '../editor-mode';
import { assertEditorServerAnswered, editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';
import { sourceMutationAttribution } from '@volter/editor-sdk/kit/editor-session-attribution';
import { filesProvider, filesProviderInstalled, type ProjectFileEvent } from './file-provider';

const BASE = '/__editor';

export interface ProjectFileEntry {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'dir';
}

/** Project-relative, `/`-separated, no leading slash, no `..`. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function assertContained(path: string): string {
  const normalized = normalize(path);
  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error(`projectFiles: "${path}" is not a project-relative path.`);
  }
  return normalized;
}

/**
 * The same containment check for a DIRECTORY, where the empty string is the
 * project root and therefore legal.
 *
 * It exists because `list` ran bare {@link normalize} while every other member
 * ran {@link assertContained} — so a `..` segment reached the frame's provider
 * or a session route while the same segment in a `read` was refused here.
 * `normalize` strips a LEADING slash; it has never removed a `..` segment, and
 * a caller reading its name could be forgiven for thinking otherwise. The
 * empty string is the one thing `assertContained` rejects that a directory
 * legitimately needs (it is how the project root itself is listed), which is
 * why this is a second function rather than a flag.
 */
function assertContainedDir(dir: string): string {
  const normalized = normalize(dir);
  if (normalized.split('/').includes('..')) {
    throw new Error(`projectFiles: "${dir}" is not a project-relative directory.`);
  }
  return normalized;
}

/**
 * The refusal a host-tier write to a path class no session route owns gets.
 * It NAMES the owning route rather than failing generically, because the one
 * thing a caller can do about it is use that route.
 */
function noHostWriteRoute(path: string): Error {
  return new Error(
    `projectFiles.write("${path}"): the standalone editor has no general project-root write route, ` +
      'and this door does not invent one. Source files are written through `/__ui-source/apply` ' +
      '(`ui-source/source-write-backend.ts`), `public/**` through `/__editor/save-file`, `.vgai/**` ' +
      'through `/__editor/vgai-file`. Under the Code-OSS frame the workbench file service owns the ' +
      'whole folder and this refusal cannot occur.',
  );
}

// ---------------------------------------------------------------------------
// The HOST fill — today's transports
// ---------------------------------------------------------------------------

async function hostRead(path: string): Promise<string> {
  const res = await fetch(`/@fs/${getProjectDefinePath()}/${path}`);
  if (!res.ok) throw new Error(`projectFiles.read "${path}": HTTP ${res.status}`);
  return res.text();
}

async function hostReadBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(`/@fs/${getProjectDefinePath()}/${path}`);
  if (!res.ok) throw new Error(`projectFiles.readBytes "${path}": HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function hostWrite(path: string, data: string | Uint8Array): Promise<void> {
  if (path.startsWith('public/')) {
    const body =
      typeof data === 'string'
        ? { path: path.slice('public/'.length), content: data, ...sourceMutationAttribution() }
        : {
            path: path.slice('public/'.length),
            content: bytesToBase64(data),
            encoding: 'base64' as const,
            ...sourceMutationAttribution(),
          };
    const res = await fetch(`${BASE}/save-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assertEditorServerAnswered(res, `Write ${path} failed`);
    if (!res.ok) throw new Error(`projectFiles.write "${path}": HTTP ${res.status}`);
    return;
  }
  if (path.startsWith('.vgai/')) {
    const body =
      typeof data === 'string'
        ? { path, content: data, ...sourceMutationAttribution() }
        : {
            path,
            content: bytesToBase64(data),
            encoding: 'base64' as const,
            ...sourceMutationAttribution(),
          };
    const res = await fetch(`${BASE}/vgai-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assertEditorServerAnswered(res, `Write ${path} failed`);
    if (!res.ok) throw new Error(`projectFiles.write "${path}": HTTP ${res.status}`);
    return;
  }
  throw noHostWriteRoute(path);
}

async function hostExists(path: string): Promise<boolean> {
  try {
    const res = await fetch(`/@fs/${getProjectDefinePath()}/${path}`, { method: 'HEAD' });
    // The dev server's SPA fallback answers 200 with `index.html` for a missing
    // path, so `res.ok` alone cannot tell existence from absence — the same
    // measured false positive `api/project-source.ts`'s `probeProjectFile`
    // records. A real file never answers as an HTML DOCUMENT.
    if (!res.ok) return false;
    return !(res.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
  } catch {
    return false;
  }
}

interface ServerAssetEntry {
  name: string;
  type: 'file' | 'directory';
}

async function hostList(dir: string): Promise<readonly ProjectFileEntry[]> {
  if (!dir.startsWith('public')) {
    throw new Error(
      `projectFiles.list("${dir}"): the standalone editor lists only \`public/**\` ` +
        '(`/__editor/assets`); source trees are listed by glob through ' +
        "`/__editor/source-files` (`api/project-source.ts`'s `listProjectSourceFiles`).",
    );
  }
  const inner = dir === 'public' ? '' : dir.slice('public/'.length);
  const res = await fetch(`${BASE}/assets?${new URLSearchParams({ dir: inner })}`);
  const { entries } = await editorServerJson<{ entries: ServerAssetEntry[] }>(
    res,
    `projectFiles.list "${dir}" failed`,
  );
  return entries.map((entry) => ({
    name: entry.name,
    path: inner ? `public/${inner}/${entry.name}` : `public/${entry.name}`,
    type: entry.type === 'directory' ? ('dir' as const) : ('file' as const),
  }));
}

function hostWatch(listener: (event: ProjectFileEvent) => void): () => void {
  const source = new EventSource(`${BASE}/events`);
  const handler = (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data) as { type?: string; file?: string; path?: string };
      const path = data.path ?? data.file;
      if (!path) return;
      listener({
        type: (data.type as ProjectFileEvent['type']) ?? 'update',
        path: normalize(path),
      });
    } catch {
      // Non-JSON keepalive frame.
    }
  };
  source.addEventListener('message', handler);
  return () => {
    source.removeEventListener('message', handler);
    source.close();
  };
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

export const projectFiles = {
  /** True while the workbench's own file service is answering. A caller with
   *  a transport of its own (the source-write lane) reads this to decide
   *  whether its write would be EXTERNAL to the workbench. */
  frameOwned: filesProviderInstalled,

  async read(path: string): Promise<string> {
    const key = assertContained(path);
    return filesProvider()?.read(key) ?? hostRead(key);
  },

  async readBytes(path: string): Promise<Uint8Array> {
    const key = assertContained(path);
    const provider = filesProvider();
    return provider?.readBytes ? provider.readBytes(key) : hostReadBytes(key);
  },

  async write(path: string, data: string | Uint8Array): Promise<void> {
    const key = assertContained(path);
    const provider = filesProvider();
    if (provider) return provider.write(key, data);
    return hostWrite(key, data);
  },

  async exists(path: string): Promise<boolean> {
    const key = assertContained(path);
    return filesProvider()?.exists(key) ?? hostExists(key);
  },

  async list(dir: string): Promise<readonly ProjectFileEntry[]> {
    const key = assertContainedDir(dir);
    const provider = filesProvider();
    return provider?.list ? provider.list(key) : hostList(key);
  },

  watch(listener: (event: ProjectFileEvent) => void): () => void {
    const provider = filesProvider();
    return provider?.watch ? provider.watch(listener) : hostWatch(listener);
  },
};
