/**
 * Downstream receipt emitted after the original command caller's response finishes.
 * The browser waits for it before scheduling deferred selection presentation.
 */
export const COMMAND_RESULT_RECEIPT_EVENT = 'command-result-received';
