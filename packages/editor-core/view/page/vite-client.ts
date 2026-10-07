/**
 * `/@vite/client` IN A LIMITED VIEW — the module every compiled project module that uses
 * `import.meta.hot`, and every compiled stylesheet, imports.
 *
 * A session's Vite client connects to its HMR socket and applies updates. A limited view's modules
 * were compiled once (`view build`), there is no server to connect to and nothing will ever be
 * updated, so this answers the same exports with what that means: a hot context whose handlers
 * never fire, and the two style functions a compiled `.css` module calls, which simply put the
 * stylesheet in the document. Served at `/@vite/client` from `__view/routes.json`.
 */

const sheets = new Map<string, HTMLStyleElement>();

export function updateStyle(id: string, content: string): void {
  let style = sheets.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
    sheets.set(id, style);
  }
  style.textContent = content;
}

export function removeStyle(id: string): void {
  sheets.get(id)?.remove();
  sheets.delete(id);
}

export function injectQuery(url: string, queryToInject: string): string {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const [path, rest = ''] = url.split(/(?=[?#])/);
  const [search = '', hash = ''] = rest.split('#');
  return `${path}?${queryToInject}${search ? `&${search.replace(/^\?/, '')}` : ''}${hash ? `#${hash}` : ''}`;
}

export class ErrorOverlay {
  constructor(_error: unknown) {}
  close(): void {}
}

/** A hot context for a module nothing will ever update. */
export function createHotContext(_ownerPath: string) {
  const data: Record<string, unknown> = {};
  return {
    data,
    accept(): void {},
    acceptExports(): void {},
    dispose(): void {},
    prune(): void {},
    decline(): void {},
    invalidate(): void {},
    on(): void {},
    off(): void {},
    send(): void {},
  };
}
