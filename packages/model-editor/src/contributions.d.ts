declare module 'vgai:contributions/*' {
  const contributions: readonly { readonly entryPath: string; readonly load: () => Promise<unknown> }[];
  export default contributions;
}
