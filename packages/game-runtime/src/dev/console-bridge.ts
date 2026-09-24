/**
 * Dev-mode console bridge.
 *
 * Monkey-patches console.log / warn / error to also broadcast each message
 * via `window.postMessage`. Any parent frame (IDE, editor, test harness) can
 * listen for these messages — if nobody is listening they simply go nowhere.
 *
 * Also captures unhandled errors and promise rejections.
 *
 * Call once, as early as possible in the entry point:
 *
 *   import { installConsoleBridge } from './console-bridge';
 *   if (import.meta.env.DEV) installConsoleBridge();
 */

export interface ConsoleBridgeMessage {
  type: 'console-bridge';
  level: 'log' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

const LEVELS = ['log', 'warn', 'error'] as const;

function post(level: ConsoleBridgeMessage['level'], message: string): void {
  const msg: ConsoleBridgeMessage = {
    type: 'console-bridge',
    level,
    message,
    timestamp: Date.now(),
  };
  window.postMessage(msg, '*');
}

function stringify(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

let installed = false;

export function installConsoleBridge(): void {
  // Idempotent: a second call must not double-patch console (which would
  // double-post every message) nor add duplicate window listeners.
  if (installed) return;
  installed = true;

  // Lazy import — avoid hard dep; if logger.ts isn't bundled the flag stays false
  let getFlag: () => boolean = () => false;
  import('./logger')
    .then((m) => {
      getFlag = () => m._engineLogActive;
    })
    .catch(() => {});

  // Patch console methods
  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      // Skip bridge posting when the engine logger is handling the message
      // (it posts its own structured 'engine-log' message instead)
      if (!getFlag()) post(level, stringify(args));
    };
  }

  // Capture unhandled errors
  window.addEventListener('error', (e) => {
    post('error', e.message || String(e.error));
  });

  window.addEventListener('unhandledrejection', (e) => {
    post('error', `Unhandled promise rejection: ${e.reason}`);
  });
}
