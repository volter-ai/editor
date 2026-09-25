export const PROJECT_ASSET_COMMANDS = {
  open: { id: 'project-asset.open', shortcut: 'Enter' },
  rename: { id: 'project-asset.rename', shortcut: 'F2' },
  move: { id: 'project-asset.move', shortcut: null },
  duplicate: { id: 'project-asset.duplicate', shortcut: 'Mod+D' },
  delete: { id: 'project-asset.delete', shortcut: 'Delete' },
  copyPath: { id: 'project-asset.copy-path', shortcut: 'Mod+Shift+C' },
  reveal: { id: 'project-asset.reveal', shortcut: null },
  refresh: { id: 'project-asset.refresh', shortcut: 'Mod+R' },
  import: { id: 'project-asset.import', shortcut: null },
  createFolder: { id: 'project-asset.create-folder', shortcut: 'Mod+Shift+N' },
} as const;

export type ProjectAssetCommandId =
  (typeof PROJECT_ASSET_COMMANDS)[keyof typeof PROJECT_ASSET_COMMANDS]['id'];

export function projectAssetCommandIds(): readonly ProjectAssetCommandId[] {
  return Object.values(PROJECT_ASSET_COMMANDS).map((command) => command.id);
}

