// A `?url` import (Vite's asset import) resolves to a module exporting the file's URL.
export function resolve(specifier, context, next) {
  if (!specifier.endsWith('?url')) return next(specifier, context);
  const { url } = next(specifier.slice(0, -'?url'.length), context);
  return { url: `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(url)};`)}`, shortCircuit: true };
}
