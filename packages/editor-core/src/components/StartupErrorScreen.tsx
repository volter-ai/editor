import { EDITOR_BRAND } from '@volter/editor-sdk/session/editor-brand';
/**
 * StartupErrorScreen — the boot-failure surface.
 *
 * `boot-routing.ts` distinguishes `'project' | 'none' | 'unreadable' |
 * 'unknown'`, and ONLY `'none'` earns the launcher. The measured residual
 * after that fix was in the rendering: AppRoot's error state handed the
 * failure to the LAUNCHER, which drew its usual hub — recents, the gallery,
 * "What do you want to do?" — with a banner on top, and offered a Dismiss
 * that left the user on a plain launcher. So a server that WAS serving a
 * project it could not read looked, to a human or to an agent screenshotting
 * the tab, exactly like a fresh first run.
 *
 * This surface is that failure and nothing else: the alert, the two facts a
 * broken boot must name (the project the server is serving, and the server's
 * own error string), Retry, and an explicit — never implicit — way to leave
 * for the launcher. The launcher is a destination you choose here, not the
 * page you were silently given.
 *
 * It keeps `data-testid="project-detection-error"` on the shell root: that
 * attribute is what `product-shell.css` scopes the red-key-lit stage to, and
 * it has always been the launcher-vs-failure discriminator. What changed is
 * that it now selects a page with no launcher in it.
 */

import type { ServerProjectFailureReport } from '@volter/editor-sdk/kit/boot-routing';
import { BUNDLED_EDITOR_VERSION, BUNDLED_ENGINE_VERSION } from '../build-identity';
import { ErrorBanner, type ScreenError } from './ErrorBanner';
import { VgaiLogo } from '@volter/editor-sdk/kit/components/VgaiLogo';

export interface StartupErrorScreenProps {
  error: ScreenError;
  /** The structured server answer, when the failure came from the boot probe. */
  report?: ServerProjectFailureReport | undefined;
  onRetry: () => void;
}

export function StartupErrorScreen({ error, report, onRetry }: StartupErrorScreenProps) {
  // Tab accounting is NOT this component's job: AppRoot reports the route for
  // every surface it renders (this one included), so the tab bijection sees a
  // live tab that is simply not on the project — visible, never duplicated,
  // and adoptable the moment the project becomes readable again.
  return (
    <div className="vgai-shell" data-testid="project-detection-error">
      <div className="vgai-shell-container" data-view="startup-error">
        <header className="vgai-shell-header">
          <span className="vgai-shell-brand-static">
            <span className="vgai-shell-brand-mark" aria-hidden="true">
              <VgaiLogo size={30} />
            </span>
            <span className="vgai-shell-wordmark">{EDITOR_BRAND.name}</span>
          </span>
        </header>

        <ErrorBanner error={error} onRetry={onRetry} startup />

        {report?.projectPath && (
          <div className="vgai-shell-notice" data-testid="project-startup-serving">
            <span>
              This editor server is serving{' '}
              <code data-testid="project-startup-serving-path">{report.projectPath}</code> — the
              project exists; the editor could not read it. Fix the file it names above and press
              Retry.
            </span>
          </div>
        )}

        <footer className="vgai-shell-footer">
          <span className="vgai-chip" data-variant="tag">
            Editor v{BUNDLED_EDITOR_VERSION} · Engine v{BUNDLED_ENGINE_VERSION}
          </span>
        </footer>
      </div>
    </div>
  );
}
