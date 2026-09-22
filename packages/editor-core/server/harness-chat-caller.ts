export type HarnessChatCallerHarness = 'claude-code' | 'codex';

export interface HarnessChatCallerSession {
  harness: HarnessChatCallerHarness;
  sessionId: string;
}

const HARNESSES = new Set<HarnessChatCallerHarness>(['claude-code', 'codex']);
const SESSION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/;

function parseHarnessChatCallerSession(value: unknown): HarnessChatCallerSession {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Coding-session context must be an object.');
  }
  const record = value as Record<string, unknown>;
  const harness = record['harness'];
  const sessionId = record['sessionId'];
  if (
    typeof harness !== 'string' ||
    !HARNESSES.has(harness as HarnessChatCallerHarness) ||
    typeof sessionId !== 'string' ||
    !SESSION_ID_PATTERN.test(sessionId)
  ) {
    throw new Error('Coding-session context requires a supported harness and sessionId.');
  }
  return { harness: harness as HarnessChatCallerHarness, sessionId };
}

export function harnessChatCallerSessionFromEnv(
  env: Record<string, string | undefined> = process.env,
): HarnessChatCallerSession | null {
  const harness = env['VGAI_CALLER_HARNESS'];
  const sessionId = env['VGAI_CALLER_SESSION_ID'];
  if (harness === undefined && sessionId === undefined) return null;
  return parseHarnessChatCallerSession({ harness, sessionId });
}
