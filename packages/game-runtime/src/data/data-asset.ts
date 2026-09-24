/**
 * Data assets — W1 (§2.3 consumption API).
 *
 * A data asset is designer-tunable game data: a JSON file in the project's
 * `src/data/`, governed by a Zod schema (`*.schema.ts`, engineer-owned) whose
 * emitted JSON Schema (`*.schema.json`, see {@link toDataJsonSchema}) gives
 * VS Code validation via the data file's `"$schema"` first line. Data assets
 * are immutable at runtime — definitions, not state (§2.1).
 *
 * The blessed consumption shape, scaffolded working-at-birth by the project
 * template (`src/data/` there is the worked example — §6.2):
 *
 * ```ts
 * import raw from './tuning.data.json';
 * import { TuningSchema } from './tuning.schema';
 * import { defineData } from './data-asset';
 *
 * export const tuning = defineData(TuningSchema, raw, 'src/data/tuning.data.json');
 * // Vite HMR needs the literal dep path in THIS module (static analysis) —
 * // this one line is the entire live-tuning wiring (['default'] not .default:
 * // strict tsconfigs index-signature ModuleNamespace):
 * import.meta.hot?.accept('./tuning.data.json', (m) => tuning.hotSwap(m?.['default']));
 * ```
 *
 * Game code reads `tuning.get()` inside its update loop (never cache fields
 * across frames) or `subscribe()`s; an edit to the `.data.json` — from
 * VS Code, an agent, or the future editor Data tab (W2) — flows through Vite
 * HMR into the running game with no remount. React roots/tools get a
 * `useData` hook with W3's tool-hooks package (deferred with it: the engine
 * core stays React-free).
 */

import { z } from 'zod';

/**
 * A live handle to one data asset (§2.3). `get`/`subscribe` are the whole
 * runtime surface; `hotSwap` exists only for the owning module's
 * `import.meta.hot.accept` callback.
 */
export interface DataHandle<T> {
  /** Current parsed values. Read every frame — HMR swaps them under you. */
  get(): T;
  /**
   * Called with the new value after every successful hot swap (NOT with the
   * initial value). Returns an unsubscribe function.
   */
  subscribe(fn: (value: T) => void): () => void;
  /**
   * HMR entry point — call from the owning module's
   * `import.meta.hot.accept('<file>.data.json', (m) => handle.hotSwap(m?.default))`.
   * Parses like load, but a FAILING edit keeps the last good value and
   * `console.error`s instead of throwing: a typo mid-live-tune must not
   * crash the running game. Fix the file and save again.
   */
  hotSwap(next: unknown): void;
  /**
   * The project-relative path this handle was defined with (`defineData`'s
   * own `sourcePath` argument, populated automatically below) — OPTIONAL so
   * any hand-rolled structural implementer stays valid. `getRef`
   * (`./data-ref.ts`) reads this to catch a `getRef(wrongHandle, "stem#key")`
   * mismatch with a teaching error instead of silently resolving against the
   * wrong asset; without it, `getRef` just skips that one check.
   */
  readonly sourcePath?: string;
}

/**
 * Define a data asset from its Zod schema, the statically imported JSON, and
 * its project-relative path (used verbatim in error messages, so pass the
 * real one). Parse-on-load: an invalid file fails loud at import time, naming
 * the file, every bad path, and the fix (§2.3, §6.5 "errors teach").
 *
 * Schema fields should carry `.min/.max/.default/.describe` — the same
 * annotations every authored schema uses — so the emitted JSON Schema
 * documents the file and (W2+) the editor renders real widgets.
 */
export function defineData<S extends z.ZodType>(
  schema: S,
  initial: unknown,
  sourcePath: string,
): DataHandle<z.output<S>> {
  let current = parseDataJson(schema, initial, sourcePath);
  const subscribers = new Set<(value: z.output<S>) => void>();
  return {
    get: () => current,
    sourcePath,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    hotSwap(next) {
      let parsed: z.output<S>;
      try {
        parsed = parseDataJson(schema, next, sourcePath);
      } catch (err) {
        // Keep the last good value alive — see the JSDoc on DataHandle.hotSwap.
        // biome-ignore lint/suspicious/noConsole: deliberate, greppable — a rejected live-tune edit must be loud without crashing the running game
        console.error(`[data] hot edit rejected, keeping previous values.\n${String(err)}`);
        return;
      }
      current = parsed;
      for (const fn of subscribers) fn(current);
    },
  };
}

/**
 * Emit the JSON Schema interchange artifact for a data asset's Zod schema
 * (§2.1: `*.schema.json` is EMITTED, never hand-written; D4: generated and
 * committed by default so VS Code works with no dev server running).
 *
 * Wraps `z.toJSONSchema` with `io: 'input'` — the one non-obvious knob:
 * defaulted fields must be OPTIONAL in the file schema (a data file may omit
 * them), whereas the default output mode would mark every field `required`
 * and make VS Code reject valid files. The template's root `emit-schemas.ts`
 * is the blessed caller (`npm run emit-schemas`).
 *
 * The emitted root schema also explicitly ALLOWS the `"$schema"` string
 * property, mirroring the parse-side strip below: without it, a TABLE
 * asset's emitted schema (`z.record` → `additionalProperties: <rowSchema>`)
 * makes VS Code flag the data file's own `"$schema"` line as an invalid row.
 */
export function toDataJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const emitted = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  if (emitted['type'] === 'object') {
    const properties = (emitted['properties'] ?? {}) as Record<string, unknown>;
    properties['$schema'] ??= { type: 'string' };
    emitted['properties'] = properties;
  }
  return emitted;
}

/**
 * Parse a raw `.data.json` payload: strips the `"$schema"` interchange line,
 * validates through the Zod schema, throws the teaching error on failure.
 * `defineData` uses this internally on load and hot swap; it is exported for
 * emit/doctor-style scripts (the template's `emit-schemas.ts` validates every
 * data file through it, so file validation and runtime validation can never
 * disagree).
 */
export function parseDataJson<S extends z.ZodType>(
  schema: S,
  data: unknown,
  sourcePath: string,
): z.output<S> {
  // Strip the data file's `"$schema"` interchange line before validating —
  // singleton (z.object, strip-mode) schemas ignored it by luck, but a TABLE
  // asset (z.record) would try to validate it as a row and fail.
  const payload =
    data !== null && typeof data === 'object' && !Array.isArray(data) && '$schema' in data
      ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== '$schema'))
      : data;
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Data asset "${sourcePath}" failed its schema:\n${issues}\n` +
        `Fix the JSON to match the Zod schema (its emitted twin, ` +
        `"${sourcePath.replace(/\.data\.json$/, '.schema.json')}", documents every field — ` +
        `re-emit with \`npm run emit-schemas\` if the schema changed). ` +
        `Worked example: the template's src/data/.`,
    );
  }
  return result.data;
}
