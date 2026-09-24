/**
 * `@volter/editor-xstate`'s server half: the MACHINE IDENTITY STAMP over the project's served
 * modules and the `/__xstate-source/*` routes that read and write machines in their own source.
 *
 * THE GAME REGISTERS NOTHING (ARCHITECTURE.md rule 4). A module writes idiomatic XState
 * (`createMachine`, `setup().createMachine`, `createActor`, `useMachine`); in the editor's served
 * graph only, each machine it declares is wrapped by `__vgaiMachine(machine, key)`, the same way
 * `@volter/editor-react` stamps JSX with its source identity. The wrapper lets the machine report
 * each actor that starts from it and each transition it takes, to a registry the Machine document
 * reads (`src/live-actors.ts`). A standalone build never passes through this plugin, so the game
 * that ships is exactly the code its author wrote.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProjectServingServices } from '@volter/editor-sdk/session/project-serving';
import type { Plugin } from 'vite';
import { applyMachineEdit } from '../src/machine-edits';
import type { MachineEdit } from '../src/machine-model';
import { findMachineCalls, parseModule, readMachineModule } from '../src/machine-source';
import { LIVE_MODULE_ID, liveModuleSource } from './live-module';

const VIRTUAL_ID = `\0${LIVE_MODULE_ID}`;
const NODE_MODULES = /[\\/]node_modules[\\/]/;
const SCRIPT = /\.[cm]?[jt]sx?$/;

function projectRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

/** Stamp every machine a project module declares with its source identity. */
export function stampMachines(code: string, file: string, relativeFile: string): string | null {
  if (!code.includes('createMachine')) return null;
  const source = parseModule(file, code);
  const calls = findMachineCalls(relativeFile, source);
  if (calls.length === 0) return null;
  let out = code;
  for (const call of [...calls].sort((a, b) => b.call.getStart(source) - a.call.getStart(source))) {
    const start = call.call.getStart(source);
    const end = call.call.getEnd();
    out = `${out.slice(0, start)}__vgaiMachine(${out.slice(start, end)}, ${JSON.stringify(call.key)})${out.slice(end)}`;
  }
  return `import { __vgaiMachine } from ${JSON.stringify(LIVE_MODULE_ID)};\n${out}`;
}

export function xstatePlugin(services: ProjectServingServices): Plugin {
  const projectRoot = (fallback: string): string => services.currentProjectRoot() ?? fallback;
  let serverRoot = process.cwd();
  const isProjectFile = (file: string): boolean => {
    if (NODE_MODULES.test(file) || !SCRIPT.test(file)) return false;
    for (const root of services.projectRoots()) if (file.startsWith(root + sep) || file.startsWith(root + '/')) return true;
    const current = services.currentProjectRoot();
    return current !== undefined && file.startsWith(current + sep);
  };
  return {
    name: 'vgai-xstate',
    enforce: 'pre',
    resolveId(id) {
      return id === LIVE_MODULE_ID ? VIRTUAL_ID : null;
    },
    load(id) {
      return id === VIRTUAL_ID ? liveModuleSource : null;
    },
    transform(code, id) {
      if (id.startsWith('\0')) return null;
      const file = id.split('?')[0] ?? id;
      if (!isProjectFile(file)) return null;
      const stamped = stampMachines(code, file, projectRelative(projectRoot(serverRoot), file));
      return stamped === null ? null : { code: stamped, map: null };
    },
    configureServer(server) {
      serverRoot = server.config.root;
      const root = (): string => projectRoot(serverRoot);
      const json = (res: ServerResponse, body: unknown, status = 200): void => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };
      const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
        const parsed = (req as unknown as { body?: unknown }).body;
        if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString('utf8');
        return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      };
      /** A project-relative module path, refused when it leaves the project. */
      const moduleFile = (value: unknown): { absolute: string; relativeFile: string } => {
        if (typeof value !== 'string' || !value) throw new Error('A machine request names its module as `file`.');
        const projectDir = root();
        const absolute = isAbsolute(value) ? value : resolve(projectDir, value);
        if (!absolute.startsWith(projectDir + sep)) throw new Error(`${value} is not in the project.`);
        if (!existsSync(absolute)) throw new Error(`${value} does not exist.`);
        return { absolute, relativeFile: projectRelative(projectDir, absolute) };
      };
      const read = (absolute: string): string => {
        services.settleSource(absolute);
        return readFileSync(absolute, 'utf8');
      };
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://local');
        if (!url.pathname.startsWith('/__xstate-source/')) return next();
        try {
          if (req.method === 'GET' && url.pathname === '/__xstate-source/module') {
            const { absolute, relativeFile } = moduleFile(url.searchParams.get('file'));
            return json(res, readMachineModule(relativeFile, read(absolute)));
          }
          if (req.method === 'POST' && url.pathname === '/__xstate-source/edit') {
            const body = await readJson(req);
            const { absolute, relativeFile } = moduleFile(body['file']);
            const key = body['key'];
            const edit = body['edit'] as MachineEdit | undefined;
            if (typeof key !== 'string' || !edit || typeof edit !== 'object') throw new Error('An edit names `key` and `edit`.');
            // The same attribution every editor source write carries: the share's authenticated
            // participant wins over a claimed one, and a stale revision is refused.
            const claimed = body['participantId'];
            const trusted = req.headers['x-vgai-share-participant-id'];
            const role = req.headers['x-vgai-share-role'];
            if (typeof trusted === 'string' && typeof claimed === 'string' && trusted !== claimed) {
              throw new Error('The authenticated share participant does not match the source mutation author.');
            }
            if (typeof role === 'string' && role !== 'editor' && role !== 'terminal' && role !== 'maintainer') {
              throw new Error(`The ${role} share role cannot edit source.`);
            }
            const participantId = typeof trusted === 'string' ? trusted : claimed;
            const expectedRevision = body['expectedRevision'];
            if (typeof participantId !== 'string' || !Number.isInteger(expectedRevision)) {
              throw new Error('Source mutations require participantId and expectedRevision.');
            }
            const collaboration = services.collaboration(root());
            collaboration.assertSourceMutation(participantId, expectedRevision as number, [relativeFile]);
            const before = read(absolute);
            const after = applyMachineEdit(relativeFile, before, key, edit);
            if (after !== before) services.writeSource(absolute, after);
            const recorded =
              after === before
                ? null
                : collaboration.recordSourceMutation({
                    authorId: participantId,
                    source: 'editor',
                    resources: [{ path: relativeFile, sha: createHash('sha256').update(after, 'utf8').digest('hex').slice(0, 16) }],
                  });
            return json(res, {
              ok: true,
              changed: after !== before,
              revision: recorded?.revision ?? collaboration.revision(),
              module: readMachineModule(relativeFile, after),
            });
          }
          return json(res, { ok: false, error: `No route ${req.method} ${url.pathname}` }, 404);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return json(res, { ok: false, error: message }, services.isCollaborationConflict(error) ? 409 : 400);
        }
      });
    },
  };
}
