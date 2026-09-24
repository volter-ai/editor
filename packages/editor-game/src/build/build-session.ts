/**
 * THE BUILD SESSION — one truth for the three build surfaces this package
 * contributes (the Build Profiles document, the native Output channel and
 * the build-progress status item). Module scope on purpose: the old bottom
 * BUILD tab lost its log whenever the pane unmounted mid-build, so the
 * session outlives any one surface.
 *
 * Builds spawn `npm run <script>` on the editor's dev server, which is the
 * only place a project's own scripts run.
 *
 * `startBuild` reveals the native Build output channel through the host door.
 */

import {
  listConfigurations,
  startBuild as startBuildConfiguration,
} from '../host/api/configurations';
import type { EditorHostOutputDiagnostic } from '@volter/editor-sdk/host';
import { editorHost } from '@volter/editor-sdk/host';
import type { BuildReport } from '@volter/editor-sdk/session/build-report';
import { useEffect, useState } from 'react';
import { formatBytes } from './format-bytes';

const BUILD_OUTPUT_ID = 'build';

/** The Build Profiles document's contribution id (`build-profiles.document.tsx`),
 *  as `workspace.openContributedDocument` names it. */
export const BUILD_PROFILES_DOCUMENT_ID = 'build-profiles.document';

/** Open (or activate) the Build Profiles document — what every build entry
 *  point does: the header's Export button, the palette's build actions, the
 *  Window menu and the `show-build` verb. */
export function openBuildProfilesDocument(): boolean {
  return editorHost().workspace.openContributedDocument(BUILD_PROFILES_DOCUMENT_ID);
}

/** A build-role configuration's id (ARCHITECTURE-CORE §The project model). */
export type BuildTarget = string;
export type BuildPhase = 'idle' | 'building' | 'done';

export interface BuildResult {
  ok: boolean;
  code: number | null;
  report?: BuildReport;
}

export interface BuildProfile {
  readonly id: BuildTarget;
  readonly label: string;
  readonly subtitle: string;
}

/** The project's build-role configurations, as profiles. Empty until the
 *  manifest declares one; nothing is assumed. */
export function useBuildProfiles(): readonly BuildProfile[] {
  const [profiles, setProfiles] = useState<readonly BuildProfile[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listConfigurations()
      .then((all) => {
        if (cancelled) return;
        setProfiles(
          all
            .filter((c) => c.role === 'build')
            .map((c) => ({ id: c.id, label: c.id, subtitle: c.describe ?? c.kind })),
        );
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return profiles;
}

export interface BuildSession {
  readonly phase: BuildPhase;
  readonly target: BuildTarget;
  readonly log: readonly string[];
  readonly result: BuildResult | null;
}

let _session: BuildSession = { phase: 'idle', target: '', log: [], result: null };
let _version = 0;
const _listeners = new Set<() => void>();
let _abort: AbortController | null = null;

function setSession(patch: Partial<BuildSession>): void {
  _session = { ..._session, ...patch };
  _version++;
  publishBuildOutput();
  for (const fn of _listeners) fn();
}

/** Subscribe to build-session changes. Returns unsubscribe. */
export function subscribeBuildSession(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
export function buildSessionVersion(): number {
  return _version;
}

/** The current build session (stable reference between changes). */
export function getBuildSession(): BuildSession {
  return _session;
}

/** Back to idle (the `Build Again` reset). No-op mid-build. */
export function resetBuildSession(): void {
  if (_session.phase === 'building') return;
  setSession({ phase: 'idle', log: [], result: null });
}

/** Abort a running build (the old panel's Cancel, unchanged semantics). */
export function cancelBuild(): void {
  _abort?.abort();
  setSession({ phase: 'idle' });
}

/** The build log is an Output channel; failures with source locations also reach Problems. */
export function showBuildOutput(): void {
  publishBuildOutput();
  editorHost().output.show(BUILD_OUTPUT_ID);
}

function publishBuildOutput(): void {
  const session = getBuildSession();
  let text = session.log.length ? `${session.log.join('\n')}\n` : '';
  if (session.phase === 'done' && session.result) {
    text += `\n${session.result.ok ? 'Build complete.' : `Build failed (exit code: ${session.result.code ?? 'unknown'}).`}\n`;
    if (session.result.report) {
      const report = session.result.report;
      text += `${formatBytes(report.artifactBytes)} package · ${formatBytes(report.outputBytes)} output · ${report.fileCount} files\n`;
    }
  }
  editorHost().output.write(BUILD_OUTPUT_ID, 'Build', text, buildDiagnostics(text));
}

/** Only explicit compiler locations become markers. Unlocated failures stay in Output. */
export function buildDiagnostics(text: string): EditorHostOutputDiagnostic[] {
  const diagnostics: EditorHostOutputDiagnostic[] = [];
  // biome-ignore lint/suspicious/noControlCharactersInRegex: compiler logs contain ANSI SGR escapes.
  const plain = text.replace(/\u001b\[[0-9;]*m/g, '');
  for (const line of plain.split(/\r?\n/)) {
    // TypeScript pretty and plain forms; esbuild's explicit file:line:column errors.
    const match =
      line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(.*)$/) ??
      line.match(/^(.+?):(\d+):(\d+)\s*[-:]?\s*(error|warning)\s*:?[ ]*(.*)$/i);
    if (!match) continue;
    const path = match[1]!.trim();
    if (path.startsWith('/') || path.split(/[\\/]/).includes('..')) continue;
    diagnostics.push({
      path,
      line: Math.max(1, Number(match[2])),
      column: Math.max(1, Number(match[3])),
      severity: match[4]!.toLowerCase() === 'warning' ? 'warning' : 'error',
      message: match[5]!,
    });
  }
  return diagnostics;
}

/**
 * Run a build — the `startExport` SSE stream, consumed at module scope so the
 * session outlives any one surface. Reveals the Build Output tab so the log
 * has somewhere visible to stream.
 */
export async function startBuild(target: BuildTarget): Promise<void> {
  if (_session.phase === 'building') return;
  setSession({ phase: 'building', target, log: [], result: null });
  showBuildOutput();

  const controller = new AbortController();
  _abort = controller;

  try {
    const res = await startBuildConfiguration(target, controller.signal);

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: 'Build request failed' }))) as {
        error?: string;
      };
      setSession({
        phase: 'done',
        log: [..._session.log, `Error: ${err.error ?? res.statusText}`],
        result: { ok: false, code: null },
      });
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop()!;

      for (const part of parts) {
        if (part.startsWith(':')) continue;
        const lines = part.split('\n');
        let event = '';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (event === 'log') {
          let lineText: string;
          try {
            lineText = JSON.parse(data) as string;
          } catch {
            lineText = data;
          }
          setSession({ log: [..._session.log, lineText] });
        } else if (event === 'done') {
          let result: BuildResult;
          try {
            result = JSON.parse(data) as BuildResult;
          } catch {
            result = { ok: false, code: null };
          }
          setSession({ phase: 'done', result });
        }
      }
    }
  } catch (err: unknown) {
    if ((err as Error).name !== 'AbortError') {
      setSession({
        phase: 'done',
        log: [..._session.log, `Error: ${(err as Error).message}`],
        result: { ok: false, code: null },
      });
    }
  }
}
