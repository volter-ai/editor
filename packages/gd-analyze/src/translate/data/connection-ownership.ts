/** Source-exact record for a PackedScene connection retained without runtime endpoints. */
import type { SignalConnection } from '../../read/godot-types';
import type { TranslationNote } from './model';

/**
 * Preserve an authoring-only connection without asking any native signal backend to implement it.
 * Runtime connection emission remains responsible for proving both endpoints and the signal.
 */
export function noteAuthoringOnlyConnection(
  notes: TranslationNote[],
  sceneResPath: string,
  connection: SignalConnection,
  reason: string,
): void {
  const source = connection.from === '' ? '.' : connection.from;
  notes.push({
    at: `${sceneResPath}#${source}`,
    message:
      `authoring-only signal connection retained from source \`${source}\`, signal ` +
      `\`${connection.signal}\`, to target \`${connection.to}\`, method ` +
      `\`${connection.method}\`: ${reason}. No runtime signal backend or monitor is emitted.`,
  });
}
