/**
 * THE PROJECT'S OWN MCP SERVERS, handed to the runtime the session starts.
 *
 * Every scaffolded project ships `.mcp.json` naming its own two servers — `vgai` and
 * `blender` — and that file is how a person's Claude Code, run by hand in the project,
 * reaches them. The AI IN THE TAB is the same agent (ARCHITECTURE-CORE §The core is
 * Code-OSS, rule 7) and must reach the same servers.
 *
 * WHY IT CANNOT BE LEFT TO DISCOVERY, measured 2026-09-21 on a freshly scaffolded model
 * project: Claude Code records per-project approval of a `.mcp.json` in `~/.claude.json`
 * (`enabledMcpjsonServers`), and a project the person has never opened by hand has no
 * entry — so a PROJECT-scoped server is not loaded. The runtime the session starts is
 * `claude --print …`, which has no trust dialog to answer, so discovery can never turn
 * into approval there. A freshly created project's agent would simply have no `blender`
 * tool, silently.
 *
 * THE DOOR IS SUPERCODE'S AND ALREADY EXISTS: `RuntimeStartParams.mcp_servers`. Supercode's
 * Claude backend writes them to a file and passes `--mcp-config <file>`
 * (`crates/harness/src/runtime/adapters.rs`), which is an EXPLICIT caller-supplied config
 * and therefore not subject to the project-approval gate at all. This module is only the
 * read: the project's declaration, in the SDK's shape.
 *
 * IT IS NOT A SECOND DECLARATION. `.mcp.json` stays the one place a project names its
 * servers; nothing here invents, defaults or merges one, and a project without the file
 * hands over nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `RuntimeStartParams.mcp_servers`'s element, structurally — the SDK is an optional peer. */
export interface ProjectMcpServer {
  readonly name: string;
  readonly command: string;
  readonly arguments?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * The project's `.mcp.json`, as the SDK's `mcp_servers`. Empty for a project that declares
 * none, and empty rather than thrown for a malformed one: a broken `.mcp.json` is the dev
 * server's to report against the file, and failing the whole runtime start over it would
 * cost the person their agent to say so.
 *
 * Only the STDIO shape is carried, because that is the shape the harnesses take as a
 * launch: an entry with no string `command` is skipped rather than guessed at.
 */
export function projectMcpServers(projectRoot: string): ProjectMcpServer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
  } catch {
    return [];
  }
  const declared = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) return [];
  const servers: ProjectMcpServer[] = [];
  for (const [name, value] of Object.entries(declared as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue;
    const entry = value as { command?: unknown; args?: unknown; env?: unknown };
    if (typeof entry.command !== 'string' || entry.command === '') continue;
    const args = Array.isArray(entry.args)
      ? entry.args.filter((argument): argument is string => typeof argument === 'string')
      : undefined;
    const env = stringRecord(entry.env);
    servers.push({
      name,
      command: entry.command,
      ...(args && args.length > 0 ? { arguments: args } : {}),
      ...(env ? { env } : {}),
    });
  }
  return servers;
}
