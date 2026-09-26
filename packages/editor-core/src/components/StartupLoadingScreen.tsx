import { EDITOR_BRAND } from '@volter/editor-sdk/session/editor-brand';
import { VgaiLogo } from './VgaiLogo';

/**
 * How long the wait has been going on, once it has stopped being instant.
 *
 * A boot that is still working is not the same page as a boot that answered in
 * 200ms, and pretending otherwise is what made the old deadline attractive:
 * with nothing on screen distinguishing them, "still opening" reads as "hung",
 * and the fix looked like a timeout. Naming the ask and counting the seconds
 * makes waiting legible, which is what lets the editor wait as long as it takes.
 */
export interface StartupWait {
  /** Whole seconds since the first detection attempt started. */
  seconds: number;
  /** The last attempt's own error, verbatim — never paraphrased. */
  detail?: string | undefined;
}

export interface StartupLoadingScreenProps {
  /** Present once a detection attempt has failed and the editor is re-asking. */
  wait?: StartupWait | undefined;
}

/** Lightweight first paint while the local project is being detected and validated. */
export function StartupLoadingScreen({ wait }: StartupLoadingScreenProps = {}) {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-label="Opening project"
      data-testid="startup-loading-screen"
      className="vgai-splash"
    >
      <div className="vgai-splash-stack">
        <div aria-hidden="true" className="vgai-splash-logo">
          {/* §5-R cinematic boot: the mark is the key-lit subject — hub
           * empty-state scale, blooming in the splash's key light. */}
          <VgaiLogo size={72} />
        </div>

        <div className="vgai-splash-title">{EDITOR_BRAND.name}</div>

        <div aria-hidden="true" className="vgai-splash-progress" />

        {wait ? (
          <>
            <div className="vgai-splash-status" data-testid="startup-wait-status">
              {`Asking the server which project it serves — ${wait.seconds}s`}
            </div>
            <div className="vgai-splash-note">
              Still trying. The first boot of a fresh checkout can take a while, so this keeps
              asking until the server answers.
            </div>
            {wait.detail ? (
              <div className="vgai-splash-note">Last attempt: {wait.detail}</div>
            ) : null}
          </>
        ) : (
          <div className="vgai-splash-status">Opening project…</div>
        )}
      </div>
    </main>
  );
}
