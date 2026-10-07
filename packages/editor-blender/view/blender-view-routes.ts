/**
 * `@volter/editor-blender`'s routes in a LIMITED VIEW (`package.json#volter.viewServing`,
 * `@volter/editor-sdk/session/limited-view`): the same requests the Blender in the tab makes of
 * its session (`serving/blender-routes.ts`), answered in the page against the project's files in
 * memory. The engine's own bytes are not here: they are fixed for a build, so the serving module
 * declares them (`viewSnapshotRoutes`) and the view ships what the session answered.
 *
 * Shapes are the session's. What differs is where bytes go: a `.blend` the document saves, an
 * output Blender writes under `public/`, a transfer the page spools — all stay in this page's
 * memory, readable by the editor and the workbench like any other file, gone on reload.
 */

import type { ViewRoute, ViewServingModule, ViewServingServices } from '@volter/editor-sdk/session/limited-view';

/** The largest chunk a document save sends (`document-chunks.mts`'s cut bound). */
const DOCUMENT_CHUNK_MAX = 4 * 1024 * 1024;

const contained = (path: string): boolean =>
  path !== '' && !path.startsWith('/') && !path.includes('\\') && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

/** The session's rule: a project-relative `.blend`, no dot segment. */
const isDocumentPath = (path: string): boolean =>
  path.endsWith('.blend') && contained(path) && path.split('/').every((segment) => !segment.startsWith('.'));

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesResponse(bytes: Uint8Array): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}

export function viewRoutes(services: ViewServingServices): readonly ViewRoute[] {
  const { files, json } = services;
  /** Transfers the page spools for a requester, by the uuid it minted: read once, then gone. */
  const spool = new Map<string, Uint8Array>();
  /** Chunks of the document save in flight, by path then hash. */
  const held = new Map<string, Map<string, Uint8Array>>();
  const transferId = (value: string | null): string | null => (value !== null && /^[0-9a-f-]{36}$/.test(value) ? value : null);

  return [
    {
      method: 'POST',
      match: /^\/__editor\/blender-file$/,
      handle: async (request, url) => {
        const id = transferId(url.searchParams.get('id'));
        if (id === null) return json({ error: 'blender-file requires a uuid `id`.' }, 400);
        const body = new Uint8Array(await request.arrayBuffer());
        spool.set(id, body);
        return json({ bytes: body.byteLength });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/blender-file$/,
      handle: (_request, url) => {
        const id = transferId(url.searchParams.get('id'));
        if (id === null) return json({ error: 'blender-file requires a uuid `id`.' }, 400);
        const body = spool.get(id);
        if (!body) return json({ error: 'No transfer is spooled under that id.' }, 404);
        spool.delete(id);
        return bytesResponse(body);
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/blender-project-index$/,
      handle: async () => {
        const index: { path: string; size: number; mtime: number }[] = [];
        const walk = async (dir: string): Promise<void> => {
          for (const entry of await files.list(dir)) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            if (entry.type === 'dir') await walk(entry.path);
            else index.push({ path: entry.path, size: entry.size ?? 0, mtime: entry.mtime ?? 0 });
          }
        };
        await walk('');
        return json({ root: services.projectRoot, files: index });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/blender-project-file$/,
      handle: async (_request, url) => {
        const path = url.searchParams.get('path') ?? '';
        const scratchDocument = contained(path) && path.startsWith('.volter/tmp/') && path.endsWith('.blend');
        if (!contained(path) || (path.split('/').some((segment) => segment.startsWith('.')) && !scratchDocument)) {
          return json({ error: 'Not a project-owned path.' }, 400);
        }
        const found = await files.stat(path);
        if (!found || found.type !== 'file') return json({ error: 'Not found.' }, 404);
        return bytesResponse(await files.readBytes(path));
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/blender-output$/,
      handle: async (request, url) => {
        const path = url.searchParams.get('path') ?? '';
        if (!contained(path) || !path.startsWith('public/')) {
          return json({ error: `A shipped output is a project-relative path under public/ with no traversal; got ${JSON.stringify(path)}.` }, 400);
        }
        const body = new Uint8Array(await request.arrayBuffer());
        if (body.byteLength === 0) return json({ error: 'The output body was empty; nothing was written.' }, 400);
        await files.write(path, body);
        // No provenance ledger in a limited view: the output is real, its record is not kept.
        return json({ ok: true, bytes: body.byteLength, provenanceOperationId: null });
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/blender-document-chunk$/,
      handle: async (request, url) => {
        const path = url.searchParams.get('path') ?? '';
        const hash = url.searchParams.get('hash') ?? '';
        if (!isDocumentPath(path) || !/^[0-9a-f]{64}$/.test(hash)) {
          return json({ error: 'A document chunk names its .blend `path` and its SHA-256 `hash` (64 hex digits).' }, 400);
        }
        const body = new Uint8Array(await request.arrayBuffer());
        if (body.byteLength === 0 || body.byteLength > DOCUMENT_CHUNK_MAX) {
          return json({ error: `A document chunk is 1 to ${DOCUMENT_CHUNK_MAX} bytes; got ${body.byteLength}.` }, 400);
        }
        if ((await sha256(body)) !== hash) return json({ error: `The chunk's bytes do not hash to ${hash}; it was not kept.` }, 400);
        let chunks = held.get(path);
        if (!chunks) held.set(path, (chunks = new Map()));
        chunks.set(hash, body);
        return json({ ok: true, bytes: body.byteLength });
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/blender-document$/,
      handle: async (request, url) => {
        const path = url.searchParams.get('path') ?? '';
        if (!isDocumentPath(path)) return json({ error: `A Blender document is a project-relative .blend path; got ${JSON.stringify(path)}.` }, 400);
        let manifest: { chunks?: unknown } | null = null;
        try {
          manifest = (await request.json()) as { chunks?: unknown };
        } catch {
          manifest = null;
        }
        const listed = manifest?.chunks;
        if (
          !Array.isArray(listed) ||
          listed.length === 0 ||
          !listed.every((chunk) => Array.isArray(chunk) && typeof chunk[0] === 'string' && Number.isInteger(chunk[1]) && chunk[1] > 0 && chunk[1] <= DOCUMENT_CHUNK_MAX)
        ) {
          return json({ error: 'A document manifest is `{ chunks: [[sha256, length], ...] }`, at least one chunk.' }, 400);
        }
        // Every chunk is sent on a view's first save: there is no earlier file on a disk to reuse
        // from, only what this page holds.
        const chunks = held.get(path) ?? new Map<string, Uint8Array>();
        const missing = (listed as [string, number][]).filter(([hash, length]) => chunks.get(hash)?.byteLength !== length).map(([hash]) => hash);
        if (missing.length > 0) return json({ ok: false, missing: [...new Set(missing)], ms: {} });
        const total = (listed as [string, number][]).reduce((sum, [, length]) => sum + length, 0);
        const body = new Uint8Array(total);
        let offset = 0;
        for (const [hash, length] of listed as [string, number][]) {
          body.set(chunks.get(hash)!, offset);
          offset += length;
        }
        await files.write(path, body);
        held.delete(path);
        return json({ ok: true, bytes: total, sent: total, revision: null, ms: {} });
      },
    },
  ];
}

const module: ViewServingModule = { viewRoutes };
export default module;
