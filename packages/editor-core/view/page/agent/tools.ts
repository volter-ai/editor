/**
 * WHAT THE VIEW'S AGENT CAN DO — its tools, each acting on this page.
 *
 * Files are the page's one set of bytes (`project-store.ts`): a write here is the write the
 * workbench's folder and every `/__editor/*` file route see. Everything else is a command of the
 * editor, run through the page's own relay (`command-relay.ts`) as a terminal runs one against a
 * session.
 *
 * NOT EVERY COMMAND. What the model reads (a file someone imported, a scene's text) can try to
 * steer it, and this page holds a signed-in person's session with the host. So the agent gets a
 * NAMED LIST of verbs ({@link AGENT_COMMANDS}, {@link PLAY_ACTIONS}), and the two that run script
 * in this page are not on it: `document-script` (a function body) and `run-command` (any command
 * of the workbench). A verb not listed is refused by name.
 *
 * Every result is text, bounded: a model call is priced by its size.
 */

import type { SeededProjectStore } from '../project-store';
import type { PageCommandResult } from '../command-relay';

/** One function tool, as the Responses API declares it. */
export interface AgentToolDeclaration {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  readonly parameters: Record<string, unknown>;
}

export interface AgentToolServices {
  readonly store: SeededProjectStore;
  readonly command: (command: Record<string, unknown>) => Promise<PageCommandResult>;
}

/** The most text one tool result carries back to the model. */
const RESULT_LIMIT = 16_000;
const SEARCH_LIMIT = 60;
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|json|css|html?|md|txt|py|svg|ya?ml|toml|glsl|vert|frag)$/i;

const object = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const text = (description: string) => ({ type: 'string', description });

export const AGENT_TOOLS: readonly AgentToolDeclaration[] = [
  {
    type: 'function', name: 'list_files', strict: true,
    description: 'List one folder of the project. Paths are relative to the project root; "" is the root.',
    parameters: object({ dir: text('Folder path, or "" for the project root.') }),
  },
  {
    type: 'function', name: 'read_file', strict: true,
    description: 'Read a text file of the project, with line numbers. Give first_line and last_line to read part of a long file; 0 and 0 read from the start.',
    parameters: object({ path: text('File path.'), first_line: { type: 'integer' }, last_line: { type: 'integer' } }),
  },
  {
    type: 'function', name: 'search_files', strict: true,
    description: 'Find a literal string in the project\'s text files. Answers path:line: text.',
    parameters: object({ query: text('The exact text to find.'), under: text('A folder to search in, or "" for the whole project.') }),
  },
  {
    type: 'function', name: 'write_file', strict: true,
    description: 'Create a text file or replace all of its content.',
    parameters: object({ path: text('File path.'), content: text('The whole file.') }),
  },
  {
    type: 'function', name: 'edit_file', strict: true,
    description: 'Replace one exact passage of a text file. old_text must occur exactly once in the file.',
    parameters: object({ path: text('File path.'), old_text: text('The passage as it is now.'), new_text: text('What replaces it.') }),
  },
  {
    type: 'function', name: 'delete_file', strict: true,
    description: 'Delete a file or folder of the project.',
    parameters: object({ path: text('File or folder path.') }),
  },
  {
    type: 'function', name: 'blender_python', strict: true,
    description: 'Run Python in the Blender that is open in this tab (bpy is available). Answers what the script printed, or its traceback.',
    parameters: object({ code: text('The Python to run.') }),
  },
  {
    type: 'function', name: 'editor_command', strict: true,
    description: 'Run one command of the editor in this tab: any "blender-…" command, or one of open, select, select-multiple, inspect, hierarchy, current-view, document-table, present-view, undo, redo, set-inspection-field, focus-entity, frame-entity, focus-selection, view-preset, set-camera, document-frame, set-shading-mode, model-play-log. arguments_json is a JSON object of the command\'s own fields.',
    parameters: object({ type: text('The command, such as "blender-scene-info" or "open".'), arguments_json: text('A JSON object of the command\'s fields; "{}" for none.') }),
  },
  {
    type: 'function', name: 'play', strict: true,
    description: 'Control Play for the open model\'s game: state, play, stop, pause, resume or restart. Answers the game\'s state.',
    parameters: object({ action: { type: 'string', enum: ['state', 'play', 'stop', 'pause', 'resume', 'restart'] } }),
  },
];

/** The editor's verbs the agent may run, besides Blender's own (`blender-…`). None runs script in the page. */
export const AGENT_COMMANDS: ReadonlySet<string> = new Set([
  'open', 'select', 'select-multiple', 'inspect', 'hierarchy', 'current-view', 'document-table', 'present-view',
  'undo', 'redo', 'set-inspection-field', 'focus-entity', 'frame-entity', 'focus-selection', 'view-preset',
  'set-camera', 'document-frame', 'set-shading-mode', 'model-play-log',
]);
/** Play's controls: `volter.model-play.<action>`, the one family of workbench commands the agent reaches. */
export const PLAY_ACTIONS: ReadonlySet<string> = new Set(['state', 'play', 'stop', 'pause', 'resume', 'restart']);

const agentMayRun = (type: string): boolean => AGENT_COMMANDS.has(type) || /^blender-[a-z-]+$/.test(type);

function bounded(value: string): string {
  return value.length <= RESULT_LIMIT ? value : `${value.slice(0, RESULT_LIMIT)}\n… (${value.length - RESULT_LIMIT} more characters not shown)`;
}

/** A project-relative path the tools may touch: no traversal, no absolute path. */
function projectPath(value: unknown, allowRoot = false): string {
  const path = typeof value === 'string' ? value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '') : '';
  if (path === '' && allowRoot) return '';
  if (path === '' || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`'${String(value)}' is not a path inside the project. Use a path relative to the project root, such as src/ui/game.tsx.`);
  }
  return path;
}

/** A command's answer as the model reads it: its data, without the bulk no reader of text can use. */
function commandText(result: PageCommandResult): string {
  if (!result.ok) return `The editor refused: ${result.error ?? 'no reason given'}`;
  const data = result.data ?? {};
  const single = Object.keys(data).length === 1 && typeof data['result'] === 'string' ? data['result'] : null;
  if (single !== null) return single;
  return JSON.stringify(data, (_key, value: unknown) =>
    typeof value === 'string' && value.length > 4000 ? `(${value.length} characters not shown)` : value, 1);
}

/**
 * Run one tool call. Never throws: what went wrong is the answer, so the model can correct itself.
 */
export async function runAgentTool(services: AgentToolServices, name: string, argumentsJson: string): Promise<string> {
  const { store, command } = services;
  try {
    const args = JSON.parse(argumentsJson || '{}') as Record<string, unknown>;
    switch (name) {
      case 'list_files': {
        const entries = await store.list(projectPath(args['dir'], true));
        return bounded(entries.map((entry) => (entry.type === 'dir' ? `${entry.name}/` : `${entry.name}  (${entry.size ?? 0} bytes)`)).join('\n') || '(empty)');
      }
      case 'read_file': {
        const path = projectPath(args['path']);
        const lines = (await store.read(path)).split('\n');
        const first = Math.max(1, Number(args['first_line']) || 1);
        const last = Math.min(lines.length, Number(args['last_line']) || lines.length);
        const shown = lines.slice(first - 1, last).map((line, index) => `${first + index}\t${line}`).join('\n');
        return bounded(`${path} (lines ${first}-${last} of ${lines.length})\n${shown}`);
      }
      case 'search_files': {
        const query = typeof args['query'] === 'string' ? args['query'] : '';
        if (query === '') return 'Give the text to find.';
        const hits: string[] = [];
        for (const file of await store.allFiles(projectPath(args['under'], true))) {
          if (!TEXT_FILE.test(file.path) || file.size > 512_000 || file.path.split('/').some((segment) => segment === 'node_modules')) continue;
          const lines = (await store.read(file.path)).split('\n');
          for (let index = 0; index < lines.length && hits.length < SEARCH_LIMIT; index++) {
            if (lines[index]!.includes(query)) hits.push(`${file.path}:${index + 1}: ${lines[index]!.trim().slice(0, 200)}`);
          }
          if (hits.length >= SEARCH_LIMIT) break;
        }
        return hits.length === 0 ? `No file contains '${query}'.` : bounded(hits.join('\n'));
      }
      case 'write_file': {
        const path = projectPath(args['path']);
        if (typeof args['content'] !== 'string') return 'Give the whole file as content.';
        await store.write(path, args['content']);
        return `Wrote ${path} (${args['content'].length} characters).`;
      }
      case 'edit_file': {
        const path = projectPath(args['path']);
        const before = await store.read(path);
        const oldText = typeof args['old_text'] === 'string' ? args['old_text'] : '';
        const count = oldText === '' ? 0 : before.split(oldText).length - 1;
        if (count !== 1) return `old_text occurs ${count} times in ${path}; it must occur exactly once. Read the file and give a longer, exact passage.`;
        await store.write(path, before.replace(oldText, () => (typeof args['new_text'] === 'string' ? args['new_text'] : '')));
        return `Edited ${path}.`;
      }
      case 'delete_file': {
        const path = projectPath(args['path']);
        if (!(await store.exists(path))) return `${path} does not exist.`;
        await store.remove(path);
        return `Deleted ${path}.`;
      }
      case 'blender_python':
        return bounded(commandText(await command({ type: 'blender-execute', code: typeof args['code'] === 'string' ? args['code'] : '' })));
      case 'editor_command': {
        const fields = JSON.parse(typeof args['arguments_json'] === 'string' && args['arguments_json'] !== '' ? args['arguments_json'] : '{}') as unknown;
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'arguments_json must be a JSON object.';
        const type = String(args['type']);
        if (!agentMayRun(type)) return `'${type}' is not a command you can run here. Use a "blender-…" command or one of: ${[...AGENT_COMMANDS].join(', ')}.`;
        return bounded(commandText(await command({ ...(fields as Record<string, unknown>), type })));
      }
      case 'play': {
        const action = String(args['action']);
        if (!PLAY_ACTIONS.has(action)) return `Play has no '${action}'. Use one of: ${[...PLAY_ACTIONS].join(', ')}.`;
        // The command id is built here from the fixed list, never taken from the model.
        return bounded(commandText(await command({ type: 'run-command', commandId: `volter.model-play.${action}`, args: {} })));
      }
      default:
        return `There is no tool named ${name}.`;
    }
  } catch (error) {
    return `That did not work: ${error instanceof Error ? error.message : String(error)}`;
  }
}
