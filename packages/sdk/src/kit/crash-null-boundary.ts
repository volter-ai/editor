/**
 * The ONE crash-to-null React error boundary: a render/lifecycle throw below
 * it reports through `onCaught` and unmounts the subtree (renders null) so a
 * misbehaving child fails loudly WITHOUT throwing out of `root.render()` or
 * taking its siblings down. Class-based by necessity — React has no hook
 * equivalent for `getDerivedStateFromError`.
 *
 * Four copies of this exact component existed (ingest siblings, design-time
 * layers, both story preview mounts) before this home; a fifth copy is the
 * defect, not a convenience. Rung note: `react-error-boundary` ships this
 * shape — adopting it is the right move the next time the editor's
 * dependency set is being changed anyway; twelve lines did not justify a
 * lockfile change on their own.
 */

import { Component, type ReactNode } from 'react';

export class CrashNullBoundary extends Component<
  {
    onCaught: (error: unknown) => void;
    /** Optional because `createElement` callers pass children VARIADICALLY. */
    children?: ReactNode;
  },
  { crashed: boolean }
> {
  override state = { crashed: false };
  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }
  override componentDidCatch(error: unknown): void {
    this.props.onCaught(error);
  }
  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}
