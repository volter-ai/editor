/** Project runtime permission policy. Native Settings writes the workspace JSONC file. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';

export type ChatRuntimePolicy = 'default' | 'yolo';

/** Read only this project's choice; a user-wide choice never enables project YOLO. */
export async function projectChatRuntimePolicy(workspace: string): Promise<ChatRuntimePolicy> {
  const file = join(workspace, '.vscode', 'settings.json');
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'default';
    throw new Error(`Could not read Chat runtime policy from ${file}: ${(error as Error).message}`);
  }
  const errors: ParseError[] = [];
  const settings: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`Could not read Chat runtime policy: ${file} is not a valid settings object.`);
  }
  const value = (settings as Record<string, unknown>)['volter.chat.runtimePolicy'];
  if (value === undefined || value === 'default') return 'default';
  if (value === 'yolo') return 'yolo';
  throw new Error(`${file}: volter.chat.runtimePolicy must be default or yolo.`);
}
