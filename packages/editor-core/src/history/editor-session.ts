import { HistoryCommands } from './history-commands';
import { connectHistoryLimitNotices } from './history-limit-notices';
import { HistoryService, type HistoryServiceOptions } from '@volter/editor-sdk/kit/history/history-service';

/** Owns project-lifetime editor services; disposed when EditorProvider unmounts. */
export class EditorSession {
  readonly history: HistoryService;
  readonly historyCommands: HistoryCommands;
  private readonly releaseLimitNotices: () => void;

  constructor(
    readonly projectIdentity: string,
    historyOptions: HistoryServiceOptions = {},
  ) {
    this.history = new HistoryService(historyOptions);
    this.historyCommands = new HistoryCommands(this.history);
    this.releaseLimitNotices = connectHistoryLimitNotices(this.history);
  }

  dispose(): void {
    this.releaseLimitNotices();
    this.historyCommands.dispose();
    this.history.dispose();
  }
}
