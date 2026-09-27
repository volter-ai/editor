import { BlankTransport, LogLayer, LogLevel } from 'loglayer';

/**
 * Flag set while the engine logger is calling console.* so that the
 * console-bridge and play-mode patches can skip re-forwarding.
 * JS is single-threaded so this is safe.
 */
export let _engineLogActive = false;

const CONSOLE_MAP: Record<string, 'log' | 'warn' | 'error'> = {
  trace: 'log',
  debug: 'log',
  info: 'log',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};

const engineLog = new LogLayer({
  transport: new BlankTransport({
    shipToLogger: ({ logLevel, messages, data, hasData }) => {
      const method = CONSOLE_MAP[logLevel] ?? 'log';

      // Extract _sub (subsystem tag) from data, pass the rest as metadata
      let subsystem: string | undefined;
      let metadata: Record<string, unknown> | undefined;
      if (hasData && data) {
        const { _sub, ...rest } = data as Record<string, unknown>;
        subsystem = _sub ? String(_sub) : undefined;
        if (Object.keys(rest).length > 0) metadata = rest;
      }

      // Call console for browser devtools
      _engineLogActive = true;
      if (metadata) {
        // biome-ignore lint/suspicious/noConsole: intentional — this IS the logger
        console[method](...messages, metadata);
      } else {
        // biome-ignore lint/suspicious/noConsole: intentional — this IS the logger
        console[method](...messages);
      }
      _engineLogActive = false;

      // Post structured message for editor console
      if (typeof window !== 'undefined') {
        window.postMessage(
          {
            type: 'engine-log',
            level: logLevel,
            message: messages.join(' '),
            subsystem,
            metadata,
            timestamp: Date.now(),
          },
          '*',
        );
      }

      return messages;
    },
  }),
  prefix: '[engine]',
});

// Default to 'info' — debug/trace are off unless explicitly enabled
engineLog.setLevel(LogLevel.info);

export interface LogMeta {
  entityId?: string | number | undefined;
  [key: string]: unknown;
}

interface SubsystemLogger {
  debug(msg: string, meta?: LogMeta): void;
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
}

function createSubsystemLogger(subsystem: string): SubsystemLogger {
  return {
    debug: (msg, meta) =>
      engineLog.withMetadata({ ...meta, _sub: subsystem }).debug(`[${subsystem}] ${msg}`),
    info: (msg, meta) =>
      engineLog.withMetadata({ ...meta, _sub: subsystem }).info(`[${subsystem}] ${msg}`),
    warn: (msg, meta) =>
      engineLog.withMetadata({ ...meta, _sub: subsystem }).warn(`[${subsystem}] ${msg}`),
    error: (msg, meta) =>
      engineLog.withMetadata({ ...meta, _sub: subsystem }).error(`[${subsystem}] ${msg}`),
  };
}

// Pre-built subsystem loggers — all share the same LogLayer instance
// so setLevel() on engineLog affects all of them.
export const log = {
  scene: createSubsystemLogger('scene'),
  physics: createSubsystemLogger('physics'),
  animation: createSubsystemLogger('animation'),
  network: createSubsystemLogger('network'),
  audio: createSubsystemLogger('audio'),
  ai: createSubsystemLogger('ai'),
  input: createSubsystemLogger('input'),
  core: createSubsystemLogger('core'),
};

export { engineLog };

// Expose to browser devtools: type setEngineLogLevel('debug') in console
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)['setEngineLogLevel'] = (level: string) => {
    engineLog.setLevel(level as LogLevel);
  };
}

// URL param override: ?engineLogLevel=debug
if (typeof window !== 'undefined') {
  const level = new URLSearchParams(window.location.search).get('engineLogLevel');
  if (level) engineLog.setLevel(level as LogLevel);
}
