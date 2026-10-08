/**
 * A CRASH THAT STAYS WHERE IT HAPPENED. One part of the editor's own tree — an
 * Inspector section, a workspace document such as the UI component board —
 * that throws while rendering is replaced IN PLACE by its error, with the
 * message, and nothing above it unmounts.
 *
 * Without it the throw climbed to `AppRoot`'s `EditorRuntimeBoundary`, which
 * swaps the WHOLE editor surface for its startup-error screen. Measured on
 * raiku-walk (0.5.189, Windows, 2026-10-07): the React inspector's
 * `ClassesBlock` threw "Invalid hook call" while an agent checked HUD stories
 * on the UI board, and every panel, the board and the inspector went with it —
 * to the agent driving the session, the surface simply stopped answering.
 *
 * The crash is LOUD as well as contained: an error in the editor console
 * ledger (what the `console` command and the session log read), with React's
 * component stack, and a startup failure for the frame's cover, so a crash
 * drawn under a cover that has not lifted yet is not hidden behind it
 * (`startup-failure.ts`; `AppRoot`'s boundary publishes the same way). Retry
 * draws the subtree again; unmounting withdraws the notice.
 *
 * Sibling of `ToolHost`'s `ToolErrorBoundary` (a project tool's file, the dock's
 * wording) and `crash-null-boundary.ts` (a throw that must render nothing).
 */

import { Button, space, themeVars } from '@volter/sdk/widgets';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { editorConsole } from '@volter/sdk/kit/editor-console';
import { clearStartupFailure, reportStartupFailure } from '@volter/sdk/kit/startup-failure';

interface SurfaceCrashBoundaryProps {
  /** Stable id of the part (`inspector-section:<id>`, `document:<id>`): the startup-failure source. */
  readonly surface: string;
  /** What crashed, as a person names it ("The Classes inspector section"). */
  readonly label: string;
  readonly children?: ReactNode;
}

interface SurfaceCrashBoundaryState {
  readonly error: Error | null;
}

function crashMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SurfaceCrashBoundary extends Component<SurfaceCrashBoundaryProps, SurfaceCrashBoundaryState> {
  override state: SurfaceCrashBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): SurfaceCrashBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  private get source(): string {
    return `surface-crash:${this.props.surface}`;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const message = crashMessage(error);
    editorConsole.error(
      `${this.props.label} crashed while rendering (the rest of the editor is still running): ${message}\n${info.componentStack ?? ''}`,
      'editor',
    );
    reportStartupFailure(this.source, {
      message: `${this.props.label} crashed: ${message}`,
      guidance: 'The rest of the editor is still running. Dismiss this; the error is shown in place, with Retry.',
      command: null,
    });
  }

  override componentWillUnmount(): void {
    clearStartupFailure(this.source);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="surface-crash"
        data-surface-crash={this.props.surface}
        style={{
          padding: space[4],
          fontSize: 'var(--volter-font-md)',
          color: themeVars.semantic.danger,
          overflow: 'auto',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: space[2] }}>{this.props.label} crashed</div>
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error.message}</div>
        <div style={{ color: themeVars.content.muted, marginTop: space[3], marginBottom: space[3] }}>
          The rest of the editor is still running. The error is in the editor console.
        </div>
        <Button
          onClick={() => {
            clearStartupFailure(this.source);
            this.setState({ error: null });
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
}
