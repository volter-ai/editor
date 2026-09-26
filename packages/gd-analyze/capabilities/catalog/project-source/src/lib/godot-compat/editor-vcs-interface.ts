export const GODOT_VCS_CHANGE_TYPE_NEW = 0;
export const GODOT_VCS_CHANGE_TYPE_MODIFIED = 1;
export const GODOT_VCS_CHANGE_TYPE_RENAMED = 2;
export const GODOT_VCS_CHANGE_TYPE_DELETED = 3;
export const GODOT_VCS_CHANGE_TYPE_TYPECHANGE = 4;
export const GODOT_VCS_CHANGE_TYPE_UNMERGED = 5;
export const GODOT_VCS_TREE_AREA_COMMIT = 0;
export const GODOT_VCS_TREE_AREA_STAGED = 1;
export const GODOT_VCS_TREE_AREA_UNSTAGED = 2;

export interface GodotVCSCarrier {
  invoke(method: string, args: readonly unknown[]): unknown;
}

export interface GodotVCSDiffLine {
  new_line_no: number;
  old_line_no: number;
  content: string;
  status: string;
}

export interface GodotVCSDiffHunk {
  old_start: number;
  new_start: number;
  old_lines: number;
  new_lines: number;
  diff_lines: GodotVCSDiffLine[];
}

export interface GodotVCSDiffFile {
  new_file: string;
  old_file: string;
  diff_hunks: GodotVCSDiffHunk[];
}

export interface GodotVCSCommit {
  message: string;
  author: string;
  id: string;
  unix_timestamp: number;
  offset_minutes: number;
}

export interface GodotVCSStatusFile {
  file_path: string;
  change_type: number;
  area: number;
}

export class GodotEditorVCSInterface {
  private readonly errors: string[] = [];

  constructor(private readonly carrier: GodotVCSCarrier) {}

  private call(method: string, args: readonly unknown[] = []): unknown {
    return this.carrier.invoke(method, args);
  }

  _initialize(projectPath: string): unknown { return this.call('_initialize', [projectPath]); }
  _set_credentials(username: string, password: string, sshPublicKeyPath: string, sshPrivateKeyPath: string, sshPassphrase: string): unknown {
    return this.call('_set_credentials', [username, password, sshPublicKeyPath, sshPrivateKeyPath, sshPassphrase]);
  }
  _get_modified_files_data(): unknown { return this.call('_get_modified_files_data'); }
  _stage_file(filePath: string): unknown { return this.call('_stage_file', [filePath]); }
  _unstage_file(filePath: string): unknown { return this.call('_unstage_file', [filePath]); }
  _discard_file(filePath: string): unknown { return this.call('_discard_file', [filePath]); }
  _commit(message: string, amend: boolean): unknown { return this.call('_commit', [message, amend]); }
  _allow_amends(): unknown { return this.call('_allow_amends'); }
  _get_diff(identifier: string, area: number): unknown { return this.call('_get_diff', [identifier, area]); }
  _shut_down(): unknown { return this.call('_shut_down'); }
  _get_vcs_name(): unknown { return this.call('_get_vcs_name'); }
  _get_previous_commits(maxCommits: number): unknown { return this.call('_get_previous_commits', [maxCommits]); }
  _get_branch_list(): unknown { return this.call('_get_branch_list'); }
  _get_remotes(): unknown { return this.call('_get_remotes'); }
  _create_branch(branchName: string): unknown { return this.call('_create_branch', [branchName]); }
  _remove_branch(branchName: string): unknown { return this.call('_remove_branch', [branchName]); }
  _create_remote(remoteName: string, remoteUrl: string): unknown { return this.call('_create_remote', [remoteName, remoteUrl]); }
  _remove_remote(remoteName: string): unknown { return this.call('_remove_remote', [remoteName]); }
  _get_current_branch_name(): unknown { return this.call('_get_current_branch_name'); }
  _checkout_branch(branchName: string): unknown { return this.call('_checkout_branch', [branchName]); }
  _pull(remote: string): unknown { return this.call('_pull', [remote]); }
  _push(remote: string, force: boolean): unknown { return this.call('_push', [remote, force]); }
  _fetch(remote: string): unknown { return this.call('_fetch', [remote]); }
  _get_line_diff(filePath: string, text: string): unknown { return this.call('_get_line_diff', [filePath, text]); }

  create_diff_line(newLineNo: number, oldLineNo: number, content: string, status: string): GodotVCSDiffLine {
    return { new_line_no: newLineNo, old_line_no: oldLineNo, content, status };
  }

  create_diff_hunk(oldStart: number, newStart: number, oldLines: number, newLines: number): GodotVCSDiffHunk {
    return { old_start: oldStart, new_start: newStart, old_lines: oldLines, new_lines: newLines, diff_lines: [] };
  }

  create_diff_file(newFile: string, oldFile: string): GodotVCSDiffFile {
    return { new_file: newFile, old_file: oldFile, diff_hunks: [] };
  }

  create_commit(message: string, author: string, id: string, unixTimestamp: number, offsetMinutes: number): GodotVCSCommit {
    return { message, author, id, unix_timestamp: unixTimestamp, offset_minutes: offsetMinutes };
  }

  create_status_file(filePath: string, changeType: number, area: number): GodotVCSStatusFile {
    return { file_path: filePath, change_type: changeType, area };
  }

  add_diff_hunks_into_diff_file(diffFile: GodotVCSDiffFile, diffHunks: readonly GodotVCSDiffHunk[]): GodotVCSDiffFile {
    diffFile.diff_hunks.push(...diffHunks);
    return diffFile;
  }

  add_line_diffs_into_diff_hunk(diffHunk: GodotVCSDiffHunk, lineDiffs: readonly GodotVCSDiffLine[]): GodotVCSDiffHunk {
    diffHunk.diff_lines.push(...lineDiffs);
    return diffHunk;
  }

  popup_error(message: string): void { this.errors.push(message); }
  get_errors(): readonly string[] { return this.errors; }
  clear_errors(): void { this.errors.length = 0; }
}

export function createGodotEditorVCSInterface(carrier: GodotVCSCarrier): GodotEditorVCSInterface {
  return new GodotEditorVCSInterface(carrier);
}
