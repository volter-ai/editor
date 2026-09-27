declare module 'virtual:volter-manifest-entries' {
  export const manifestEntryModules: Readonly<Record<string, unknown>>;
  /** `src/canvas-mount.ts`'s mount when the manifest declares a `canvas` root, else `undefined`. */
  export const mountCanvasRoot:
    | ((
        layer: HTMLElement,
        Entry: import('react').ComponentType,
        options: {
          readonly bottom: boolean;
          readonly onHitTest: (canvas: HTMLCanvasElement, hit: (x: number, y: number) => boolean) => void;
        },
      ) => void)
    | undefined;
}
