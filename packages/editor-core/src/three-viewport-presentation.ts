export type ThreeViewportProjection = 'perspective' | 'orthographic';

export interface ThreeViewportPresentationState {
  readonly projection: ThreeViewportProjection;
}

let state: ThreeViewportPresentationState = { projection: 'perspective' };
const listeners = new Set<() => void>();

export function threeViewportPresentation(): ThreeViewportPresentationState {
  return state;
}

export function subscribeThreeViewportPresentation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setThreeViewportProjection(projection: ThreeViewportProjection): void {
  if (state.projection === projection) return;
  state = { ...state, projection };
  for (const listener of listeners) listener();
}
