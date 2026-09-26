import {
  Divider,
  EditorIcon,
  editorIcons,
  Inline,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Text,
} from '@volter/editor-sdk/widgets';
import {
  type ReactNode,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { activeProduct } from '@volter/editor-sdk/kit/active-product';
import { BUNDLED_EDITOR_VERSION } from '../build-identity';
import {
  contributedChromeVersion,
  contributedHeaderItems,
  subscribeContributedChrome,
} from '@volter/editor-sdk/kit/chrome-registry';
import { revealInFinder } from '@volter/editor-sdk/kit/editor-api';
import { getCurrentProject, onProjectChange } from '@volter/editor-sdk/kit/project-manager';
import {
  activeEditorWorkspace,
  editorWorkspaces,
  editorWorkspacesVersion,
  setEditorWorkspace,
  subscribeEditorWorkspace,
  subscribeEditorWorkspaces,
  workspaceApplies,
} from '@volter/editor-sdk/kit/workspace-presets';
import {
  activeChromeRegions,
  chromeRegionsVersion,
  subscribeChromeRegions,
} from '@volter/editor-sdk/kit/workspace-regions';
import { ApplicationMenus } from './ApplicationMenus';
import { ChromeSlot } from './ChromeSlot';
import { WorktreeSwitcher } from './WorktreeSwitcher';

export function ProjectHeader({
  transport,
}: {
  /** Controlled production transport for bounded hosts; the application
   * defaults to the connected PlayBar. */
  transport?: ReactNode | undefined;
}) {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onProjectChange(forceUpdate), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const project = getCurrentProject();
  const projectName = project?.config.name ?? 'No Project';
  const projectVersion = project?.config.version ?? null;
  const engineVersion = project?.config.engine.version ?? null;
  const manifestVersion = project?.config.manifestVersion ?? null;
  const projectPath = project?.rootPath ?? '';
  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <header className="vgai-project-header">
      {/* W5 (W4-reviewer candidate — transport narrow-width overlap guard):
          the header is now THREE flex columns — name (shrinkable, ellipsized)
          | transport (fixed) | right spacer — replacing the W4 absolute
          centering, which let the transport cluster overlap the project name
          at narrow widths. Equal-flex side columns keep the transport
          visually centered whenever space allows; flex items cannot overlap
          when it doesn't. */}
      {/* Project name — clickable dropdown trigger. The cluster wrapper is
          layout-neutral under bars chrome and becomes the LEFT glass island
          under islands chrome (P6-U3); the dropdown Menu stays a SIBLING of
          the island so the island's backdrop-filter never captures it. */}
      {activeProduct()?.nativeMenus ? (
        <div className="vgai-project-header-left" />
      ) : (
        <div ref={menuRef} className="vgai-project-header-left">
          <div className="vgai-project-header-cluster vgai-chrome-island vgai-glass-island">
            {/* THE LEADING ITEM IS A BARE GLYPH, and that is transcription, not
              economy. Blender opens its top bar with an app mark whose INK
              starts at the band's own inset and whose click opens a MENU —
              the mark IS the app menu's trigger. Measured on `topbar.png` at
              native 2x: device x 12..43, i.e. CSS 6.0..21.5 — 16.0 wide, 13.0
              tall — and the first menu word's ink follows at CSS 32.0. (The
              whole-frame read's "32 CSS px app mark" was that 32-DEVICE-px
              width read as CSS, and its "menu words start at 60" followed
              from it; the frame says 16 and 32.)

              Ours used to spend 67 px here on a padded pill drawing the
              project NAME, which ellipsized to `prob…` at 1728 even for an
              eight-character name, and the switcher beside it another 204.
              The project's identity is not lost by the glyph: it is the
              browser TAB's title (`AppRoot.tsx` writes `document.title` from
              the project name — the tab strip IS our OS title bar, the place
              Blender puts the file name), this button's tooltip and
              accessible name, and the first row of the menu it opens. */}
            <MenuTrigger
              data-testid="project-menu-trigger"
              aria-label={`${projectName} project menu`}
              title={projectPath ? `${projectName} — ${projectPath}` : projectName}
              onClick={() => setMenuOpen((v) => !v)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown') return;
                event.preventDefault();
                setMenuOpen(true);
              }}
              className="vgai-project-trigger"
            >
              <EditorIcon icon={editorIcons.content.project} />
              {/* The name stays in the DOM at zero pixels: the accessible name
                above is a LABEL, this is the element's CONTENT, and it is what
                `data-project` has always carried for the tooling that reads
                which project a session has open. */}
              <Text
                data-testid="project-name"
                data-project={projectName}
                data-project-version={projectVersion ?? undefined}
                variant="label"
                className="vgai-sr-only"
              >
                {projectName}
              </Text>
            </MenuTrigger>
            <WorktreeSwitcher />
            <Inline onPointerDown={() => setMenuOpen(false)} className="vgai-project-app-menus">
              <ApplicationMenus />
            </Inline>
          </div>
          <WorkspaceTabs />

          {menuOpen && (
            <Menu
              autoFocusFirst
              onDismiss={() => {
                const trigger = menuRef.current?.querySelector<HTMLButtonElement>(
                  '[data-testid="project-menu-trigger"]',
                );
                setMenuOpen(false);
                requestAnimationFrame(() => trigger?.focus());
              }}
              className="vgai-project-menu"
            >
              {/* IDENTITY'S READABLE HOME. The trigger is a glyph, so the name
                is the first thing this menu says — the row Blender's OS title
                bar carries and a browser window does not. */}
              <Text
                data-testid="project-menu-name"
                title={projectName}
                variant="label"
                truncate
                className="vgai-project-menu-name"
              >
                {projectName}
              </Text>
              {projectPath && (
                <Text
                  data-testid="project-menu-path"
                  title={projectPath}
                  variant="caption"
                  tone="dim"
                  selectable
                  truncate
                  className="vgai-project-path"
                >
                  {projectPath}
                </Text>
              )}
              {projectVersion && engineVersion && manifestVersion !== null && (
                <>
                  {projectPath && <MenuSeparator />}
                  <div data-testid="project-version-summary" className="vgai-project-versions">
                    <span>Editor</span>
                    <Text variant="code" tone="muted">
                      v{BUNDLED_EDITOR_VERSION}
                    </Text>
                    <span>Project</span>
                    <Text variant="code" tone="muted">
                      v{projectVersion}
                    </Text>
                    <span>Engine</span>
                    <Text variant="code" tone="muted">
                      v{engineVersion}
                    </Text>
                    <span>Format</span>
                    <Text variant="code" tone="muted">
                      v{manifestVersion}
                    </Text>
                  </div>
                  <MenuSeparator />
                </>
              )}
              {projectPath && (
                <MenuItem
                  onSelect={() => {
                    setMenuOpen(false);
                    revealInFinder(projectPath);
                  }}
                >
                  Show in Finder
                </MenuItem>
              )}
              <MenuItem
                data-testid="project-menu-history"
                onSelect={() => {
                  setMenuOpen(false);
                  window.dispatchEvent(new CustomEvent('editor:show-history-tab'));
                }}
              >
                {/* §8 naming: `Undo History`, never plain `History` (git/version
                  confusion). */}
                Undo History…
              </MenuItem>
            </Menu>
          )}
        </div>
      )}
      {/* W4 (§4.1/§9 W4, inventory row V4 + the recorded always-visible-
          transport work item): the global TRANSPORT cluster lives in the
          command bar — reachable regardless of which center document is
          active (asset/story docs used to hide play/pause/stop entirely).
          Centered in the row, matching the §4.1 mock's `>  ||  >`. */}
      <Inline
        data-testid="header-transport"
        className="vgai-project-transport vgai-chrome-island vgai-glass-island"
        align="center"
      >
        {transport ?? <ProjectTransport />}
      </Inline>
      {/* Conversation entry moved to the global bottom shell row. Keep this
          equal-width spacer so transport remains visually centered. */}
      <Inline className="vgai-project-header-right" justify="end" align="center">
        {/* WHO IS IN THIS SESSION. A chrome slot, not a component: the host
            owns the place and a package owns what sits there
            (`chrome-slot-registry.ts`). `@vgai/collaboration` fills it; a
            build without that package renders nothing here, which is the
            honest answer for an editor nobody else is in. */}
        <ChromeSlot slot="header-trailing" />
      </Inline>
      {/* SaveStatus moved OUT of this command header (H3): status is status,
          not a command — it renders in the W4 status bar
          (`status-contributions.tsx`). */}
    </header>
  );
}

/**
 * The WORKSPACE TAB STRIP — Blender's top bar, shown only when the active
 * chrome regions say so (`workspaceTabs`, a workspace's region or the person's;
 * Blender's workspaces turn it on). A click is the explicit act the workspace
 * ruling requires (`workspace-presets.ts`); the strip derives nothing.
 */
function WorkspaceTabs() {
  useSyncExternalStore(subscribeChromeRegions, chromeRegionsVersion, chromeRegionsVersion);
  useSyncExternalStore(subscribeEditorWorkspaces, editorWorkspacesVersion, editorWorkspacesVersion);
  const active = useSyncExternalStore(
    subscribeEditorWorkspace,
    activeEditorWorkspace,
    activeEditorWorkspace,
  );
  if (activeChromeRegions().workspaceTabs !== 'shown') return null;
  const workspaces = editorWorkspaces().filter((entry) => workspaceApplies(entry.id));
  return (
    <>
      {/* Blender closes its menu words with a 1x20 rule before the workspace
          tabs begin (measured `topbar.png`, halved: a #2e2e2e rule sitting 16px
          past `Help`'s ink). Without it the two regions read as one
          undifferentiated run of words, which is what ours did. It belongs to
          the strip, so it appears and disappears with it. */}
      <Divider orientation="vertical" className="vgai-project-menu-rule" />
      <div
        role="tablist"
        aria-label="Workspaces"
        data-testid="workspace-tabs"
        className="vgai-workspace-tabs"
      >
        {workspaces.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === active}
            title={entry.description}
            className="vgai-workspace-tab"
            onClick={() => setEditorWorkspace(entry.id)}
          >
            {entry.title}
          </button>
        ))}
      </div>
    </>
  );
}

/** The global transport cluster: whatever the project's packages contribute
 *  to the header (`@volter/editor-sdk/chrome`, `.header`) — the Play transport
 *  ships with `@vgai/game`; a folder of models contributes nothing here. */
function ProjectTransport() {
  useSyncExternalStore(
    subscribeContributedChrome,
    contributedChromeVersion,
    contributedChromeVersion,
  );
  const items = contributedHeaderItems();
  if (items.length === 0) return null;
  return (
    <>
      {items.map(({ id, Component }) => (
        <Component key={id} documentId="" />
      ))}
    </>
  );
}
