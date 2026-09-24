/**
 * Import a module by URL and take the export the adapter's scene table
 * names — with the one refusal sentence both scene-loading surfaces show
 * when the table and the module disagree. Byte-identical copies of this
 * (refusal text included) lived in two components before this home.
 */
export async function takeNamedExport<T>(
  url: string,
  path: string,
  exportName: string | undefined,
): Promise<T> {
  const module_ = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  const name = exportName ?? 'default';
  const Component = module_[name];
  if (typeof Component !== 'function') {
    throw new Error(
      `${path} does not export ${
        exportName === undefined ? 'a default component' : `\`${exportName}\``
      }, which is what the adapter's scene table names. The table and the module disagree.`,
    );
  }
  return Component as T;
}
