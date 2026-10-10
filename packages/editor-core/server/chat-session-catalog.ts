import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateChatSelection, type ChatSelection } from './frontend-controls';

export interface ManagedChatSession {
  id: string;
  selection: ChatSelection;
  identity: string | null;
  title: string;
  created: number;
  /** The approval mode this chat starts in when no one picked one. Chats created from 0.5.188 on start in
   *  Auto approve (the owner's ask, for NEW chats); a chat saved before has none, so it keeps asking. */
  defaultPermission?: 'ask' | 'autoApprove';
  /** The policy used by this chat's last opened runtime, not a project default. */
  runtimePolicy?: 'default' | 'yolo';
}

/** Durable native-chat identities. Runtime endpoints and credentials are never persisted here. */
export class ChatSessionCatalog {
  readonly sessions = new Map<string, ManagedChatSession>();
  active: string | null = null;
  /** Why the saved catalog could not be read, or `null`. An unreadable catalog is
   *  reported and left untouched on disk; the editor runs with a fresh one in memory. */
  readonly invalid: string | null = null;
  constructor(private readonly file: string) {
    let saved: {active: string | null; sessions: ManagedChatSession[]};
    try { saved = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.invalid = `${file} is not readable JSON: ${(error as Error).message}`;
      return;
    }
    try {
      for (const entry of saved.sessions) {
        if (!/^[a-zA-Z0-9-]+$/.test(entry.id) || (entry.identity !== null && typeof entry.identity !== 'string')) throw new Error('Invalid saved chat session.');
        const { defaultPermission, runtimePolicy, ...rest } = entry;
        this.sessions.set(entry.id, {...rest, selection: validateChatSelection(entry.selection),
          ...(defaultPermission === 'autoApprove' || defaultPermission === 'ask' ? { defaultPermission } : {}),
          ...(runtimePolicy === 'default' || runtimePolicy === 'yolo' ? { runtimePolicy } : {})});
      }
      if (saved.active && !this.sessions.has(saved.active)) throw new Error('Saved active chat is missing.');
      this.active = saved.active;
    } catch (error) {
      this.sessions.clear();
      this.active = null;
      this.invalid = `${file}: ${(error as Error).message}`;
    }
  }
  create(selection: ChatSelection): ManagedChatSession {
    validateChatSelection(selection);
    const entry: ManagedChatSession = {id: randomUUID(), selection: {...selection}, identity: null, title: selection.model || selection.harness, created: Date.now(), defaultPermission: 'autoApprove'};
    this.sessions.set(entry.id, entry);
    this.active = entry.id;
    this.save();
    return entry;
  }
  save(): void {
    if (this.invalid) return;
    mkdirSync(dirname(this.file), {recursive:true});
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({active:this.active, sessions:[...this.sessions.values()]}, null, 2)+'\n', {mode:0o600});
    renameSync(temporary, this.file);
  }
}
