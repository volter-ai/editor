/** Registered project tools over the current shared editor session. */

import type {
  EditorClient,
  ProjectToolCatalog,
  ProjectToolCatalogEntry,
  ProjectToolOutcome,
} from '@volter/editor-sdk';

export class LiveTools {
  /** `#`-private for the same reason `LiveEditor.#client` is. */
  readonly #client: EditorClient;

  constructor(client: EditorClient) {
    this.#client = client;
  }

  /** Enumerate the exact `package.json#vgai.tools` catalog without executing it. */
  async list(): Promise<ProjectToolCatalog> {
    return this.#client.listProjectTools();
  }

  /** Return one tool's discoverable metadata, or `null` when it is not registered. */
  async describe(name: string): Promise<ProjectToolCatalogEntry | null> {
    const catalog = await this.list();
    return catalog.tools.find((tool) => tool.name === name) ?? null;
  }

  /**
   * Invoke the same validated callable used by the editor and CLI.
   *
   * `instance` names WHICH mounted instance the tool should drive when several
   * are live (multiplayer authoring) — it reaches the tool as `ctx.instance`,
   * and a tool that drives the game binds
   * `game.instance(ctx.instance)` from it. Omitted is the single-instance case;
   * the tool then targets the sole live instance, exactly as before.
   */
  async run(
    name: string,
    input: unknown = {},
    options: { confirm?: boolean; instance?: string } = {},
  ): Promise<ProjectToolOutcome> {
    return this.#client.runProjectTool(name, input, options);
  }
}
