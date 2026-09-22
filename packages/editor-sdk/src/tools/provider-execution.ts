import { AsyncLocalStorage } from 'node:async_hooks';
import type { GenerationJobDraft } from '../generations.js';

export type ProviderExecutionMode = 'direct' | 'managed' | 'mock';
export type ProviderModeResolver = (
  provider: string,
  requestId?: string,
) => Promise<ProviderExecutionMode>;

const credentialNames: Record<string, string> = {
  fal: 'FAL_KEY',
  tripo: 'TRIPO_API_KEY',
  worldlabs: 'WORLDLABS_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

// Project SSR and installed packages can load separate module instances.
// The host's async context must still be shared, without sharing requests.
const key = Symbol.for('vgai.provider-execution-context');
const globals = globalThis as typeof globalThis & {
  [key]?: AsyncLocalStorage<{
    resolve: ProviderModeResolver;
    record?: ((job: GenerationJobDraft) => Promise<void>) | undefined;
  }>;
};
const context = globals[key] ?? new AsyncLocalStorage();
globals[key] = context;

/** Trusted host configuration. Provider choice and billing never enter tool input. */
export function withProviderExecution<T>(
  resolve: ProviderModeResolver,
  work: () => Promise<T>,
  record?: (job: GenerationJobDraft) => Promise<void>,
) {
  const pending = new Map<string, Promise<ProviderExecutionMode>>();
  return context.run(
    {
      record,
      resolve: (provider, requestId) => {
        const key = JSON.stringify([provider, requestId]);
        let result = pending.get(key);
        if (!result) {
          result = resolve(provider, requestId);
          pending.set(key, result);
        }
        return result;
      },
    },
    work,
  );
}

/** Native provider clients use the same project ledger as registered tools. */
export async function recordProviderGeneration(job: GenerationJobDraft): Promise<void> {
  await context.getStore()?.record?.(job);
}

/** Library-side connection resolution; callers supply only native provider input. */
export async function resolveProviderMode(
  provider: string,
  requestId?: string,
): Promise<ProviderExecutionMode> {
  const resolve = context.getStore()?.resolve;
  if (resolve) return resolve(provider, requestId);
  const name = credentialNames[provider];
  if (!name) throw new Error(`Unknown generation provider ${JSON.stringify(provider)}.`);
  if (process.env[name]?.trim()) return 'direct';
  if (process.env['VGAI_GENERATION_GATEWAY'] && process.env['VGAI_ACCESS_TOKEN']) return 'managed';
  throw new Error(`Connect ${provider} or sign in to Volter Editor in Account before generating.`);
}
