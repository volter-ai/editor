/** Constructor-authored Control.focus_mode defaults from the pinned Godot GUI classes. */
export function controlFocusModeDefault(major: 3 | 4, emitterClass: string | undefined): number {
  if (emitterClass === undefined) return 0;
  if (major === 4) {
    if (new Set([
      'MenuButton', 'LinkButton', 'RichTextLabel', 'SplitContainer', 'HSplitContainer',
      'VSplitContainer', 'MenuBar', 'GraphNode', 'GraphFrame',
    ]).has(emitterClass)) return 3;
    if (emitterClass === 'SubViewportContainer') return 1;
    if (new Set([
      'Button', 'ToolButton', 'CheckBox', 'CheckButton', 'TextureButton', 'HSlider', 'VSlider',
      'LineEdit', 'TextEdit', 'CodeEdit', 'GraphEdit', 'ItemList', 'Tree', 'TabBar',
      'FoldableContainer',
    ]).has(emitterClass)) return 2;
    return 0;
  }
  if (new Set([
    'Button', 'ToolButton', 'CheckBox', 'CheckButton', 'TextureButton', 'HSlider', 'VSlider',
    'LineEdit', 'TextEdit', 'GraphEdit', 'ItemList', 'Tree', 'PopupMenu',
  ]).has(emitterClass)) return 2;
  return 0;
}
