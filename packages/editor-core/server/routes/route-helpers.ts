/**
 * The helpers shared across `register<Family>Routes` modules — extracted with
 * the routes that already used them when they moved out of `editor-server.ts`.
 * Route bodies themselves are byte-preserved by the split; nothing here
 * changes what any route answers.
 */

import type { Request, Response } from 'express';

/**
 * An `AbortSignal` that fires when the CLIENT gives up, so a long git or
 * network operation stops with the request that asked for it rather than
 * running to completion for nobody.
 */
export function requestOperationSignal(req: Request): AbortSignal {
  const controller = new AbortController();
  req.once('aborted', () => controller.abort());
  return controller.signal;
}

/**
 * The share-host verbs' error answer. 409 for the one recoverable case (the
 * owner has to open their editor tab before a host identity can be bound),
 * 400 for everything else.
 */
export function shareControlError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(message.includes('Open the local editor tab') ? 409 : 400).json({ error: message });
}
