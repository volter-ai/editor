/**
 * `volter-editor blender-mcp` — the blender-mcp server SHAPE (the published server's 28
 * tools, names, parameters, descriptions, result strings and its one prompt)
 * as pure transport onto Blender running in the project's editor tab.
 *
 * No modeling happens in this process. `execute_blender_code`,
 * `get_scene_info`, `get_object_info` and `get_viewport_screenshot` become
 * `blender-*` control commands answered by the tab's worker
 * (`packages/blender/contributions/blender.command.ts`, the engine's own
 * `workspace.command` contribution); the screenshot is the tab
 * photographing its own Model document. The 24 integration tools answer as
 * an add-on with no integrations, exactly as the Python server did.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { EditorClient, type EditorView } from '@volter/editor-sdk';
import blenderBundle from '@volter/blender-engine/wasm/BUNDLE.json';
import { projectOutputRootOf } from '@volter/editor-sdk/project/output-roots';
import blenderDefaults from './blender-mcp-defaults.json';
import blenderTools from './blender-mcp-tools.json';

interface ToolShape {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const DISABLED = {
  polyhaven:
    'PolyHaven integration is disabled. Select it in the sidebar in BlenderMCP, then run it again.',
  sketchfab:
    'Sketchfab integration is disabled. Select it in the sidebar in BlenderMCP, then run it again.',
  polypizza:
    'Poly Pizza integration is disabled. Select it in the sidebar in BlenderMCP, then run it again.',
  hyper3d:
    'Hyper3D Rodin integration is disabled. Select it in the sidebar in BlenderMCP, then run it again.',
  hunyuan:
    'Hunyuan3D integration is disabled. Select it in the sidebar in BlenderMCP, then run it again.',
};

const STATIC_TOOLS: Record<string, string> = {
  disable_telemetry: 'Data collection is now OFF.',
  get_polyhaven_categories: DISABLED.polyhaven,
  search_polyhaven_assets: DISABLED.polyhaven,
  download_polyhaven_asset: DISABLED.polyhaven,
  set_texture: DISABLED.polyhaven,
  search_sketchfab_models: DISABLED.sketchfab,
  get_sketchfab_model_preview: DISABLED.sketchfab,
  download_sketchfab_model: DISABLED.sketchfab,
  search_polypizza_models: DISABLED.polypizza,
  download_polypizza_model: DISABLED.polypizza,
  generate_hyper3d_model_via_text: DISABLED.hyper3d,
  generate_hyper3d_model_via_images: DISABLED.hyper3d,
  poll_rodin_job_status: DISABLED.hyper3d,
  import_generated_asset: DISABLED.hyper3d,
  generate_hunyuan3d_model: DISABLED.hunyuan,
  poll_hunyuan_job_status: DISABLED.hunyuan,
  import_generated_asset_hunyuan: DISABLED.hunyuan,
  record_trajectory_feedback:
    'Trajectory feedback skipped (telemetry disabled, no consent, or write failed)',
};

const TOOLS_PROMPT = `When creating 3D content in Blender, always start by checking if integrations are available:

0. Before anything, always check the scene from get_scene_info()
1. First use the following tools to verify if the following integrations are enabled:
    - PolyHaven
    - Sketchfab
    - Hyper3D
    - Hunyuan3D
    - Poly Pizza

2. If none of the integrations are enabled, create the objects using Blender's built-in tools with execute_blender_code.

3. When including an object into scene, ALWAYS make sure that the name of the object is meanful.

4. Always check the world_bounding_box for each item so that:
    - Ensure that all objects that should not be clipping are not clipping.
    - Items have right spatial relationship.

5. After giving the tool location/scale/rotation information (via execute_blender_code), verify the new properties by using get_object_info to confirm the changes.
`;

export const BLENDER_MCP_VERSION = '1.2';

interface FileEntry {
  path: string;
  size: number;
  mtime: number;
}

/** A path INSIDE the project, POSIX-spelled, or null when it is outside. */
function projectRelative(project: string, absolute: string): string | null {
  const rel = relative(project, absolute).split(sep).join('/');
  if (rel === '' || rel.startsWith('../')) return null;
  return rel;
}

/**
 * The worker's filesystem is the only place a script's outputs exist; this
 * mirrors them to disk. Roots: the project (a script's `public/models/x.glb`
 * lands in the project) plus any `VGAI_BLENDER_MIRROR_ROOTS` (colon-separated
 * absolute paths — the replay harness names its run directory). Only files
 * whose size or mtime changed since the last mirror are read back, and only
 * files the SESSION owns are listed at all — a project file it merely read
 * belongs to the host and is never written back over it.
 *
 * THIS IS THE DOOR THAT RECORDS, because it is the door a session's bytes
 * enter the project through. MEASURED 2026-09-18: a script's
 * `export_scene.gltf` to `<project>/public/models/lantern.glb` landed here and
 * `.vgai/provenance.json` was never created — the one state
 * `scripts/validate-project-provenance.mjs` calls fatal, and the opposite of
 * the doctrine that a generated artifact enters `public/` through a door that
 * records it atomically. So a file this lands under `public/` is POSTed to the
 * session's `/__editor/blender-output`, which commits the bytes and the ledger
 * rewrite as ONE rollback-safe transaction through the same writer the
 * editor's own bake and acceptance tools use; the record's kind is
 * `project.session.write` and it names the session (see
 * `ProjectProvenanceSessionSchema`).
 *
 * The session process owns the writer and the project's ledger. This
 * transport uses that same session boundary as the other product commands;
 * it never creates a second ledger writer in the MCP process.
 *
 * Everything else the session owns — `.vgai/tmp/*.png`, a `.blend`, a replay
 * harness's run directory outside the project — is mirrored with a plain write
 * and deliberately NOT recorded: the ledger is about what the project SHIPS,
 * and `public/` is what ships.
 */
class Mirror {
  readonly #seen = new Map<string, string>();
  constructor(
    private readonly project: string,
    private readonly roots: string[],
  ) {}

  async sync(tab: TabSession, callId: string | null): Promise<number> {
    let written = 0;
    for (const root of this.roots) {
      const listing = await tab.command<{
        entries: FileEntry[];
        session?: string;
        revision?: number;
        document?: string;
      }>('blender-list-files', { path: root });
      for (const entry of listing.entries) {
        const stamp = `${entry.size}:${entry.mtime}`;
        if (this.#seen.get(entry.path) === stamp) continue;
        const projectPath = projectRelative(this.project, entry.path);
        const shipped =
          projectPath !== null && projectOutputRootOf(projectPath) === 'public'
            ? projectPath
            : null;
        // ANTI-SHIM: an unrecordable shipped file is REFUSED, not written
        // anyway. Landing it unrecorded is the defect this door exists to
        // close, and inventing a session for it would be worse than both.
        if (shipped !== null && (listing.session === undefined || listing.revision === undefined))
          throw new Error(
            `The Blender session wrote ${shipped} but has not named itself — it has presented no ` +
              'frame, so there is no session identity or revision to record the file under, and ' +
              'an unrecorded binary under public/ is what `npm run validate-provenance` calls ' +
              'fatal. Nothing was written for it.',
          );
        // WE mint the transfer id and WE choose where the bytes land; the page
        // only hands over a body. See `/__editor/blender-file`.
        const transferId = randomUUID();
        await tab.command<{ bytes: number }>('blender-read-file', { path: entry.path, transferId });
        const spooled = await fetch(`${await tab.origin()}/__editor/blender-file?id=${transferId}`);
        if (!spooled.ok) throw new Error(`Transfer of ${entry.path} failed: ${spooled.status}`);
        const bytes = Buffer.from(await spooled.arrayBuffer());
        if (shipped === null) {
          // Staged inputs are listed alongside outputs. Rewriting an unchanged
          // adapter triggers project reload during this very MCP request.
          // Only changed bytes should reach the filesystem watcher.
          try {
            if (readFileSync(entry.path).equals(bytes)) {
              this.#seen.set(entry.path, stamp);
              continue;
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          mkdirSync(dirname(entry.path), { recursive: true });
          writeFileSync(entry.path, bytes);
        } else {
          const query = new URLSearchParams({
            path: shipped,
            session: listing.session as string,
            revision: String(listing.revision as number),
            source: 'volter-editor blender-mcp',
            ...(callId === null ? {} : { callId }),
          });
          // WHAT THE BYTES WERE MADE FROM, when the session holds a document:
          // the `.blend` this export came out of. Passed as a repeatable
          // `inputs` param rather than folded into the path, because the
          // server validates each one as a project-relative path of its own.
          if (typeof listing.document === 'string' && listing.document !== '')
            query.append('inputs', listing.document);
          const recorded = await fetch(`${await tab.origin()}/__editor/blender-output?${query}`, {
            method: 'POST',
            body: new Uint8Array(bytes),
          });
          if (!recorded.ok) {
            const detail = await recorded.text().catch(() => '');
            throw new Error(
              `Recording ${shipped} through the session failed: ${recorded.status} ${detail}`,
            );
          }
        }
        this.#seen.set(entry.path, stamp);
        written += 1;
      }
    }
    return written;
  }
}

class TabSession {
  #client: EditorClient | null = null;
  #connecting: Promise<EditorClient> | null = null;
  #origin: string | null = null;
  #port: number | null = null;
  /** A replay starts with a fresh model once; ordinary agent sessions persist. */
  #freshSessionPending = Boolean(process.env['VGAI_BLENDER_FRESH_SESSION']);
  constructor(
    private readonly project: string,
    private readonly ensureEditor: () => Promise<void>,
  ) {}

  async client(): Promise<EditorClient> {
    if (this.#client) return this.#client;
    if (!this.#connecting) {
      this.#connecting = (async () => {
        await this.ensureEditor();
        const { resolveSession } = await import('@volter/editor-live');
        const session = await resolveSession(this.project);
        this.#port = session.port;
        this.#origin = `http://127.0.0.1:${session.port}`;
        this.#client = new EditorClient({ url: this.#origin });
        return this.#client;
      })().finally(() => {
        this.#connecting = null;
      });
    }
    return this.#connecting;
  }

  /** This session's HTTP origin, for the doors that are not commands. */
  async origin(): Promise<string> {
    await this.client();
    return this.#origin as string;
  }

  /** The machine-local port this project's session answers on — the address a
   *  provenance record names so a reader can get back to the tab. */
  async port(): Promise<number> {
    await this.client();
    return this.#port as number;
  }

  /**
   * The Model document open and the session started at this project's path.
   *
   * Asked every call, never remembered: the session lives in the editor tab,
   * so an editor restart ends it while this process keeps running.
   * The editor owns opening the Model document and idempotent startup. A
   * separate status query would put a five-second check before that startup
   * request and introduce a race with an editor restart.
   */
  async started(): Promise<EditorClient> {
    const client = await this.client();
    const fresh = this.#freshSessionPending;
    this.#freshSessionPending = false;
    await client.blender('blender-start', { project: this.project, ...(fresh ? { fresh } : {}) });
    return client;
  }

  async command<T>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
    const client = await this.started();
    return client.blender<T & object>(type as `blender-${string}`, fields);
  }
}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

export async function serveBlenderMcp(
  project: string,
  ensureEditor: () => Promise<void> = async () => {},
): Promise<void> {
  const runtimeIdentity = `Blender ${blenderBundle.blender} (source ${blenderBundle.source}), compiled to WebAssembly and running headless in the editor tab; three.js takes its photographs. Factory bpy.context.scene.render.engine: '${blenderBundle.factoryEngine}'. Documents are .blend. save_as_mainfile records the actual saved path in bpy.data.filepath; open_mainfile reopens it.`;
  const tools = (blenderTools as ToolShape[]).map((tool) =>
    tool.name === 'execute_blender_code'
      ? { ...tool, description: `${runtimeIdentity}\n${tool.description}` }
      : tool,
  );
  const defaults = blenderDefaults as Record<string, string>;
  const mirror = new Mirror(project, [
    project,
    ...(process.env['VGAI_BLENDER_MIRROR_ROOTS'] ?? '')
      .split(':')
      .filter((root) => root.startsWith('/')),
  ]);
  const tab = new TabSession(project, ensureEditor);
  const server = new Server(
    { name: 'BlenderMCP', version: BLENDER_MCP_VERSION },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions: runtimeIdentity,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: 'asset_creation_strategy', description: '' }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== 'asset_creation_strategy')
      throw new Error(`Unknown prompt: ${request.params.name}`);
    return { messages: [{ role: 'user', content: { type: 'text', text: TOOLS_PROMPT } }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    // The transport's own number for THIS call. A file the script writes is
    // recorded under it, so a ledger entry points back at the exact request
    // that produced the bytes.
    const callId = extra.requestId === undefined ? null : String(extra.requestId);
    if (name in STATIC_TOOLS) return text(STATIC_TOOLS[name]!);
    if (name in defaults) return text(defaults[name]!);
    switch (name) {
      case 'get_addon_status':
        return text(
          JSON.stringify(
            {
              addon_version: BLENDER_MCP_VERSION,
              server_version: BLENDER_MCP_VERSION,
              up_to_date: true,
            },
            null,
            2,
          ),
        );
      case 'get_scene_info': {
        const { result } = await tab.command<{ result: string }>('blender-scene-info');
        return text(result);
      }
      case 'get_object_info': {
        const { result } = await tab.command<{ result: string }>('blender-object-info', {
          name: String(args['object_name'] ?? ''),
        });
        return text(result);
      }
      case 'execute_blender_code': {
        const { result } = await tab.command<{ result: string }>('blender-execute', {
          code: String(args['code'] ?? ''),
        });
        await mirror.sync(tab, callId);
        return text(result);
      }
      case 'get_viewport_screenshot': {
        const maxSize = typeof args['max_size'] === 'number' ? args['max_size'] : 1000;
        const answer = await tab.command<{
          document: NonNullable<EditorView['document']>;
          view?: { size: number; position?: number[]; target?: number[] };
          error?: string;
        }>('blender-screenshot-view', { maxSize });
        if (!answer.document) throw new Error('Screenshot failed: Blender supplied no document address');
        if (!answer.view)
          throw new Error(answer.error ?? 'Screenshot failed: No 3D viewport found');
        const { view } = answer;
        const camera =
          view.position && view.target
            ? {
                camera: {
                  position: { x: view.position[0]!, y: view.position[1]!, z: view.position[2]! },
                  target: { x: view.target[0]!, y: view.target[1]!, z: view.target[2]! },
                },
              }
            : { frame: 'document' as const };
        const client = await tab.started();
        const presentation: EditorView = { version: 1, document: answer.document, viewport: camera };
        await client.present(presentation);
        const capture = await client.captureActiveDocument(view.size, presentation);
        return {
          content: [{ type: 'image' as const, data: capture.base64, mimeType: 'image/png' }],
        };
      }
    }
    throw new Error(`Unknown tool: ${name}`);
  });

  await server.connect(new StdioServerTransport());
}
