/** A project path as the session serves it: rooted at `/`, while an absolute,
 *  `http(s):`, `data:` or `blob:` address is already one. */
export function servedUrl(path: string): string {
  return /^(\/|https?:|data:|blob:)/.test(path) ? path : `/${path}`;
}
