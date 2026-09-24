/**
 * A mounted portable story, retained until its owner AND every viewport
 * borrower has finished with it.
 *
 * It lives beside `story-three-preview.ts` — the module that mounts and
 * disposes the `MountedStoryObject3D` it wraps — rather than inside any one
 * document, because TWO documents own a mount on these terms: the isolation
 * SCENE document (`components/scene-documents.tsx`) and the per-story 3D
 * document. A document that opens a mounted story is a contribution; the
 * retain/release physics of the mount underneath it is the host's, the same
 * way `story-three-preview.ts` and the story registry are.
 *
 * See `story-three-preview.ts`'s header for the measured black-panel defect a
 * SECOND owner of one mount produces: `build()` hands out a borrow whose
 * `dispose()` returns it, and the underlying Object3D is disposed only once
 * the owner has retired AND no borrow is outstanding.
 */

import { disposeStoryObject3D, type MountedStoryObject3D } from '@volter/editor-core/stories/story-three-preview';

export interface MountedStoryViewportSource {
  readonly build: () => {
    root: MountedStoryObject3D['root'];
    hierarchyRoots: readonly MountedStoryObject3D['root'][];
    update: (deltaSeconds: number) => void;
    dispose: () => void;
  };
  readonly dispose: () => void;
}

export function mountedStoryViewportSource(
  mounted: MountedStoryObject3D,
): MountedStoryViewportSource {
  let retired = false;
  let released = false;
  let borrowers = 0;
  const release = () => {
    if (!retired || borrowers !== 0 || released) return;
    released = true;
    void disposeStoryObject3D(mounted);
  };
  return {
    build: () => {
      if (released) throw new Error('This story source has already been released.');
      borrowers++;
      let returned = false;
      return {
        root: mounted.root,
        hierarchyRoots: [...mounted.root.children],
        update: (deltaSeconds) => mounted.advance(deltaSeconds),
        dispose: () => {
          if (returned) return;
          returned = true;
          borrowers--;
          release();
        },
      };
    },
    dispose: () => {
      retired = true;
      release();
    },
  };
}
