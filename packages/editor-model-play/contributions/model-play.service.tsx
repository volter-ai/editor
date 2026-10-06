/** Model script tool, available to every product through project packages. */
import { useSyncExternalStore } from 'react';
import { Button, EditorIcon, editorIcons, MenuItem } from '@volter/editor-sdk/widgets';
import { registerDocumentPlayExtension, type DocumentPlayControlProps } from '@volter/editor-sdk/kit/document-play-extension';
import { escapeModelPlay, modelPlaying, setModelPlaying, subscribeModelPlay } from '../src/model-play';
import { runPlayScript } from '../src/play-script';
import type * as THREE from 'three';
import { getCurrentProject, onProjectChange } from '@volter/editor-sdk/kit/active-project';

export const point = 'workspace.service';
function usePlaying(documentId: string | undefined): boolean {
  return useSyncExternalStore(subscribeModelPlay, () => documentId ? modelPlaying(documentId) : false, () => false);
}
function Control({ documentId, onClose }: DocumentPlayControlProps) {
  const playing = usePlaying(documentId);
  return <Button size="compact" data-testid="model-play-button" aria-pressed={playing}
    disabled={!documentId} title={playing ? 'Stop playing (Escape)' : 'Play this model’s script'}
    onClick={() => { onClose(); if (documentId) setModelPlaying(documentId, !playing); }}>
    <EditorIcon icon={playing ? editorIcons.transport.stop : editorIcons.transport.play} />
    {playing ? 'Stop' : 'Play'}
  </Button>;
}
function Menu({ documentId, onClose }: DocumentPlayControlProps) {
  const playing = usePlaying(documentId);
  return <MenuItem data-testid="model-play" disabled={!documentId}
    onSelect={() => { onClose(); if (documentId) setModelPlaying(documentId, !playing); }}>
    {playing ? 'Stop' : 'Play'}
  </MenuItem>;
}
export function start(): () => void {
  const unregister = registerDocumentPlayExtension('model', {
    Control, Menu, playing: modelPlaying, setPlaying: setModelPlaying, escape: escapeModelPlay,
    subscribe(listener) {
      const stopPlay = subscribeModelPlay(listener), stopProject = onProjectChange(listener);
      return () => { stopPlay(); stopProject(); };
    },
    aspectRatio() {
      const size = getCurrentProject()?.config.resolution;
      const ratio = size ? size.width / size.height : null;
      return ratio !== null && Number.isFinite(ratio) && ratio > 0 ? ratio : null;
    },
    run(stage) {
      // The document kind lends native scene objects; this tool owns their Three types.
      return runPlayScript({ ...stage, blend: stage.sourcePath, root: stage.root as THREE.Object3D,
        camera: stage.camera as () => THREE.Camera, editingCamera: stage.editingCamera as () => THREE.Camera,
        ownMaterial: stage.ownMaterial as ((material: THREE.Material) => THREE.Material | null) | undefined });
    },
  });
  return unregister;
}
