/**
 * Hierarchy child-cap constants.
 *
 * The hierarchy panel flattens the ADAPTER's `EditorNode` tree through
 * `hierarchy-node-rows.ts`. This module holds only the two row-cap
 * constants, shared with that flattener so every consumer caps identically.
 */

/** Max children shown per parent before a "… N more" row (when capping is on). */
export const CHILD_CAP = 20;
export const MORE_ID_PREFIX = '__more__:';
