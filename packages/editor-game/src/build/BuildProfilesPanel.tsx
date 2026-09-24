/**
 * THE BUILD PROFILES PANEL — the configuration surface the `build-profiles`
 * document draws: the project's build-role configurations as a target list,
 * the name/resolution/app-id fields it writes back into `vgai.project.json`
 * through the project's file history, the Build trigger, and the finished
 * build's report. The LOG is not here: it streams into the Build Output tab
 * (the native Output panel’s Build channel), which is the whole point of the split — a
 * build takes real seconds and a modal would block the viewport.
 */

import { workspaceHistoryService } from '@volter/editor-core/components/workspace-history';
import { getDownloadUrl, readProjectTextFile, saveFile } from '@volter/editor-core/editor-api';
import { getProjectFileHistory } from '@volter/editor-core/history/project-file-history';
import { faGlobe } from '@fortawesome/free-solid-svg-icons';
import type { BuildReport } from '@volter/editor-sdk/session/build-report';
import {
  accent,
  Button,
  bg,
  border,
  danger,
  EditorIcon,
  EditorListButton,
  fontMono,
  fontSizeVar,
  radius,
  spaceVar,
  success,
  TextInput,
  text,
} from '@volter/editor-sdk/widgets';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  type BuildTarget,
  buildSessionVersion,
  cancelBuild,
  getBuildSession,
  resetBuildSession,
  startBuild,
  subscribeBuildSession,
  useBuildProfiles,
} from './build-session';
import { formatBytes } from './format-bytes';

interface ProjectConfig {
  name: string;
  resolution: { width: number; height: number };
  appId: string;
}

const MANIFEST_PATH = 'vgai.project.json';

const DEFAULT_CONFIG: ProjectConfig = {
  name: 'My Game',
  resolution: { width: 1280, height: 720 },
  appId: 'com.example.mygame',
};

export function BuildProfilesPanel() {
  useSyncExternalStore(subscribeBuildSession, buildSessionVersion, buildSessionVersion);
  const session = getBuildSession();
  // Session history via the workspace-history bridge (see its doc comment);
  // the per-service manager is cached inside getProjectFileHistory.
  const history = workspaceHistoryService();
  const fileHistory = history ? getProjectFileHistory(history) : null;
  const [config, setConfig] = useState<ProjectConfig>(DEFAULT_CONFIG);
  const TARGETS = useBuildProfiles();
  const [selected, setSelected] = useState<BuildTarget>('');
  useEffect(() => {
    if (!selected && TARGETS.length > 0) setSelected(TARGETS[0]?.id ?? '');
  }, [TARGETS, selected]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConfig = useCallback(async () => {
    const manifestText = await readProjectTextFile(MANIFEST_PATH);
    const manifest = manifestText
      ? (JSON.parse(manifestText) as Partial<ProjectConfig>)
      : DEFAULT_CONFIG;
    setConfig({
      ...DEFAULT_CONFIG,
      ...manifest,
      resolution: { ...DEFAULT_CONFIG.resolution, ...manifest.resolution },
    });
  }, []);

  useEffect(() => {
    void loadConfig().catch(() => {});
    return (
      fileHistory?.subscribeAll((path) => {
        if (path === MANIFEST_PATH) void loadConfig().catch(() => {});
      }) ?? (() => {})
    );
  }, [fileHistory, loadConfig]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // Merge only the build-owned fields into the manifest. Roots and every
  // unrelated authored field must survive a Build Profiles edit.
  const saveConfig = useCallback(
    (cfg: ProjectConfig) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        const currentText = await readProjectTextFile(MANIFEST_PATH);
        if (!currentText)
          throw new Error(`Cannot edit build settings: ${MANIFEST_PATH} is missing`);
        const manifest = JSON.parse(currentText) as Record<string, unknown>;
        const content = `${JSON.stringify(
          { ...manifest, name: cfg.name, resolution: cfg.resolution, appId: cfg.appId },
          null,
          2,
        )}\n`;
        if (!fileHistory) {
          await saveFile(MANIFEST_PATH, content);
          return;
        }
        await fileHistory
          .write(MANIFEST_PATH, content, {
            label: 'Edit Build Settings',
            kind: 'settings',
            contentType: 'application/json',
          })
          .catch(() => void loadConfig().catch(() => {}));
      }, 500);
    },
    [fileHistory, loadConfig],
  );

  const updateConfig = useCallback(
    (patch: Partial<ProjectConfig>) => {
      setConfig((prev) => {
        const next = { ...prev, ...patch };
        saveConfig(next);
        return next;
      });
    },
    [saveConfig],
  );

  const updateResolution = useCallback(
    (key: 'width' | 'height', value: number) => {
      setConfig((prev) => {
        const next = { ...prev, resolution: { ...prev.resolution, [key]: Math.round(value) } };
        saveConfig(next);
        return next;
      });
    },
    [saveConfig],
  );

  const phase = session.phase;
  const artifact = session.result?.report?.artifact ?? null;

  return (
    <div
      data-testid="build-profiles-document"
      style={{ display: 'flex', flex: 1, minHeight: 0, background: bg[1], pointerEvents: 'auto' }}
    >
      {/* Left: target list (the "profiles") */}
      <div style={targetListStyle}>
        {TARGETS.map((t) => (
          <EditorListButton
            key={t.id}
            selected={selected === t.id}
            disabled={phase === 'building'}
            onClick={() => {
              if (phase !== 'building') setSelected(t.id);
            }}
            style={{
              padding: `${spaceVar[4]} ${spaceVar[6]}`,
              opacity: phase === 'building' && selected !== t.id ? 0.4 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: spaceVar[4] }}>
              <EditorIcon
                icon={faGlobe}
                style={{ fontSize: fontSizeVar.lg, color: selected === t.id ? accent : text[2] }}
              />
              <div>
                <div
                  style={{
                    fontSize: fontSizeVar.md,
                    fontWeight: 600,
                    color: selected === t.id ? text[1] : text[2],
                  }}
                >
                  {t.label}
                </div>
                <div style={{ fontSize: fontSizeVar.sm, color: text[3], marginTop: 1 }}>
                  {t.subtitle}
                </div>
              </div>
            </div>
          </EditorListButton>
        ))}
      </div>

      {/* Right: settings + phase-dependent action row */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          padding: `${spaceVar[5]} ${spaceVar[8]}`,
          maxWidth: 560,
        }}
      >
        <div style={sectionHeaderStyle}>Project</div>

        <div style={fieldRowStyle}>
          <label style={labelStyle}>Name</label>
          <TextInput
            className="vgai-input"
            style={{ flex: 1 }}
            value={config.name}
            onChange={(e) => updateConfig({ name: e.target.value })}
          />
        </div>

        <div style={fieldRowStyle}>
          <label style={labelStyle}>Resolution</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: spaceVar[2], flex: 1 }}>
            <TextInput
              type="number"
              className="vgai-input"
              style={{ width: 0, flex: 1 }}
              value={config.resolution.width}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v > 0) updateResolution('width', v);
              }}
            />
            <span style={{ fontSize: fontSizeVar.sm, color: text[3] }}>&times;</span>
            <TextInput
              type="number"
              className="vgai-input"
              style={{ width: 0, flex: 1 }}
              value={config.resolution.height}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v > 0) updateResolution('height', v);
              }}
            />
          </div>
        </div>

        <div style={fieldRowStyle}>
          <label style={labelStyle}>App ID</label>
          <TextInput
            className="vgai-input"
            style={{ flex: 1 }}
            value={config.appId}
            onChange={(e) => updateConfig({ appId: e.target.value })}
          />
        </div>

        <div style={{ ...fieldRowStyle, marginTop: spaceVar[2] }}>
          <label style={labelStyle}>Output</label>
          <span style={{ fontSize: fontSizeVar.md, color: text[2] }}>
            {artifact ?? 'Artifact appears here after a build'}
          </span>
        </div>

        {/* Action row: Build / Cancel / result — the log itself streams into
            the Build Output utility (the split's whole point). */}
        <div
          style={{
            marginTop: spaceVar[6],
            display: 'flex',
            alignItems: 'center',
            gap: spaceVar[4],
            paddingTop: spaceVar[4],
            borderTop: `1px solid ${border[1]}`,
          }}
        >
          {phase === 'building' ? (
            <>
              <span style={{ fontSize: fontSizeVar.md, fontWeight: 600, color: accent }}>
                Building for {TARGETS.find((t) => t.id === session.target)?.label ?? session.target}
                … (log in Build Output below)
              </span>
              <Button size="compact" onClick={cancelBuild}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {phase === 'done' && session.result && (
                <span
                  data-testid="build-profiles-result"
                  style={{
                    fontSize: fontSizeVar.md,
                    fontWeight: 600,
                    color: session.result.ok ? success : danger,
                  }}
                >
                  {session.result.ok
                    ? '✓ Build complete'
                    : `✗ Build failed (exit ${session.result.code ?? 'unknown'})`}
                </span>
              )}
              {phase === 'done' && session.result?.ok && artifact && (
                <a
                  href={getDownloadUrl(artifact)}
                  download={artifact}
                  className="vgai-btn"
                  data-variant="secondary"
                  data-size="default"
                  style={{
                    textDecoration: 'none',
                    display: 'inline-flex',
                  }}
                >
                  Download
                </a>
              )}
              <Button
                variant="primary"
                data-testid="build-profiles-build"
                onClick={() => {
                  if (!selected) return;
                  if (phase === 'done') resetBuildSession();
                  void startBuild(selected);
                }}
                style={{ marginLeft: 'auto' }}
              >
                {phase === 'done' ? 'Build Again' : 'Build'}
              </Button>
            </>
          )}
        </div>

        {phase === 'done' && session.result?.report && (
          <BuildReportSummary report={session.result.report} />
        )}
      </div>
    </div>
  );
}

function BuildReportSummary({ report }: { report: BuildReport }) {
  const largest = report.largestFiles[0]?.bytes ?? 1;
  return (
    <section
      data-testid="build-report"
      style={{
        marginTop: spaceVar[6],
        paddingTop: spaceVar[5],
        borderTop: `1px solid ${border[1]}`,
      }}
    >
      <div style={sectionHeaderStyle}>Build report</div>
      <div style={{ display: 'flex', gap: spaceVar[4], marginBottom: spaceVar[5] }}>
        <BuildMetric label="Package" value={formatBytes(report.artifactBytes)} />
        <BuildMetric label="Output" value={formatBytes(report.outputBytes)} />
        <BuildMetric label="Files" value={String(report.fileCount)} />
      </div>
      <div style={{ fontSize: fontSizeVar.sm, color: text[3], marginBottom: spaceVar[2] }}>
        Largest output files
      </div>
      <div style={{ display: 'grid', gap: 3 }}>
        {report.largestFiles.slice(0, 8).map((file) => (
          <div
            key={file.path}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) max-content',
              gap: spaceVar[3],
            }}
          >
            <div
              title={file.path}
              style={{ position: 'relative', minWidth: 0, overflow: 'hidden', borderRadius: 2 }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${Math.max(2, (file.bytes / largest) * 100)}%`,
                  background: 'color-mix(in srgb, var(--vgai-accent) 16%, transparent)',
                }}
              />
              <div
                style={{
                  position: 'relative',
                  padding: `${spaceVar[1]} ${spaceVar[2]}`,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: fontMono,
                  fontSize: fontSizeVar.sm,
                  color: text[2],
                }}
              >
                {file.path}
              </div>
            </div>
            <div
              style={{
                textAlign: 'right',
                padding: `${spaceVar[1]} 0`,
                fontSize: fontSizeVar.sm,
                color: text[2],
              }}
            >
              {formatBytes(file.bytes)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BuildMetric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: 1,
        padding: `${spaceVar[3]} ${spaceVar[4]}`,
        background: bg[2],
        borderRadius: radius.sm,
      }}
    >
      <div style={{ fontSize: fontSizeVar.sm, color: text[3] }}>{label}</div>
      <div
        style={{
          marginTop: spaceVar[1],
          fontSize: fontSizeVar.lg,
          fontWeight: 650,
          color: text[1],
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ---- Styles (carried from the old panel) ---- */

const targetListStyle: React.CSSProperties = {
  width: 160,
  flexShrink: 0,
  borderRight: `1px solid ${border[1]}`,
  overflowY: 'auto',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: fontSizeVar.sm,
  fontWeight: 700,
  textTransform: 'uppercase',
  color: text[3],
  letterSpacing: '0.05em',
  marginBottom: spaceVar[3],
};

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spaceVar[3],
  marginBottom: spaceVar[2],
};

const labelStyle: React.CSSProperties = {
  width: 65,
  fontSize: fontSizeVar.base,
  color: text[2],
  flexShrink: 0,
};
