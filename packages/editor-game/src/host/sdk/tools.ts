/**
 * Public project-tool contract.
 *
 * A tool is an ordinary registered function with a WIRE CONTRACT: declared
 * input/result schemas, structured error codes, and the metadata a caller reads
 * before invoking (`permission`, `host`, `mutates`, `supportsDryRun`). The
 * contract exists because a tool is called across a process boundary — CLI to
 * editor to node host, and `vgai mcp` to an external agent over stdio — where
 * you cannot throw. `ToolRegistry.dispatch` turns every expected failure
 * (unknown name, bad input, an `impl` throw, a bad return) into a typed outcome
 * instead.
 *
 * This module is the surface every consumer imports. It re-exports rather than
 * renames: there is ONE vocabulary, and it is this one.
 */
export { ToolError } from '@volter/editor-sdk/tools/errors';
export {
  defineTool,
  type ToolDefinition,
  type ToolErrorDefinition,
  type ToolOutcome,
  ToolRegistry,
  type ToolSummary,
} from '@volter/editor-sdk/tools/registry';
export type {
  ExecutionHost as ToolHost,
  ExecutionRequirements as ToolRequirements,
  PermissionMetadata as ToolPermission,
  PermissionRisk as ToolPermissionRisk,
  ToolContext,
} from '@volter/editor-sdk/tools/types';
