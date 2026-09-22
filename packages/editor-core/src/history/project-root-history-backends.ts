import { bytesToBase64 } from '../bytes-codec';
import { assertEditorServerAnswered } from '../editor-server-response';
import { sourceMutationAttribution } from '../editor-session-attribution';
import { handleProjectMutationFailure } from '../source-conflict';
import type { HistoryFileBackend } from './project-file-history';

/**
 * Split by CONTENT TYPE, both classes below:
 *
 *  - the MUTATING halves (`write`/`remove`) answer JSON — `{ ok, revision }` or
 *    an `{ error }` — and are read through `editor-server-response.ts`, because
 *    `!response.ok` alone let a page fallback report an undo/redo write that
 *    reached nothing as applied;
 *  - the READ halves (`readBytes`/`exists`) answer RAW BYTES, so that reader's
 *    `application/json` rule would reject their successes. They are deliberately
 *    left on the status code; `exists` inherits the fallback's false `true`,
 *    and closing that needs a body-shape discriminator this route does not have.
 */
class ScopedHttpHistoryBackend implements HistoryFileBackend {
  constructor(
    readonly id: string,
    private readonly endpoint: string,
  ) {}

  async readBytes(path: string): Promise<Uint8Array> {
    const response = await fetch(`${this.endpoint}?${new URLSearchParams({ path })}`);
    if (!response.ok) throw new Error(`${this.id}.readBytes '${path}': HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content, ...sourceMutationAttribution() }),
    });
    assertEditorServerAnswered(response, `${this.id} write ${path} failed`);
    if (!response.ok) {
      await handleProjectMutationFailure(response, {
        label: `${this.id} write ${path}`,
        attempted: { [path]: content },
        reapply: () => this.write(path, data),
      });
    }
  }

  async exists(path: string): Promise<boolean> {
    const response = await fetch(`${this.endpoint}?${new URLSearchParams({ path })}`);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`${this.id}.exists '${path}': HTTP ${response.status}`);
    return true;
  }

  async remove(path: string): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, ...sourceMutationAttribution() }),
    });
    assertEditorServerAnswered(response, `${this.id} delete ${path} failed`);
    if (!response.ok) {
      await handleProjectMutationFailure(response, {
        label: `${this.id} delete ${path}`,
        attempted: { [path]: null },
        reapply: () => this.remove(path),
      });
    }
  }
}

const manifestHttp = new ScopedHttpHistoryBackend('project-manifest-http', '/__editor/manifest');

class ProjectResourceHttpHistoryBackend implements HistoryFileBackend {
  readonly id = 'project-resource-http';
  private readonly endpoint = '/__editor/project-resource';

  async readBytes(path: string): Promise<Uint8Array> {
    const response = await fetch(`${this.endpoint}?${new URLSearchParams({ path })}`);
    if (!response.ok) throw new Error(`${this.id}.readBytes '${path}': HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        content: bytesToBase64(bytes),
        encoding: 'base64',
        ...sourceMutationAttribution(),
      }),
    });
    assertEditorServerAnswered(response, `${this.id} write ${path} failed`);
    if (!response.ok) {
      await handleProjectMutationFailure(response, {
        label: `${this.id} write ${path}`,
        attempted: { [path]: `[${bytes.byteLength} bytes]` },
        reapply: () => this.write(path, data),
      });
    }
  }

  async exists(path: string): Promise<boolean> {
    const response = await fetch(`${this.endpoint}?${new URLSearchParams({ path })}`);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`${this.id}.exists '${path}': HTTP ${response.status}`);
    return true;
  }

  async remove(path: string): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, ...sourceMutationAttribution() }),
    });
    assertEditorServerAnswered(response, `${this.id} delete ${path} failed`);
    if (!response.ok) {
      await handleProjectMutationFailure(response, {
        label: `${this.id} delete ${path}`,
        attempted: { [path]: null },
        reapply: () => this.remove(path),
      });
    }
  }
}

const projectResourceHttp = new ProjectResourceHttpHistoryBackend();

export function getManifestHistoryBackend(): HistoryFileBackend {
  return manifestHttp;
}

/** Exact project-root bytes for project-owned Asset Lab documents. */
export function getProjectResourceHistoryBackend(): HistoryFileBackend {
  return projectResourceHttp;
}
