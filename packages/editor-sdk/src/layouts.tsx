/** Programmable editor composition. Layouts are React components, not registry keys. */
import { type ComponentType, type CSSProperties, createElement, type ReactNode } from 'react';
import { DesignArrangement, type WorkspaceArrangement } from './layout-arrangements';
import type { EditorView } from './types';

export {
  DesignArrangement,
  GameArrangement,
  type WorkspaceArrangement,
} from './layout-arrangements';

export interface EditorLayoutProps {
  readonly playing: boolean;
  readonly paused: boolean;
}
export type EditorLayout = ComponentType<EditorLayoutProps>;
export interface LayoutFrameProps {
  readonly children?: ReactNode;
  readonly style?: CSSProperties;
  /** Let the enclosing web page scroll when the pointer is over a viewport. */
  readonly pageScroll?: boolean;
}
export interface WorkspaceProps {
  readonly arrangement?: WorkspaceArrangement;
  readonly immersivePlay?: boolean;
  readonly playUtilities?: readonly string[];
}
export interface DocumentHandle {
  /** Select exactly one named native object; ambiguous/missing names refuse. */
  select(name: string): void;
  transform(mode: 'combined' | 'translate' | 'rotate' | 'scale'): void;
  frame(): void;
}
export interface DocumentViewProps {
  readonly document:
    | Extract<NonNullable<EditorView['document']>, { kind: 'story' | 'workspace' }>
    | {
        readonly kind: 'asset';
        readonly path: string;
        readonly assetKind?: 'source' | 'model' | 'image' | 'audio' | 'json';
      };
  readonly chrome?: boolean;
  readonly active?: boolean;
  readonly onReady?: (document: DocumentHandle) => void;
}
export interface LayoutHost {
  readonly Frame: ComponentType<LayoutFrameProps>;
  readonly Header: ComponentType;
  readonly Footer: ComponentType;
  readonly Workspace: ComponentType<WorkspaceProps>;
  readonly Document: ComponentType<DocumentViewProps>;
}
const HOST_KEY = Symbol.for('vgai.editor.layout-host');
const hosts = globalThis as typeof globalThis & { [HOST_KEY]?: LayoutHost };
/** Installed once by the editor runtime; project modules share this SDK instance. */
export function registerLayoutHost(value: LayoutHost): void {
  hosts[HOST_KEY] = value;
}
function currentHost(): LayoutHost {
  const host = hosts[HOST_KEY];
  if (!host) throw new Error('Editor layouts require an editor host.');
  return host;
}
export function EditorFrame(props: LayoutFrameProps) {
  return createElement(currentHost().Frame, props);
}
export function EditorHeader() {
  return createElement(currentHost().Header);
}
export function EditorFooter() {
  return createElement(currentHost().Footer);
}
export function Workspace(props: WorkspaceProps) {
  return createElement(currentHost().Workspace, props);
}
export function DocumentView(props: DocumentViewProps) {
  return createElement(currentHost().Document, props);
}

/** Full game authoring, with the running game taking over the workspace during Play. */
export function GameLayout() {
  return (
    <EditorFrame>
      <EditorHeader />
      <Workspace immersivePlay />
      <EditorFooter />
    </EditorFrame>
  );
}
/** Studio keeps its authoring panels and opens analytics while the game runs. */
export function StudioLayout() {
  return (
    <EditorFrame>
      <EditorHeader />
      <Workspace immersivePlay={false} playUtilities={['tool:analytics.analytics']} />
      <EditorFooter />
    </EditorFrame>
  );
}
export function DesignLayout() {
  return (
    <EditorFrame>
      <EditorHeader />
      <Workspace arrangement={DesignArrangement} immersivePlay={false} />
      <EditorFooter />
    </EditorFrame>
  );
}
