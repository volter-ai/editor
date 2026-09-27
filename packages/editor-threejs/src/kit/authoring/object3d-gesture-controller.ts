import type { ToolObject3DGesture, ToolObject3DPointerEvent } from '../../object3d-contributions';

export interface Object3DGestureControllerOptions {
  readonly begin: (event: ToolObject3DPointerEvent) => ToolObject3DGesture | null;
  readonly persist: (label?: string) => Promise<void>;
  readonly reportError: (error: unknown) => void;
}

/** Exactly one project gesture at a time; every terminal path is explicit. */
export class Object3DGestureController {
  private active: { pointerId: number; gesture: ToolObject3DGesture } | null = null;
  private settling = false;
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly options: Object3DGestureControllerOptions) {}

  begin(event: ToolObject3DPointerEvent): boolean {
    if (this.active || this.settling) return false;
    try {
      const gesture = this.options.begin(event);
      if (!gesture) return false;
      this.active = { pointerId: event.pointerId, gesture };
      return true;
    } catch (error) {
      this.options.reportError(error);
      return false;
    }
  }

  update(event: ToolObject3DPointerEvent): void {
    if (!this.active || this.active.pointerId !== event.pointerId) return;
    try {
      this.active.gesture.update(event);
    } catch (error) {
      void this.cancelWithError(error);
    }
  }

  async commit(event: ToolObject3DPointerEvent): Promise<boolean> {
    const active = this.take(event.pointerId);
    if (!active) return false;
    this.settling = true;
    try {
      await active.commit(event);
      await this.options.persist(active.label);
      return true;
    } catch (error) {
      try {
        await active.cancel();
      } catch (cancelError) {
        this.options.reportError({ operationError: error, rollbackError: cancelError });
        return false;
      }
      this.options.reportError(error);
      return false;
    } finally {
      this.settling = false;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }

  async cancel(pointerId?: number): Promise<boolean> {
    const active = this.take(pointerId);
    if (!active) return false;
    this.settling = true;
    try {
      await active.cancel();
      return true;
    } catch (error) {
      this.options.reportError(error);
      return false;
    } finally {
      this.settling = false;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }

  /** A source handoff waits for persistence/rollback, including pointer-up work. */
  async settle(): Promise<void> {
    if (this.active) await this.cancel();
    if (this.settling) await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  hasActiveGesture(): boolean {
    return this.active !== null;
  }

  private take(pointerId?: number): ToolObject3DGesture | null {
    if (!this.active || (pointerId !== undefined && this.active.pointerId !== pointerId))
      return null;
    const gesture = this.active.gesture;
    this.active = null;
    return gesture;
  }

  private async cancelWithError(error: unknown): Promise<void> {
    const active = this.take();
    if (!active) return;
    this.settling = true;
    try {
      await active.cancel();
      this.options.reportError(error);
    } catch (rollbackError) {
      this.options.reportError({ operationError: error, rollbackError });
    } finally {
      this.settling = false;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }
}
