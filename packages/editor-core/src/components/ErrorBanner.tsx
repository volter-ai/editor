/**
 * The one error card the pre-editor surfaces render.
 *
 * Two moods, one component:
 * - `inline` — an action failure (create/open/browse) above a surface the user
 *   is still using.
 * - `startup` — the BOOT failure, where the card is the page: the title is
 *   promoted to the page's only `<h1>` and the recovery command is labelled
 *   (`StartupErrorScreen`).
 *
 * It lives in its own module so the boot-failure surface does not have to
 * import the launcher to reuse the card — the whole point of that surface is
 * that the launcher is NOT on screen (PD-6/7 residual B: an unreadable
 * manifest rendered "What do you want to do?" with a banner over it, so a
 * loud server-side throw still looked like a fresh launcher in a screenshot).
 */

import { faCheck, faCopy, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { StartupRecovery } from '@volter/editor-sdk/session/editor-compatibility';
import { Button, EditorIcon } from '@volter/editor-sdk/widgets';
import { useEffect, useState } from 'react';

export interface ScreenError {
  message: string;
  recovery?: StartupRecovery;
}

export function ErrorBanner({
  error,
  onDismiss,
  onRetry,
  startup = false,
}: {
  error: ScreenError;
  onDismiss?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  startup?: boolean;
}) {
  const command = error.recovery && 'command' in error.recovery ? error.recovery.command : null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div role="alert" className="vgai-error-card vgai-shell-rise">
      <div className="vgai-error-card-icon" aria-hidden="true">
        <EditorIcon icon={faTriangleExclamation} />
      </div>
      <div className="vgai-error-card-body">
        {startup ? (
          <h1 className="vgai-error-card-title">
            {error.recovery?.title ?? 'Couldn’t open this project'}
          </h1>
        ) : (
          error.recovery && <div className="vgai-error-card-title">{error.recovery.title}</div>
        )}
        {error.recovery && <p className="vgai-error-card-guidance">{error.recovery.guidance}</p>}
        <div
          className="vgai-error-card-message"
          data-testid={startup ? 'project-startup-error-details' : undefined}
        >
          {error.message}
        </div>
        {command && (
          <div>
            {startup && (
              <div className="vgai-error-card-recovery-label">RUN FROM THE PROJECT FOLDER</div>
            )}
            <div className="vgai-error-card-command">
              <code
                data-testid={
                  startup ? 'project-startup-recovery-command' : 'project-screen-recovery-command'
                }
              >
                {command}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="compact"
                onClick={() => {
                  void navigator.clipboard?.writeText(command);
                  setCopied(true);
                }}
              >
                <EditorIcon icon={copied ? faCheck : faCopy} aria-hidden="true" />
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}
        <div className="vgai-error-card-actions">
          {onRetry && (
            <Button
              type="button"
              variant="primary"
              className="vgai-shell-cta"
              data-testid="retry-project-detection"
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
          {onDismiss && (
            <Button
              type="button"
              variant="ghost"
              className="vgai-shell-cta"
              aria-label="Dismiss error"
              onClick={onDismiss}
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
