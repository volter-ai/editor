/** Authored properties inherited from Node whose runtime carriers live outside native printers. */
import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

/**
 * Validate Node.unique_name_in_owner without performing its registration.
 *
 * `%Name` ownership and lifecycle are already emitted once by `emit/tree-registration.ts`; native
 * property classifiers call this only so malformed authoring cannot be mistaken for `false`.
 */
export function readUniqueNameInOwner(
  properties: Readonly<Record<string, GodotValue>>,
  at: string,
): boolean | undefined {
  const value = properties['unique_name_in_owner'];
  if (value === undefined) return undefined;
  if (value.kind !== 'bool') {
    throw new TranslateError(`${at}.unique_name_in_owner`, 'Node.unique_name_in_owner must be bool.');
  }
  return value.value;
}
