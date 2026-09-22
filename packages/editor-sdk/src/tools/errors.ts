import type { z } from 'zod';

/**
 * Core, registry-level error codes — always available regardless of which
 * operation was dispatched. Operation-specific codes are declared per
 * operation on `ToolDefinition.errors` (see `registry.ts`).
 */
export const CORE_ERROR_CODES = {
  /** `dispatch()` was called with a name no operation is registered under. */
  OPERATION_NOT_FOUND: 'OPERATION_NOT_FOUND',
  /** Input failed the operation's Zod input schema. */
  INVALID_INPUT: 'INVALID_INPUT',
  /** The impl's return value failed the operation's Zod result schema, or a
   *  thrown ToolError's `data` failed its declared error-code schema —
   *  either way, an implementation bug, not a caller bug. */
  INVALID_OUTPUT: 'INVALID_OUTPUT',
  /** The impl threw something that isn't a declared, structured error. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type CoreErrorCode = (typeof CORE_ERROR_CODES)[keyof typeof CORE_ERROR_CODES];

/** A single Zod validation failure, reduced to a machine-readable shape. */
export interface StructuredIssue {
  path: (string | number | symbol)[];
  message: string;
  code: string;
}

/**
 * The one error shape every `dispatch()` failure normalizes into. `code` is
 * always machine-readable and always present — nothing in this codebase may
 * identify an operation failure by parsing `message` prose (§8 B1 AC).
 */
export interface StructuredOperationError {
  code: string;
  message: string;
  /** Present for INVALID_INPUT / INVALID_OUTPUT — the exact failing path(s). */
  issues?: StructuredIssue[];
  /** Present when the failing code declares a data schema (or the impl attached data). */
  data?: unknown;
}

/**
 * A global brand keeps expected errors recognizable across separately loaded
 * copies of @vgai/sdk (for example, an editor host dispatching a standalone
 * project's tool). `instanceof` alone cannot cross that package boundary.
 */
export const OPERATION_ERROR_BRAND = Symbol.for('@vgai/sdk.ToolError');

/**
 * The only way an operation `impl` should signal an EXPECTED, contractual
 * failure (as opposed to an unexpected bug/exception). `code` must be one
 * the operation's `ToolDefinition.errors` declares — `dispatch()`
 * cross-checks it and validates `data` against that code's schema, so an
 * undeclared code or mismatched data is itself normalized into a structured
 * error rather than silently forwarded (see `registry.ts`'s
 * `normalizeThrown`).
 */
export class ToolError extends Error {
  readonly [OPERATION_ERROR_BRAND] = true;
  readonly code: string;
  readonly data: unknown;

  constructor(code: string, message: string, data?: unknown) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.data = data;
  }
}

export function isOperationError(value: unknown): value is ToolError {
  if (value instanceof ToolError) return true;
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return (
    candidate[OPERATION_ERROR_BRAND] === true &&
    typeof candidate['code'] === 'string' &&
    typeof candidate['message'] === 'string'
  );
}

/** Reduce a `ZodError`'s issues to the structured, serializable shape above. */
export function toStructuredIssues(issues: readonly z.ZodIssue[]): StructuredIssue[] {
  return issues.map((issue) => ({
    path: [...issue.path],
    message: issue.message,
    code: issue.code,
  }));
}
