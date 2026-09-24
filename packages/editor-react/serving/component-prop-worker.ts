/**
 * TypeScript declared-prop analysis, isolated from the Vite HTTP thread.
 *
 * `ComponentPropResolver` builds a full ts.Program on its first query. That is
 * deliberately real TypeScript semantic analysis, but it is CPU-bound and
 * takes seconds on a cold project. Running it from `setImmediate` does not
 * make it asynchronous: it still freezes the one Node event loop serving the
 * editor. This worker keeps one incremental resolver per project and returns
 * only the ecosystem-native prop descriptions the OID index already carries.
 *
 * The `.ts` extensions below are LOAD-BEARING, not a style slip. `new
 * Worker(new URL('./server/component-prop-worker.ts', …))` hands this file to
 * Node directly: tsx's resolver hooks do not reach a worker thread, so the
 * module is executed by Node's own type stripping, whose ESM resolver demands
 * an explicit extension. Dropping them resolves under tsc and then dies at
 * runtime with ERR_MODULE_NOT_FOUND the first time the editor asks for
 * declared props. `tsconfig.server.json` sets `allowImportingTsExtensions`
 * for exactly this reason.
 */
import { parentPort } from 'node:worker_threads';
import { ComponentPropResolver } from '../src/source/component-prop-types';
import type { ComponentPropSpec } from '@volter/editor-sdk/source-authoring';

interface PropRequest {
  key: string;
  file: string;
  tag: string;
  /** `file` DEFINES `tag` (a prefab about to be dropped, not yet imported
   *  anywhere) — answer from the definition instead of a callsite. */
  definition?: boolean;
}

interface ResolveMessage {
  id: number;
  projectRoot: string;
  requests: PropRequest[];
}

const resolvers = new Map<string, ComponentPropResolver>();

function resolverFor(projectRoot: string): ComponentPropResolver {
  const existing = resolvers.get(projectRoot);
  if (existing) return existing;
  const resolver = new ComponentPropResolver(projectRoot);
  resolvers.set(projectRoot, resolver);
  return resolver;
}

if (parentPort === null) {
  throw new Error(
    'component-prop-worker is a worker-thread entry point: it must be spawned with `new Worker(...)` and never imported on the main thread.',
  );
}
const port = parentPort;

port.on('message', (message: ResolveMessage) => {
  try {
    const resolver = resolverFor(message.projectRoot);
    const props: Record<string, ComponentPropSpec[]> = {};
    for (const request of message.requests) {
      props[request.key] = request.definition
        ? resolver.propsFor(request.file, request.tag)
        : resolver.propsForTag(request.file, request.tag);
    }
    port.postMessage({ id: message.id, props });
  } catch (error) {
    port.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
