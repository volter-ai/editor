declare module 'volter:contributions/*' {
  const contributions: readonly { readonly entryPath: string; readonly load: () => Promise<unknown> }[];
  export default contributions;
}
