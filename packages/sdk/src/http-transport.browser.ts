/** Browser fetch owns connections and has no Node header timeout. */
import type { Dispatcher } from 'undici';

export function createDispatcher(_timeoutMs: number): undefined {
  return undefined;
}

export function dispatchFetch(
  url: string,
  init?: RequestInit,
  _dispatcher?: Dispatcher,
): Promise<Response> {
  return fetch(url, init);
}
