/**
 * THE DESIGN-TIME SURFACE REGISTRY — every place the editor mounts a game's own
 * content while it is NOT playing, and the content clock each one publishes.
 *
 * ## CONTENT time vs PRESENTATION time (the one policy, stated once)
 *
 * A design-time surface renders continuously, and that is fine: the camera
 * orbit, a turntable, the standard viewport dressing and the editor's own
 * helpers are PRESENTATION and are editor-owned, so they may move while the
 * editor is in Edit. What may NOT move is CONTENT — the mounted world's
 * `update(dt)`, an animation mixer, a `useFrame` clock, a simulation step —
 * because Edit is static (ARCHITECTURE-CORE §Rules). An interactive document
 * may advance content only through its explicit animation/simulation transport;
 * opening the document itself never advances it. Off-screen capture operations
 * may request their own bounded settle before producing a still.
 *
 * ## WHY A REGISTRY, rather than a field on one surface's session class
 *
 * Edit-static was enforced at the Scene view's design session only, so the
 * SAME content mounted on any other surface kept running: a GLB train animated
 * in the Asset Lab while every instrument reported a still editor (owner find,
 * 2026-08-15). The check therefore enumerates SURFACES, and a surface that
 * publishes no clock is reported UNMEASURED BY NAME rather than assumed still —
 * silence is the one case that would let a surface animate in Edit with the
 * vitals green, which is the defect this registry exists to make impossible.
 *
 * A surface's clock is monotonic seconds of ITS OWN content time. Its absolute
 * value means nothing; `coverage/session-vitals.ts` only ever asks whether two
 * readings differ, which is what makes camera orbit (which never touches it)
 * irrelevant to the answer.
 *
 * ## THE TRANSPORT IS THE SANCTION
 *
 * "Edit is static" has always meant *nothing plays on its own* — the origin
 * note behind the row says it out loud: a game running "with nothing having
 * pressed ▶". A document's own animation/simulation transport IS that press,
 * so content time advancing WHILE a transport is engaged is the sanctioned
 * case, not the violation. A surface therefore publishes a second reading
 * beside its clock: how many times an ENGAGED transport advanced it
 * ({@link DesignTimeSurface.transportAdvances}). The row fires only when the
 * clock moved and that counter did not.
 */

export interface DesignTimeSurface {
  /**
   * Stable per MOUNT — the document id only for the one mount that IS the
   * document. Two mounts of one document (its viewport and a chromeless
   * preview of it) are two surfaces: registration is last-wins and the vitals
   * consumer keys its per-window sample history by this id, so a shared id
   * makes the survivor answer for both — a held preview clock once spoke for a
   * viewport that was visibly animating (measured 2026-08-30). Suffix, or
   * sequence, anything that is not the document itself.
   */
  readonly id: string;
  /** What the vitals row calls it out loud. */
  readonly label: string;
  /**
   * Monotonic seconds of THIS surface's content time, or `null` when the host
   * cannot currently make an honest comparison. Interactive document boot is
   * never such a window: it publishes zero immediately because it performs no
   * hidden simulation.
   */
  readonly contentClock: () => number | null;
  /**
   * Monotonic count of the times an ENGAGED transport (this document's
   * animation transport, its simulation transport's play or step) advanced
   * this surface's content time.
   *
   * Compared the same way the clock is: two readings, and only whether they
   * DIFFER. A counter — not a "is a transport playing right now" boolean —
   * because the question is about the window BETWEEN two samples, and a
   * boolean answers about the instant of the sample: a single-frame step, or
   * a transport paused between two reads, would both report "nothing engaged"
   * over a window in which a transport was the only thing that ran.
   *
   * A surface that omits this publishes no transport at all, so ANY advance of
   * its clock is unsanctioned — which is the honest reading for a surface (a
   * preview card, a turntable) that has no ▶ to press.
   */
  readonly transportAdvances?: () => number;
}

const surfaces = new Map<string, DesignTimeSurface>();

/**
 * Publish one live design-time surface. Returns its withdrawal — the ONE
 * teardown path, and it is safe to call after the id has been re-registered by
 * a later mount (it withdraws only its own entry).
 */
export function registerDesignTimeSurface(surface: DesignTimeSurface): () => void {
  surfaces.set(surface.id, surface);
  return () => {
    if (surfaces.get(surface.id) !== surface) return;
    surfaces.delete(surface.id);
  };
}

/** Every live design-time surface, for the vitals collector. */
export function allDesignTimeSurfaces(): readonly DesignTimeSurface[] {
  return [...surfaces.values()];
}
