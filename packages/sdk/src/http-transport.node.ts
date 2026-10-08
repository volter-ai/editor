/** Node session clients need explicit header deadlines for long modeling calls.
 * Some runtimes supply an undici-compatible Agent without destroy(); callers
 * close explicitly when that lifecycle method exists. */
import { Agent, fetch as nodeFetch, type Dispatcher } from 'undici';

export function createDispatcher(timeoutMs: number): Dispatcher {
  return new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
}

export async function dispatchFetch(
  url: string,
  init?: RequestInit,
  dispatcher?: Dispatcher,
): Promise<Response> {
  if (!dispatcher) return fetch(url, init);
  return await nodeFetch(url, {
    ...(init as object), dispatcher,
  }) as unknown as Response;
}
