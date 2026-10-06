/** Model script tool, available to every product through project packages. */
import { useSyncExternalStore } from 'react';
import { Button, EditorIcon, editorIcons, MenuItem } from '@volter/editor-sdk/widgets';
import { editorHost } from '@volter/editor-sdk/host';
import { registerDocumentPlayExtension, type DocumentPlayControlProps } from '@volter/editor-sdk/kit/document-play-extension';
import {
  escapeModelPlay,
  MODEL_PLAY_SPEEDS,
  modelPlayClock,
  modelPlayGeneration,
  modelPlaying,
  restartModelPlay,
  setModelPlayPaused,
  setModelPlaying,
  setModelPlaySpeed,
  stepModelPlay,
  subscribeModelPlay,
  subscribeModelPlayClock,
} from '../src/model-play';
import { playScriptPath, runPlayScript } from '../src/play-script';
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

/**
 * WHETHER A MODEL HAS A PLAY SCRIPT — `src/models/track.blend` has one when
 * `src/models/track.play.ts` exists (`playScriptPath`), the same file Play imports. Asked once
 * per path through the project's files door and then kept, corrected by that door's change
 * events, so a layout can open a model with a script as a game and one without as a model. A
 * project switch forgets every answer.
 */
const scripts = new Map<string, boolean>();
const looking = new Set<string>();
const scriptListeners = new Set<() => void>();
function publishScripts(): void {
  for (const listener of [...scriptListeners]) listener();
}
function projectPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}
function hasScript(sourcePath: string): boolean | null {
  const path = projectPath(playScriptPath(sourcePath));
  const known = scripts.get(path);
  if (known !== undefined) return known;
  if (!looking.has(path)) {
    looking.add(path);
    const project = getCurrentProject()?.rootPath;
    void editorHost().files.exists(path).then(exists => exists, () => false).then(exists => {
      looking.delete(path);
      // An answer about the previous project is no answer about this one.
      if (getCurrentProject()?.rootPath !== project) return;
      scripts.set(path, exists);
      publishScripts();
    });
  }
  return null;
}

export function start(): () => void {
  const stopWatching = (() => {
    try {
      return editorHost().files.watch((event) => {
        const path = projectPath(event.path);
        if (!scripts.has(path) && !path.endsWith('.play.ts')) return;
        const exists = event.type !== 'remove';
        if (scripts.get(path) === exists) return;
        scripts.set(path, exists);
        publishScripts();
      });
    } catch {
      // A host without a files door still plays; the answer is then read once per path.
      return () => {};
    }
  })();
  const stopProject = onProjectChange(() => { scripts.clear(); publishScripts(); });
  const unregister = registerDocumentPlayExtension('model', {
    Control, Menu, playing: modelPlaying, setPlaying: setModelPlaying, escape: escapeModelPlay,
    subscribe(listener) {
      const stopPlay = subscribeModelPlay(listener), stopProject = onProjectChange(listener);
      scriptListeners.add(listener);
      return () => { stopPlay(); stopProject(); scriptListeners.delete(listener); };
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
    // THE RUN'S TRANSPORT (`model-play.ts`): the runner reads all of it each frame.
    transport: {
      speeds: MODEL_PLAY_SPEEDS,
      clock: modelPlayClock,
      subscribeClock: subscribeModelPlayClock,
      setPaused: setModelPlayPaused,
      step: stepModelPlay,
      setSpeed: setModelPlaySpeed,
      restart: restartModelPlay,
      generation: modelPlayGeneration,
    },
    scriptPath: playScriptPath,
    hasScript,
  });
  return () => {
    unregister();
    stopProject();
    stopWatching();
  };
}
