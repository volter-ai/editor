import type { z } from 'zod';
import {
  CORE_ERROR_CODES,
  isOperationError,
  type StructuredOperationError,
  toStructuredIssues,
} from './errors.js';
import {
  type ExecutionHost,
  type ExecutionRequirements,
  type PermissionMetadata,
  TOOL_NAMESPACES,
  type ToolContext,
  type ToolNamespace,
} from './types.js';

/** One declared, machine-readable failure mode of an operation (§8 B1: "structured error codes and data schemas"). */
export interface ToolErrorDefinition<TCode extends string = string> {
  code: TCode;
  /** One-line human summary of when this code fires — for docs/help text, never parsed by callers. */
  summary: string;
  /** Optional schema for this code's `data` payload. When present, `dispatch()` validates a thrown ToolError's data against it. */
  data?: z.ZodType;
}

/**
 * One operation, fully self-describing: identity, both schemas, every
 * declared failure mode, where/how it runs, and its own implementation.
 * Built via `defineTool` (below), which validates the name shape and
 * error-code uniqueness at definition time.
 */
export interface ToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TResult extends z.ZodType = z.ZodType,
  TErrorCode extends string = string,
> {
  /** Fully qualified dotted name, e.g. "project.scene.read" (§5.7 namespaces). */
  name: string;
  /** Short, one-line summary (for CLI help / listOperations tables). */
  summary: string;
  /** Longer prose description of behavior, side effects, and caveats. */
  description: string;
  /** Zod schema every `dispatch()` input is validated against before `impl` runs. */
  input: TInput;
  /** Zod schema every `impl` return value is validated against before `dispatch()` succeeds. */
  result: TResult;
  /** Every structured failure mode this operation may raise via `ToolError`. */
  errors: ReadonlyArray<ToolErrorDefinition<TErrorCode>>;
  /** Which live contexts this operation needs (project/editor/play/render). */
  requires: ExecutionRequirements;
  /** Which of the three hosts this operation executes on (node / editor-browser / runtime-page). */
  host: ExecutionHost;
  /** True if this operation writes/changes state (files, editor, runtime). */
  mutates: boolean;
  /** True if this operation supports a dry-run mode (mutations only, meaningful subset). */
  supportsDryRun: boolean;
  /** True for jobs that must not ride a short request/response timeout (e.g. `cinematic.render` on the editor relay). */
  longRunning?: boolean;
  /** Coarse permission/risk metadata for gated callers (agents, HTTP/MCP auth). */
  permission: PermissionMetadata;
  /** The actual implementation. Receives already-schema-validated input. */
  impl: (input: z.infer<TInput>, ctx: ToolContext) => Promise<z.infer<TResult>>;
}

/** `listOperations()`'s element shape — every field of `ToolDefinition` except `impl`, so enumerating never risks invoking anything. */
export type ToolSummary<
  TInput extends z.ZodType = z.ZodType,
  TResult extends z.ZodType = z.ZodType,
  TErrorCode extends string = string,
> = Omit<ToolDefinition<TInput, TResult, TErrorCode>, 'impl'>;

const NAME_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

function namespaceOf(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

/**
 * Typed helper that builds an `ToolDefinition`. Pure and synchronous —
 * it does not touch a registry (so it can never itself throw "duplicate
 * name"; that check happens at `ToolRegistry.register`, which has the
 * cross-operation state to detect it) — but it DOES validate the two things
 * that are decidable from the definition alone: the name is a valid dotted
 * `namespace.rest` string under one of the four operation namespaces
 * (§5.7), and no two declared error codes on the same operation collide.
 *
 * Exists mainly for type inference: it pins `impl`'s parameter/return types
 * to `z.infer<TInput>` / `z.infer<TResult>` so a mismatched implementation
 * fails to compile rather than failing at runtime.
 */
export function defineTool<
  TInput extends z.ZodType,
  TResult extends z.ZodType,
  TErrorCode extends string = string,
>(def: ToolDefinition<TInput, TResult, TErrorCode>): ToolDefinition<TInput, TResult, TErrorCode> {
  if (!NAME_PATTERN.test(def.name)) {
    throw new Error(
      `defineTool: "${def.name}" is not a valid dotted operation name ` +
        '(expected e.g. "project.scene.read" — lowercase-leading segments joined by dots).',
    );
  }
  const ns = namespaceOf(def.name);
  if (!(TOOL_NAMESPACES as readonly string[]).includes(ns)) {
    throw new Error(
      `defineTool: "${def.name}" has unknown namespace "${ns}" — expected one of ` +
        `${TOOL_NAMESPACES.join(', ')} (§5.7).`,
    );
  }
  const seen = new Set<string>();
  for (const err of def.errors) {
    if (seen.has(err.code)) {
      throw new Error(`defineTool: "${def.name}" declares duplicate error code "${err.code}".`);
    }
    seen.add(err.code);
  }
  return def;
}

/** `dispatch()`'s result — a discriminated union, never a thrown exception, so every projection (CLI/HTTP/MCP) gets one uniform JSON-able shape for both success and failure. */
export type ToolOutcome<TResult = unknown> =
  | { ok: true; data: TResult }
  | { ok: false; error: StructuredOperationError };

/**
 * Normalize whatever an `impl` threw into a `StructuredOperationError`.
 * Three cases:
 *  1. A declared `ToolError` whose code IS in `def.errors` and whose
 *     `data` (if the code declares a schema) validates — forwarded as-is,
 *     `data` replaced by its *parsed* form.
 *  2. A declared code whose `data` fails its own schema — that is itself an
 *     implementation bug, surfaced as INVALID_OUTPUT (never silently
 *     forwarding unvalidated data).
 *  3. Anything else — an `ToolError` with an undeclared code, a plain
 *     `Error`, or a non-Error throw — normalized into INTERNAL_ERROR. The
 *     raw exception/message is never used as the identifying `code`, but it
 *     IS carried in `message` as well as `data.message`: every projection
 *     (the CLI's `vgai tool`, the oclif commands, `vgai screenshot`'s module
 *     lane) shows `error.message` and only some of them dump `data`, so a
 *     `message` that said nothing but "threw an unstructured exception"
 *     hid the one sentence the caller needed ("No editor connected — open
 *     the editor in a browser tab, then retry.") behind whichever surface
 *     happened to print the whole outcome.
 */
function normalizeThrown(def: ToolDefinition, err: unknown): StructuredOperationError {
  if (isOperationError(err)) {
    const declared = def.errors.find((e) => e.code === err.code);
    if (!declared) {
      return {
        code: CORE_ERROR_CODES.INTERNAL_ERROR,
        message: `"${def.name}" threw undeclared error code "${err.code}".`,
        data: { undeclaredCode: err.code, message: err.message },
      };
    }
    if (declared.data) {
      const parsed = declared.data.safeParse(err.data);
      if (!parsed.success) {
        return {
          code: CORE_ERROR_CODES.INVALID_OUTPUT,
          message:
            `"${def.name}" threw declared code "${err.code}" but its data failed that ` +
            "code's own schema.",
          issues: toStructuredIssues(parsed.error.issues),
        };
      }
      return { code: err.code, message: err.message, data: parsed.data };
    }
    return {
      code: err.code,
      message: err.message,
      ...(err.data !== undefined ? { data: err.data } : {}),
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    code: CORE_ERROR_CODES.INTERNAL_ERROR,
    message: `"${def.name}" failed: ${message}`,
    data: { message },
  };
}

function toSummary(def: ToolDefinition): ToolSummary {
  const { impl: _impl, ...summary } = def;
  return summary;
}

/**
 * Zod object schemas strip unknown keys by default. That is unsafe at an
 * operation boundary: a misspelled `dryRun` could disappear and let the
 * operation use its write-default. Detect anything parsing removed, at any
 * nested object level, and reject it before the implementation can run.
 */
function firstStrippedInputPath(
  raw: unknown,
  parsed: unknown,
  path: Array<string | number> = [],
): Array<string | number> | null {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    for (let index = 0; index < raw.length; index++) {
      const stripped = firstStrippedInputPath(raw[index], parsed[index], [...path, index]);
      if (stripped) return stripped;
    }
    return null;
  }
  if (
    raw === null ||
    parsed === null ||
    typeof raw !== 'object' ||
    typeof parsed !== 'object' ||
    Array.isArray(raw) ||
    Array.isArray(parsed)
  ) {
    return null;
  }
  const parsedRecord = parsed as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Object.hasOwn(parsedRecord, key)) return [...path, key];
    const stripped = firstStrippedInputPath(value, parsedRecord[key], [...path, key]);
    if (stripped) return stripped;
  }
  return null;
}

/**
 * The one registry of operation definitions (§8 B1). Holds definitions
 * keyed by their fully-qualified name; `register` rejects a duplicate name
 * outright (names are unique and stable per the AC), `listOperations`
 * enumerates metadata without ever touching `impl`, and `dispatch` is the
 * single validated call path: input schema -> impl -> result schema, with
 * every failure normalized into `StructuredOperationError`.
 */
export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  /** Register a definition. Throws synchronously on a duplicate name — names are unique and stable by construction, not by convention. */
  register<TInput extends z.ZodType, TResult extends z.ZodType, TErrorCode extends string>(
    def: ToolDefinition<TInput, TResult, TErrorCode>,
  ): void {
    if (this.definitions.has(def.name)) {
      throw new Error(
        `ToolRegistry.register: "${def.name}" is already registered — operation names ` +
          'must be unique and stable.',
      );
    }
    this.definitions.set(def.name, def as unknown as ToolDefinition);
  }

  /** Enumerate every registered operation's metadata. Never invokes `impl`. */
  listOperations(): ToolSummary[] {
    return [...this.definitions.values()].map(toSummary);
  }

  /** Look up one operation's full definition (including `impl`) by name, or `undefined`. */
  getOperation(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  /**
   * Validate `input` against the named operation's input schema, run its
   * `impl`, validate the return value against its result schema, and return
   * a uniform `ToolOutcome` — success or a `StructuredOperationError`.
   * Never throws for an expected failure (unknown name, bad input, impl
   * throw, bad output); those are exactly what this method exists to turn
   * into a machine-readable result instead of an exception a caller has to
   * parse prose out of.
   */
  async dispatch<TResult = unknown>(
    name: string,
    input: unknown,
    ctx: ToolContext = {},
  ): Promise<ToolOutcome<TResult>> {
    const def = this.definitions.get(name);
    if (!def) {
      return {
        ok: false,
        error: {
          code: CORE_ERROR_CODES.OPERATION_NOT_FOUND,
          message: `No operation is registered as "${name}".`,
          data: { name },
        },
      };
    }

    const parsedInput = def.input.safeParse(input);
    if (!parsedInput.success) {
      return {
        ok: false,
        error: {
          code: CORE_ERROR_CODES.INVALID_INPUT,
          message: `Input for "${name}" failed schema validation.`,
          issues: toStructuredIssues(parsedInput.error.issues),
        },
      };
    }
    const strippedPath = firstStrippedInputPath(input, parsedInput.data);
    if (strippedPath) {
      return {
        ok: false,
        error: {
          code: CORE_ERROR_CODES.INVALID_INPUT,
          message: `Input for "${name}" contains an unknown field.`,
          issues: [
            {
              path: strippedPath,
              message: 'Unknown input field. Check spelling; unknown fields are never ignored.',
              code: 'unrecognized_key',
            },
          ],
        },
      };
    }

    let rawResult: unknown;
    try {
      rawResult = await def.impl(parsedInput.data, ctx);
    } catch (err) {
      return { ok: false, error: normalizeThrown(def, err) };
    }

    const parsedResult = def.result.safeParse(rawResult);
    if (!parsedResult.success) {
      return {
        ok: false,
        error: {
          code: CORE_ERROR_CODES.INVALID_OUTPUT,
          message: `Result of "${name}" failed schema validation (implementation bug).`,
          issues: toStructuredIssues(parsedResult.error.issues),
        },
      };
    }

    return { ok: true, data: parsedResult.data as TResult };
  }
}

export type { ExecutionHost, ExecutionRequirements, ToolContext, ToolNamespace };
