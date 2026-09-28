/**
 * The import's check of the game itself (docs/GODOT.md §The lane's law, row 5): whatever compat
 * grows into, the emitted game may not be written against a framework. The game's own files (every
 * emitted file outside the copied `src/lib/`) may not import compat's framework (its main loop,
 * startup or spawn host), and the world module exports only its component.
 *
 * `KNOWN` lists the violations the emitted game still carries while the lane conforms; the
 * architecture ratchet (`scripts/check-godot-architecture.mjs`) lets the list only shrink, and an
 * import that emits anything beyond it refuses.
 */
import type { GodotOutputArtifact } from './emit';

/** Compat exports that run Godot's machinery for the game: never imported by the game itself. */
const FRAMEWORK = ['GodotMain', 'GodotProjectStartup', 'GodotSpawnHost', 'godot_main_iteration'] as const;

const KNOWN: readonly string[] = [];

const decoder = new TextDecoder();

/** Each violation as `framework-import <name>` or `world-export <name>`, once per kind and name. */
export function godotOutputViolations(artifacts: readonly GodotOutputArtifact[]): readonly string[] {
  const found = new Set<string>();
  for (const artifact of artifacts) {
    if (!/^src\/.*\.(ts|tsx)$/u.test(artifact.path) || artifact.path.startsWith('src/lib/')) continue;
    const text = decoder.decode(artifact.bytes);
    for (const match of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*lib\/godot-compat\/[^"']*["']/gu)) {
      for (const name of (match[1] ?? '').split(',').map((part) => part.trim().split(/\s+as\s+/u)[0]?.trim() ?? '')) {
        if ((FRAMEWORK as readonly string[]).includes(name)) found.add(`framework-import ${name}`);
      }
    }
    if (artifact.path === 'src/world.tsx') {
      for (const match of text.matchAll(/^export\s+(?!default\b)(?:const|let|var|function|class)\s+(\w+)/gmu)) {
        found.add(`world-export ${match[1] ?? ''}`);
      }
    }
  }
  return [...found].sort();
}

/** Refuse an emitted game that is written against compat's framework beyond what `KNOWN` allows. */
export function assertGodotOutputConformance(artifacts: readonly GodotOutputArtifact[]): void {
  const beyond = godotOutputViolations(artifacts).filter((violation) => !KNOWN.includes(violation));
  if (beyond.length > 0) {
    throw new Error(
      `the emitted game is written against compat's framework (docs/GODOT.md §The lane's law, row 5):\n  ${beyond.join('\n  ')}`,
    );
  }
}
