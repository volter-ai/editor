/**
 * The live objects behind the hierarchy's node ids (`host.hierarchy.object/objects`), as a media
 * integration provides them: the Three integration answers from the session store's Three half.
 * The kit forwards what is registered and imports no viewport; with none registered there are no
 * objects.
 */
import type { EditorHostHierarchy } from '../host';

export type HostHierarchyObjects = Pick<EditorHostHierarchy, 'object' | 'objects'>;

let registered: HostHierarchyObjects | null = null;

export function registerHostHierarchyObjects(provider: HostHierarchyObjects): () => void {
  registered = provider;
  return () => {
    if (registered === provider) registered = null;
  };
}

export function hostHierarchyObjects(): HostHierarchyObjects | null {
  return registered;
}
