import type { RootViewController } from '@volter/editor-sdk/kit/world-pan-state';

export interface CanvasSceneGuide {
  readonly id: string;
  readonly axis: 'x' | 'y';
  readonly value: number;
}

interface GuideState {
  guides: CanvasSceneGuide[];
  listeners: Set<() => void>;
  revision: number;
}

const states = new WeakMap<RootViewController, GuideState>();
let nextGuideId = 0;

function stateFor(view: RootViewController): GuideState {
  let state = states.get(view);
  if (!state) {
    state = { guides: [], listeners: new Set(), revision: 0 };
    states.set(view, state);
  }
  return state;
}

function publish(state: GuideState): void {
  state.revision += 1;
  for (const listener of state.listeners) listener();
}

export function canvasSceneGuides(view: RootViewController): readonly CanvasSceneGuide[] {
  return stateFor(view).guides;
}

export function canvasSceneGuideRevision(view: RootViewController): number {
  return stateFor(view).revision;
}

export function subscribeCanvasSceneGuides(
  view: RootViewController,
  listener: () => void,
): () => void {
  const state = stateFor(view);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function addCanvasSceneGuide(
  view: RootViewController,
  axis: CanvasSceneGuide['axis'],
  value: number,
): string {
  nextGuideId += 1;
  const state = stateFor(view);
  const id = `canvas-guide-${nextGuideId}`;
  state.guides = [...state.guides, { id, axis, value }];
  publish(state);
  return id;
}

export function moveCanvasSceneGuide(view: RootViewController, id: string, value: number): void {
  const state = stateFor(view);
  const next = state.guides.map((guide) => (guide.id === id ? { ...guide, value } : guide));
  if (next.every((guide, index) => guide === state.guides[index])) return;
  state.guides = next;
  publish(state);
}

export function removeCanvasSceneGuide(view: RootViewController, id: string): void {
  const state = stateFor(view);
  const next = state.guides.filter((guide) => guide.id !== id);
  if (next.length === state.guides.length) return;
  state.guides = next;
  publish(state);
}
