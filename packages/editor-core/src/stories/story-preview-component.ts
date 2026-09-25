import type * as React from 'react';

/** A story's component as a preview mounts it: a React component, with the lazy loader a
 *  portable story carries. */
export type StoryPreviewComponent = React.ComponentType<Record<string, unknown>> & {
  load?: () => Promise<unknown>;
};
