/**
 * WHICH MODE THE EDITOR IS IN — one predicate, in a leaf module.
 *
 * It lives here rather than beside its first reader because it has two kinds of
 * reader now, and they must never drift: `coverage/session-vitals.ts` asks so
 * the `edit-mode-static` invariant can judge the session, and the ingest mount
 * paths ask so a freshly-loaded game can be HELD at design time
 * (`ingest/ingest-play-control.ts`'s `ingestContentTimeForMode`). An instrument
 * must not be an import of the thing it measures, so neither owns it.
 *
 * MODE IS A SESSION, NOT A LOOP — and reading it off the loops is the one
 * mistake that would make the Edit-static check unable to fire.
 *
 * A first-party play, deferred-ingest play, module session, or explicit ingest
 * ▶ exists because somebody asked the host to run content; that is the editor
 * being in Play. An ingest loop merely TURNING is still not a mode — it is the
 * condition "ingested games autoplay in Edit" describes. `ingestPlaying()` is
 * safe to use here because it is NOT inferred from a moving loop: it is the
 * host play-control latch, written only when that control releases or holds the
 * required ingest pause surface. A game advancing behind the host's back cannot
 * set it and therefore remains visible to the Edit-static invariant.
 */

import { anyLiveSessionPlaying } from '@volter/editor-sdk/kit/live-session-registry';

/** The editor is in Play when any registered lane is playing
 *  (`live-session-registry.ts`): first-party Play, a deferred-ingest play, an
 *  ingest ▶ held by the host play-control latch, a module session. */
export function editorIsPlaying(): boolean {
  return anyLiveSessionPlaying();
}

/**
 * Whether a gesture closed RIGHT NOW is an AUTHORING edit — the question every
 * source-write backend asks before it moves a byte
 * (`authoring/source-persistence-backend.ts` and the two backends behind it).
 *
 * What an edit means is decided by the surface it is made on: a HELD world is
 * being authored and the gesture belongs in the game's own source; a RUNNING
 * one is being played, and a play-time edit is session-local.
 * {@link editorIsPlaying} owns that whole answer, including the ingest play
 * control, rather than making every caller remember a second condition. Play
 * adoption normally hands its adapters no source backend at all, but not every
 * world in a play session gets that treatment (`play-mode.ts` composes
 * non-presented worlds with `structuralThree`, which carries one), so the
 * mode is asked here rather than trusted to the composition.
 *
 * The converse case is what decides the shape: an ingest boot-mounted into the
 * Game document and HELD on its title screen is being AUTHORED. So the test is
 * the loop's state, never which document the mount happens to live in.
 */
export function editorIsAuthoring(): boolean {
  return !editorIsPlaying();
}
