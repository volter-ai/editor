import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProjectProviderExecution } from '@volter/editor-sdk/tools/types';

export const GENERATIVE_EXECUTION_RECORDER = Symbol.for('vgai.generative-execution-recorder.v1');

type ExecutionFacts = ProjectProviderExecution;

interface ExecutionCapture {
  pending: ExecutionFacts[];
}

const captures = new AsyncLocalStorage<ExecutionCapture>();

function sameNativeExecution(left: ExecutionFacts, right: ExecutionFacts): boolean {
  if (left.mode !== right.mode || left.provider !== right.provider) return false;
  if (left.requestId && right.requestId) return left.requestId === right.requestId;
  if (left.taskId && right.taskId) return left.taskId === right.taskId;
  if (left.managedJobId && right.managedJobId) return left.managedJobId === right.managedJobId;
  return JSON.stringify(left) === JSON.stringify(right);
}

function validFacts(value: unknown): value is ExecutionFacts {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ExecutionFacts>;
  return (
    (candidate.mode === 'mock' || candidate.mode === 'direct' || candidate.mode === 'managed') &&
    typeof candidate.provider === 'string' &&
    candidate.provider.length > 0
  );
}

function installRecorder(): void {
  const globals = globalThis as typeof globalThis & { [GENERATIVE_EXECUTION_RECORDER]?: unknown };
  if (globals[GENERATIVE_EXECUTION_RECORDER] !== undefined) return;
  globals[GENERATIVE_EXECUTION_RECORDER] = (facts: unknown) => {
    if (!validFacts(facts)) return;
    captures.getStore()?.pending.push({ ...facts });
  };
}

installRecorder();

/** Runs one project tool with provider execution capture isolated across async work. */
export function runWithGenerativeExecutionCapture<T>(work: () => Promise<T>): Promise<T> {
  return captures.run({ pending: [] }, work);
}

/** Consumes the ordered native provider execution chain associated with the next output commit. */
export function consumeGenerativeExecutions(): ExecutionFacts[] {
  const capture = captures.getStore();
  if (!capture || capture.pending.length === 0) return [];
  const executions: ExecutionFacts[] = [];
  for (const facts of capture.pending.splice(0)) {
    const index = executions.findIndex((candidate) => sameNativeExecution(candidate, facts));
    if (index === -1) executions.push(facts);
    else executions[index] = { ...facts, ...executions[index] };
  }
  return executions;
}
