import { Button, bg, border, danger, radius, TextArea, text } from '@volter/editor-sdk/widgets';
import { useState, useSyncExternalStore } from 'react';
import type { EditorAction } from '../action-registry';
import { registerDocumentOpener } from '../document-open-registry';
import type { ViewportTab } from '../editor-shell-store';
import {
  getProjectTools,
  projectToolsVersion,
  refreshProjectTools,
  runProjectTool,
  subscribeProjectTools,
} from '../project-tools';
import {
  getDocumentToolContributions,
  getGlobalToolContributions,
  getToolContributionLoadFailures,
  subscribeToolContributions,
} from '../tool-loader';
import { waitUntil } from '../wait-until';
import {
  activeWorkspaceDocumentId,
  openWorkspaceDocument,
  type WorkspaceDocumentContentProps,
} from '../workspace-document-registry';
import { registerWorkspaceDocumentRestorer } from '../workspace-document-restore';
import { openToolDocument } from './tool-documents';
import { defaultValueForSchema, ToolSchemaForm } from './tool-schema-form';

export const PROJECT_TOOLS_DOCUMENT_ID = 'project-tools';
export const PROJECT_TOOL_DOCUMENT_PREFIX = 'project-tool:';

export interface ProjectToolDocumentStore {
  setActiveViewportTab(tab: ViewportTab): void;
}

function projectToolDocumentId(name: string): string {
  return `${PROJECT_TOOL_DOCUMENT_PREFIX}${name}`;
}

export function openProjectToolsDocument(store: ProjectToolDocumentStore): void {
  openWorkspaceDocument({
    id: PROJECT_TOOLS_DOCUMENT_ID,
    title: 'Project Tools',
    kind: 'project-tool',
    workspaceRole: 'workspace-reference',
    Content: ProjectToolDocumentContent,
    closeable: true,
    presentation: () => ({ kind: 'workspace', id: PROJECT_TOOLS_DOCUMENT_ID }),
    // The catalog is always truthfully reopenable — it lists whatever the
    // project declares now — so it persists with no state of its own.
    persist: () => ({ catalog: true }),
    onActivate: () => store.setActiveViewportTab('edit'),
  });
}

export function openProjectToolDocument(
  store: ProjectToolDocumentStore | null,
  name: string,
): boolean {
  const tool = getProjectTools().tools.find((entry) => entry.name === name);
  if (!tool) return false;
  const contributions = getDocumentToolContributions().filter((item) => item.tool?.name === name);
  if (contributions.length === 1) return openToolDocument(store, contributions[0]!.id);
  openWorkspaceDocument({
    id: projectToolDocumentId(name),
    title: tool.summary || tool.name,
    kind: 'project-tool',
    workspaceRole: 'workspace-reference',
    provenance: { sourcePath: tool.sourcePath, origin: tool.name },
    Content: ProjectToolDocumentContent,
    closeable: true,
    presentation: () => ({ kind: 'project-tool', name }),
    persist: () => ({ name }),
    ...(store ? { onActivate: () => store.setActiveViewportTab('edit') } : {}),
  });
  return true;
}

/**
 * THE TWO ADDRESSES THIS MODULE ANSWERS (`document-open-registry.ts`), each
 * the other half of a `presentation()` above: the CATALOG is a workspace
 * document (`{ kind: 'workspace', id: 'project-tools' }`), one named tool is
 * its own kind (`{ kind: 'project-tool', name }`). Registered at module load,
 * the shape `packages/game/src/story-documents/three-story-documents.tsx:239`
 * uses; the presenter addresses both without importing this file.
 */
registerDocumentOpener<{ readonly id: string }>({
  id: 'workspace',
  owner: 'project-tool-documents',
  // Every other workspace id belongs to the host's own workspace-document
  // registry, or to the account document's opener.
  open: (store, request) => {
    if (request.id !== PROJECT_TOOLS_DOCUMENT_ID) return null;
    openProjectToolsDocument(store);
    return PROJECT_TOOLS_DOCUMENT_ID;
  },
});

registerDocumentOpener<{ readonly name: string }>({
  id: 'project-tool',
  owner: 'project-tool-documents',
  // `openProjectToolDocument` answers a boolean because it opens one of TWO
  // documents — a single matching contribution's own tool document, or the
  // generic runner — and the active id is which one it chose. That is exactly
  // what the presenter read here before this was an address.
  open: (store, request) =>
    openProjectToolDocument(store, request.name) ? activeWorkspaceDocumentId() : null,
  // The catalog is discovered asynchronously, so a durable address routinely
  // names a tool before the project's tools have been read. Settling is the
  // same refresh this kind's RESTORER prepares with (below), then the wait the
  // presenter used to run as a poll around `open` itself.
  settle: async (request) => {
    await refreshProjectTools().catch(() => {});
    if (await waitUntil(() => getProjectTools().tools.some((t) => t.name === request.name))) return;
    throw new Error(`Project tool is not registered: ${request.name}`);
  },
});

/** Reopen a persisted project-tool document: the catalog, or one registered
 *  callable's generic runner. The runner is self-verifying against the
 *  discovered catalog (`false` for a tool that is gone), which this kind's
 *  `prepare` has settled first. */
registerWorkspaceDocumentRestorer({
  kind: 'project-tool',
  owner: 'project-tool-documents',
  prepare: () =>
    refreshProjectTools().then(
      () => {},
      () => {},
    ),
  restore: ({ state, store }) => {
    const record = state as { catalog?: unknown; name?: unknown } | null | undefined;
    if (record?.catalog === true) {
      openProjectToolsDocument(store);
      return true;
    }
    return typeof record?.name === 'string' && openProjectToolDocument(store, record.name);
  },
});

export function buildProjectToolActions(store: ProjectToolDocumentStore): EditorAction[] {
  return [
    {
      id: 'project-tools:open',
      label: 'Open Project Tools',
      category: 'action',
      execute: () => openProjectToolsDocument(store),
    },
    ...getProjectTools().tools.map((tool) => ({
      id: `project-tool:${tool.name}`,
      label: `Run: ${tool.summary || tool.name}`,
      category: 'action' as const,
      execute: () => void openProjectToolDocument(store, tool.name),
    })),
  ];
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre style={jsonStyle}>{JSON.stringify(value, null, 2)}</pre>;
}

export function ProjectToolDocumentContent({ documentId }: WorkspaceDocumentContentProps) {
  useSyncExternalStore(subscribeProjectTools, projectToolsVersion);
  useSyncExternalStore(subscribeToolContributions, getGlobalToolContributions);
  const snapshot = getProjectTools();
  const toolName = documentId.startsWith(PROJECT_TOOL_DOCUMENT_PREFIX)
    ? documentId.slice(PROJECT_TOOL_DOCUMENT_PREFIX.length)
    : null;
  const tool = toolName ? snapshot.tools.find((entry) => entry.name === toolName) : null;
  if (!toolName) {
    return (
      <div style={rootStyle} data-testid="project-tools-catalog">
        <h2 style={headingStyle}>Project Tools</h2>
        <p style={{ ...mutedStyle, margin: '0 0 18px', maxWidth: 720, lineHeight: 1.5 }}>
          Explicitly registered in <code>package.json#vgai.tools</code>. Each tool is an ordinary
          project function; a registration may pair it with optional editor contributions.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {snapshot.tools.map((entry) => (
            <Button
              key={entry.name}
              variant="ghost"
              className="vgai-project-tool-card"
              onClick={() => openProjectToolDocument(null, entry.name)}
              data-testid={`project-command-card:${entry.name}`}
            >
              <span style={cardTitleRowStyle}>
                <strong style={{ color: text[1], fontWeight: 600 }}>{entry.summary}</strong>
                <span style={openLabelStyle}>Open</span>
              </span>
              <code style={{ color: text[2], fontSize: 'var(--vgai-font-sm)' }}>{entry.name}</code>
              <span style={cardMetaRowStyle}>
                <span>
                  {entry.host} · {entry.permission.risk} · {entry.sourcePath}
                </span>
              </span>
            </Button>
          ))}
        </div>
        {snapshot.tools.length === 0 && snapshot.loadErrors.length === 0 && (
          <div style={mutedStyle}>No project tools registered.</div>
        )}
        {snapshot.loadErrors.map((error) => (
          <div key={`${error.sourcePath}:${error.message}`} style={errorStyle}>
            {error.sourcePath}: {error.message}
          </div>
        ))}
        {/* The server's `loadErrors` cover the CALLABLES it imported in node;
            contributions are only scanned there and imported in the tab, so a
            contribution that throws on import can appear nowhere else on this
            page — which is how a standing document went invisibly absent. */}
        {getToolContributionLoadFailures().map((failure) => (
          <div key={`${failure.entryPath}:${failure.error}`} style={errorStyle}>
            {failure.entryPath}: {failure.error}
          </div>
        ))}
      </div>
    );
  }

  if (!tool) {
    return <div style={rootStyle}>This tool is no longer available.</div>;
  }

  return <ProjectToolRunner key={tool.name} tool={tool} />;
}

function ProjectToolRunner({
  tool,
}: {
  tool: ReturnType<typeof getProjectTools>['tools'][number];
}) {
  const presentations = getDocumentToolContributions().filter(
    (item) => item.tool?.name === tool.name,
  );
  const initial = defaultValueForSchema(tool.inputSchema);
  const [input, setInput] = useState<Record<string, unknown>>(
    initial && typeof initial === 'object' && !Array.isArray(initial)
      ? (initial as Record<string, unknown>)
      : {},
  );
  const [rawText, setRawText] = useState(() => JSON.stringify(input, null, 2));
  const [result, setResult] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  const runnable = tool.host === 'node';
  const execute = async () => {
    const confirm =
      tool.permission.risk === 'read' ||
      window.confirm(`${tool.permission.summary}\n\nRun ${tool.name}?`);
    if (!confirm) return;
    setRunning(true);
    try {
      setResult(await runProjectTool(tool.name, input, { confirm: true }));
    } catch (error) {
      setResult({ ok: false, error: { code: 'REQUEST_FAILED', message: String(error) } });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={rootStyle} data-testid={`project-tool:${tool.name}`}>
      <h2 style={headingStyle}>{tool.summary}</h2>
      <code style={{ color: text[2] }}>{tool.name}</code>
      <p style={{ color: text[2] }}>{tool.description}</p>
      <div style={mutedStyle}>
        {tool.host} · {tool.permission.risk} · {tool.sourcePath}
      </div>
      {presentations.length > 0 && (
        <section style={{ marginTop: 18, maxWidth: 760 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Presentations</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {presentations.map((presentation) => (
              <Button
                key={presentation.id}
                variant="ghost"
                className="vgai-project-tool-card"
                onClick={() => openToolDocument(null, presentation.id)}
              >
                <span style={cardTitleRowStyle}>
                  <strong style={{ color: text[1], fontWeight: 600 }}>{presentation.title}</strong>
                  <span style={openLabelStyle}>Open</span>
                </span>
              </Button>
            ))}
          </div>
        </section>
      )}
      {!runnable && (
        <div style={errorStyle}>
          This runner supports Node-hosted tools. Import the underlying function directly in browser
          or runtime code.
        </div>
      )}
      <details open={presentations.length === 0} style={{ marginTop: 18, maxWidth: 760 }}>
        <summary style={{ cursor: 'pointer', color: text[2], fontSize: 12 }}>
          {presentations.length > 0 ? 'Advanced · invoke native schema' : 'Input'}
        </summary>
        <section style={{ marginTop: 12 }}>
          <ToolSchemaForm
            schema={tool.inputSchema}
            value={input}
            onChange={(next) => {
              setInput(next);
              setRawText(JSON.stringify(next, null, 2));
              setInputError(null);
            }}
          />
        </section>
        {inputError && <div style={errorStyle}>{inputError}</div>}
        <Button
          variant="primary"
          disabled={!runnable || running || inputError !== null}
          aria-busy={running}
          onClick={() => void execute()}
          style={{ marginTop: 16 }}
        >
          {running ? 'Running…' : 'Run tool'}
        </Button>
        <details style={{ marginTop: 16 }}>
          <summary style={labelStyle}>Advanced JSON</summary>
          <TextArea
            id={`tool-input:${tool.name}`}
            value={rawText}
            onChange={(event) => {
              const nextText = event.target.value;
              setRawText(nextText);
              try {
                const parsed = JSON.parse(nextText) as unknown;
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                  throw new Error('Input must be a JSON object.');
                }
                setInput(parsed as Record<string, unknown>);
                setInputError(null);
              } catch (error) {
                setInputError(error instanceof Error ? error.message : String(error));
              }
            }}
            rows={10}
            data-variant="code"
            style={textareaStyle}
          />
          <details>
            <summary style={labelStyle}>Input schema</summary>
            <JsonBlock value={tool.inputSchema} />
          </details>
        </details>
      </details>
      {result !== null && (
        <section>
          <div style={labelStyle}>Result</div>
          <JsonBlock value={result} />
        </section>
      )}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 960,
  margin: '0 auto',
  padding: 24,
  boxSizing: 'border-box',
  overflow: 'auto',
  pointerEvents: 'auto',
  color: text[1],
  fontSize: 'var(--vgai-font-base)',
};
const headingStyle: React.CSSProperties = { margin: '0 0 6px', fontSize: 20 };
const mutedStyle: React.CSSProperties = { color: text[2], fontSize: 'var(--vgai-font-sm)' };
const labelStyle: React.CSSProperties = { display: 'block', margin: '14px 0 6px', color: text[1] };
const cardTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};
const openLabelStyle: React.CSSProperties = {
  color: text[2],
  fontSize: 'var(--vgai-font-sm)',
  fontWeight: 500,
};
const cardMetaRowStyle: React.CSSProperties = {
  display: 'flex',
  width: '100%',
  minWidth: 0,
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  color: text[2],
  fontSize: 'var(--vgai-font-sm)',
};
const errorStyle: React.CSSProperties = { marginTop: 10, color: danger, whiteSpace: 'pre-wrap' };
const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
};
const jsonStyle: React.CSSProperties = {
  overflow: 'auto',
  padding: 10,
  background: bg.inset,
  border: `1px solid ${border[1]}`,
  borderRadius: radius.sm,
  color: text[2],
};
