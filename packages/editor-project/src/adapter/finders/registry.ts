/**
 * THE FINDER REGISTRY — the open set of finders an adapter may SELECT by
 * name (ARCHITECTURE-CORE §The editor protocol, "Documents, not scenes").
 *
 * A finder is a pure function from the project's gathered source to document
 * entries, plus the Zod schema of its own parameters. The engine registers
 * its two here (`./index.ts`); a contribution registers more through the
 * same door. `adapter-module.ts` validates only the selection ENVELOPE; the
 * parameters are checked against the finder's schema when the loader runs
 * it — an unregistered name or a bad parameter refuses loudly, naming both.
 */

import type { ZodType } from 'zod';
import type { FinderSelection } from '../adapter-module';
import type { FinderResult } from './finder-result';

/** What a registration's selection type must carry: the name. A finder's own
 *  params interface satisfies this without an index signature. */
export type FinderSelectionEnvelope = { readonly finder: string };

export interface FinderRegistration<
  S extends FinderSelectionEnvelope = FinderSelection,
  I = unknown,
> {
  readonly name: S['finder'];
  /** The selection's full shape, `finder` included; `.strict()` by the
   *  same rule as every other adapter table. */
  readonly schema: ZodType<S>;
  readonly run: (selection: S, input: I) => FinderResult;
}

const registry = new Map<string, FinderRegistration>();

/** Register a finder. A second registration under one name replaces the
 *  first (a module re-evaluated on save), never throws. */
export function registerFinder<S extends FinderSelectionEnvelope, I>(
  registration: FinderRegistration<S, I>,
): () => void {
  const entry = registration as unknown as FinderRegistration;
  registry.set(registration.name, entry);
  return () => {
    if (registry.get(registration.name) === entry) registry.delete(registration.name);
  };
}

/**
 * What a CONTRIBUTION exports to register a finder (ARCHITECTURE-CORE §The
 * project model): a plain object a project module `src/contributions/<name>.finder.ts`
 * exports as `finder`, handed by the HOST to {@link registerContributedFinder}.
 * A selection may carry `include` globs; the host then supplies the matching
 * project sources on `input.sources`, which is how a finder reads the
 * project without a file system.
 */
export type FinderContribution = FinderRegistration<FinderSelection, unknown>;

/** Register a contribution's finder after checking its shape by name. */
export function registerContributedFinder(value: unknown, source: string): () => void {
  const record = (value ?? {}) as Partial<FinderContribution>;
  const problems: string[] = [];
  if (typeof record.name !== 'string' || record.name.length === 0)
    problems.push('`name` must be a non-empty string');
  const schema = record.schema as { safeParse?: unknown } | undefined;
  if (!schema || typeof schema.safeParse !== 'function')
    problems.push('`schema` must be a Zod schema');
  if (typeof record.run !== 'function') problems.push('`run(selection, input)` must be a function');
  if (problems.length > 0) throw new Error(`${source}: not a finder — ${problems.join('; ')}`);
  return registerFinder(record as FinderContribution);
}

/** Every registered finder name, in registration order. */
export function registeredFinderNames(): readonly string[] {
  return [...registry.keys()];
}

/** Validate a selection against its finder's schema and run it. */
export function runRegisteredFinder<I>(selection: FinderSelection, input: I): FinderResult {
  const registration = registry.get(selection.finder);
  if (!registration) {
    const known = registeredFinderNames();
    throw new Error(
      `Unknown finder ${JSON.stringify(selection.finder)} — registered: ${
        known.length > 0 ? known.map((n) => `"${n}"`).join(', ') : 'none'
      }`,
    );
  }
  const parsed = registration.schema.safeParse(selection);
  if (!parsed.success) {
    throw new Error(
      `Finder ${JSON.stringify(selection.finder)}: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(selection)'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return registration.run(parsed.data, input);
}
