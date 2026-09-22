import { themeVars } from '@volter/editor-sdk/widgets';
import { resolveUrl } from '@volter/editor-threejs/loader';
import { useEffect, useState } from 'react';
import { assetCapabilities } from '../../asset-workflow/asset-capabilities';
import { getCurrentProject } from '../../project-manager';
import {
  projectModuleChangeMatches,
  subscribeProjectModuleChange,
} from '../../project-module-changes';
import { AssetEditorShell } from '../AssetEditorShell';
import { CodeView, codeViewLanguage } from '../CodeView';
import { AudioViewer } from './AudioViewer';
import { EnvironmentAssetDocument } from './EnvironmentAssetDocument';
import { ImageViewer } from './ImageViewer';
import { JsonAssetDocument } from './JsonAssetDocument';
import { LiveModuleDocument } from './LiveModuleDocument';
import { LutAssetDocument } from './LutAssetDocument';
import { ModelAssetDocument } from './ModelAssetDocument';
import { ShaderAssetDocument } from './ShaderAssetDocument';

export type SourceAssetRoute =
  | 'model'
  | 'image'
  | 'audio'
  | 'json'
  | 'environment'
  | 'lut'
  | 'shader'
  | 'module'
  | 'text'
  | 'binary';

/**
 * A project script the editor can EXECUTE, and therefore a candidate live
 * model module (`LiveModuleDocument`). The bound is the dev server's own: only
 * `src/**` scripts are classified, HMR-stamped and re-served on save
 * (`server/project-hmr-files.ts`'s `classifyProjectHotUpdate` returns `ignore`
 * for everything else), so a script outside `src/` could be imported once but
 * never re-executed — a live document that silently stops being live. Whether
 * such a module actually BUILDS an `Object3D` is decided by running it, never
 * by its name.
 */
function isProjectScriptPath(assetPath: string): boolean {
  const clean = (assetPath.split(/[?#]/, 1)[0] ?? '').replace(/^\//, '');
  return clean.startsWith('src/') && /\.(?:[cm]?[jt]sx?)$/.test(clean);
}

export function sourceAssetRoute(assetPath: string): SourceAssetRoute {
  const capability = assetCapabilities(assetPath);
  if (capability.editor === 'model') return 'model';
  if (capability.editor === 'image') return 'image';
  if (capability.editor === 'audio') return 'audio';
  if (capability.editor === 'data') return 'json';
  if (capability.editor === 'environment') return 'environment';
  if (capability.format === 'cube') return 'lut';
  if (capability.format === 'glsl' || capability.format === 'vert' || capability.format === 'frag')
    return 'shader';
  if (isProjectScriptPath(assetPath)) return 'module';
  if (capability.editor === 'source' && capability.previewable) return 'text';
  return 'binary';
}

/**
 * THE FILE IS THE SUBJECT.
 *
 * A source/module document had no selection context of its own, and
 * `waitForAssetDocumentInspector` waits for exactly that — so
 * `editor.openAsset('/src/foo.ts', 'source')` opened the document, showed the
 * code, and then sat until the relay's budget ran out and reported a
 * `play-stall`: a timeout about the tab for a document that was already on
 * screen. (The JSON route acked because `JsonAssetDocument` goes through
 * `AssetEditorShell`.)
 *
 * There is no invented subject here and nothing new to publish: a source
 * document's subject is the FILE, its identity row is the filename and the
 * kind, and its note is the Info the shell already shows for every other
 * asset — so it registers through the SAME holder every Asset Lab document
 * uses (`AssetEditorShell` → `AssetEditorSubject`) rather than growing a
 * second one.
 */
function TextSourcePreview({
  documentId,
  assetPath,
  active = true,
}: {
  readonly documentId: string;
  readonly assetPath: string;
  readonly active?: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileName = assetPath.split('/').pop() ?? assetPath;
  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    const path = assetPath.replace(/^\//, '');
    let revision = 0;
    async function read() {
      const request = ++revision;
      try {
        const value = await fetch(resolveUrl(assetPath), { cache: 'no-store' }).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        });
        if (!cancelled && request === revision) {
          setContent(value);
          setError(null);
        }
      } catch (reason) {
        if (!cancelled && request === revision)
          setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
    const refresh = (changed: string) => {
      if (projectModuleChangeMatches(changed, path)) void read();
    };
    const stop = subscribeProjectModuleChange(refresh);
    void read();
    return () => {
      cancelled = true;
      stop();
    };
  }, [assetPath]);
  return (
    <AssetEditorShell
      documentId={documentId}
      active={active}
      type="source"
      title={fileName}
      sections={[]}
      status={`source · ${assetPath}`}
      fill
    >
      <div
        style={{
          padding: 12,
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div
          style={{
            padding: 8,
            // The well GROWS to the panel instead of stopping at a fixed
            // budget: this document is a whole tab, and CodeView virtualizes,
            // so there is nothing to buy by capping it. (It inherited a
            // 560px ceiling from the small in-panel preview it was cut from,
            // which left most of a full-tab source document empty.)
            flex: 1,
            minHeight: 0,
            display: 'flex',
            overflow: 'hidden',
            background: themeVars.surface.inset,
            border: `1px solid ${themeVars.boundary.default}`,
            borderRadius: themeVars.shape.small,
          }}
        >
          {error !== null || content === null ? (
            <div
              style={{
                fontFamily: themeVars.typography.mono,
                fontSize: 11,
                lineHeight: 1.5,
                color: error ? themeVars.semantic.danger : themeVars.content.muted,
                padding: 4,
              }}
            >
              {error ?? 'Loading…'}
            </div>
          ) : (
            <CodeView
              value={content}
              followChanges
              language={codeViewLanguage(assetPath)}
              fontSize={11}
              maxHeight="100%"
              ariaLabel={`Source of ${assetPath}`}
            />
          )}
        </div>
      </div>
    </AssetEditorShell>
  );
}

/** Viewer for downloaded catalog source/animation files without a magic fallback. */
export function SourceAssetViewer({
  documentId,
  assetPath,
  active = true,
}: {
  documentId: string;
  assetPath: string;
  active?: boolean;
}) {
  switch (sourceAssetRoute(assetPath)) {
    case 'model':
      return (
        <ModelAssetDocument
          documentId={documentId}
          assetPath={assetPath}
          displayName={assetPath.split('/').pop() ?? assetPath}
          active={active}
        />
      );
    case 'image':
      return <ImageViewer assetPath={assetPath} />;
    case 'audio':
      return <AudioViewer assetPath={assetPath} />;
    case 'json':
      // Content-routed: a native three.quarks document opens as the particle
      // editor, any other JSON keeps the generic viewer.
      return (
        <JsonAssetDocument
          documentId={documentId}
          assetPath={assetPath}
          displayName={assetPath.split('/').pop() ?? assetPath}
          active={active}
          sections={[]}
          status={`json · ${assetPath}`}
        />
      );
    case 'environment':
      return (
        <EnvironmentAssetDocument documentId={documentId} assetPath={assetPath} active={active} />
      );
    case 'lut':
      return <LutAssetDocument documentId={documentId} assetPath={assetPath} active={active} />;
    case 'shader':
      return <ShaderAssetDocument documentId={documentId} assetPath={assetPath} active={active} />;
    case 'module': {
      // Content-routed, like the quarks JSON above: a project script that
      // BUILDS an Object3D opens as the live modeling document; anything else
      // keeps this viewer's text preview.
      const projectRoot = getCurrentProject()?.rootPath;
      const preview = (
        <TextSourcePreview documentId={documentId} assetPath={assetPath} active={active} />
      );
      if (!projectRoot) return preview;
      return (
        <LiveModuleDocument
          documentId={documentId}
          projectRoot={projectRoot}
          modulePath={(assetPath.split(/[?#]/, 1)[0] ?? assetPath).replace(/^\//, '')}
          displayName={assetPath.split('/').pop() ?? assetPath}
          active={active}
          fallback={preview}
        />
      );
    }
    case 'text':
      return <TextSourcePreview documentId={documentId} assetPath={assetPath} active={active} />;
    case 'binary':
      // Same subject rule as the text route above — the FILE. A document that
      // publishes nothing is a document `editor.openAsset` can only time out
      // against, and "no renderer" is not "no identity".
      return (
        <AssetEditorShell
          documentId={documentId}
          active={active}
          type="binary source"
          title={assetPath.split('/').pop() ?? assetPath}
          sections={[]}
          status={`binary · ${assetPath}`}
        >
          <div style={{ padding: 16, color: themeVars.content.muted, fontSize: 12 }}>
            <div style={{ color: themeVars.content.primary, fontWeight: 600, marginBottom: 6 }}>
              {assetPath.split('/').pop()}
            </div>
            This binary source is available in the project, but it has no safe in-editor renderer.
            Its file remains selectable and referenceable without being misidentified as another
            format.
          </div>
        </AssetEditorShell>
      );
  }
}
