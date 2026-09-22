/**
 * A CODING HARNESS IS NOT A PROVIDER (owner ruling, 2026-09-21; docs/ARCHITECTURE-CORE.md
 * §Managed services). Claude Code, Codex, Grok and every harness Supercode runs are
 * programs the person has ALREADY signed into, so the DEFAULT launch injects nothing —
 * no model key, no base URL, no provider config — and a harness that is not signed in is
 * refused BY NAME with its own login command instead of being routed to a metered key.
 *
 * `managedInferenceLaunch` below is the ONE opt-in exception: the OpenRouter provider
 * table a person reaches only by choosing managed or BYOK coding inference for
 * themselves in the account panel. Its single caller is `withCodingInference` at the
 * bottom of this file, which reads that explicit `preferredRoute` and passes the backend
 * params through untouched for every other value — `'auto'` is not a choice.
 * `scripts/validate-harness-launch.mjs` refuses any provider credential or provider
 * config written outside that one function, and refuses it gaining a second caller.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ResolvedCodingInference } from './account-service';

export interface HarnessRuntimeLaunch {
  program: string;
  arguments: string[];
  env: Record<string, string>;
}

/** What Supercode's own inventory says about a harness the person would run on their
 * own login. `repair` is Supercode's registry text — the login or install command for
 * that exact harness — and is quoted verbatim rather than restated here. */
export interface HarnessReadiness {
  id: string;
  label: string;
  installed: boolean;
  auth: 'ready' | 'configured' | 'required' | 'unknown';
  reason: string | null;
  repair: string | null;
}

interface RuntimeBackendParams {
  harness?: unknown;
  launch?: unknown;
  [key: string]: unknown;
}

/** The opt-in sentence every refusal ends with: the other way out is the account panel. */
const OPT_IN_HINT =
  'or choose managed inference for this harness in the account panel (Account → Generation routing → Preferred route).';

function toml(value: string): string {
  return JSON.stringify(value);
}

function openCodeModel(model: string): string {
  return `openrouter/${model}`;
}

/**
 * THE OPT-IN, AND THE ONLY PLACE IN THE ESTATE THAT MAY WRITE A PROVIDER CREDENTIAL OR
 * PROVIDER CONFIG INTO A HARNESS LAUNCH. Everything the table needs — the process token
 * name, the Pi extension it materializes — lives inside this function so the guard's
 * span is exactly this function and nothing leaks to module scope.
 *
 * Reached only by a person who chose managed or BYOK coding inference for themselves
 * because they have no subscription for this harness. Returns `undefined` for a harness
 * whose CLI takes no provider configuration at all — Grok is the measured case
 * (`grok --help`, 1.0.40: `login`/`logout` subcommands and `--model`, but no provider,
 * base-URL or API-root option; Supercode's own `runtime_launch`, `HarnessId::GROK` in
 * `crates/harness/src/harness_service.rs`, starts it as `grok … agent … stdio` with only
 * `GROK_AGENT_DASHBOARD=0` in its env) — so Grok is device-login only and the caller
 * refuses the opt-in for it by name.
 */
export async function managedInferenceLaunch(
  harness: string,
  inference: ResolvedCodingInference,
  piExtensionPath: string,
): Promise<HarnessRuntimeLaunch | undefined> {
  const PROCESS_TOKEN = 'VGAI_OPENROUTER_TOKEN';
  const commonEnv = {
    [PROCESS_TOKEN]: inference.apiKey,
    OPENROUTER_API_KEY: inference.apiKey,
  };
  if (harness === 'codex') {
    const provider = 'vgai-openrouter';
    return {
      program: 'codex',
      arguments: [
        '--dangerously-bypass-approvals-and-sandbox',
        '--dangerously-bypass-hook-trust',
        '-c',
        `model_provider=${toml(provider)}`,
        '-c',
        `model=${toml(inference.model)}`,
        '-c',
        `model_providers.${provider}.name=${toml('OpenRouter via Volter Editor')}`,
        '-c',
        `model_providers.${provider}.base_url=${toml(inference.baseUrl)}`,
        '-c',
        `model_providers.${provider}.env_key=${toml(PROCESS_TOKEN)}`,
        '-c',
        `model_providers.${provider}.wire_api=${toml('responses')}`,
        'app-server',
      ],
      env: commonEnv,
    };
  }
  if (harness === 'claude-code') {
    return {
      program: 'claude',
      arguments: [
        '--dangerously-skip-permissions',
        '--model',
        inference.model,
        '--print',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
      ],
      env: {
        ...commonEnv,
        ANTHROPIC_BASE_URL: inference.baseUrl.replace(/\/v1$/, ''),
        ANTHROPIC_AUTH_TOKEN: inference.apiKey,
        ANTHROPIC_API_KEY: '',
      },
    };
  }
  if (harness === 'opencode') {
    return {
      program: 'opencode',
      arguments: ['--model', openCodeModel(inference.model), 'serve'],
      env: {
        ...commonEnv,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          provider: {
            openrouter: {
              options: {
                apiKey: `{env:${PROCESS_TOKEN}}`,
                baseURL: inference.baseUrl,
              },
              models: { [inference.model]: {} },
            },
          },
        }),
      },
    };
  }
  if (harness === 'pi') {
    const managed = inference.route === 'managed';
    if (managed) {
      await mkdir(dirname(piExtensionPath), { recursive: true, mode: 0o700 });
      await writeFile(
        piExtensionPath,
        `export default function vgaiOpenRouter(pi) {
  const baseUrl = process.env.VGAI_OPENROUTER_BASE_URL;
  if (!baseUrl) throw new Error('VGAI_OPENROUTER_BASE_URL is required.');
  pi.registerProvider('openrouter', { baseUrl, apiKey: '$OPENROUTER_API_KEY' });
}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
    }
    return {
      program: 'pi',
      arguments: [
        '--approve',
        '--provider',
        'openrouter',
        '--model',
        inference.model,
        ...(managed ? ['--extension', piExtensionPath] : []),
        '--mode',
        'rpc',
      ],
      env: {
        ...commonEnv,
        VGAI_OPENROUTER_BASE_URL: inference.baseUrl,
      },
    };
  }
  return undefined;
}

/**
 * The sentence a person sees instead of a silently metered harness. `null` means start
 * it on the login they already did.
 *
 * `'required'` is the only auth state that means NOT SIGNED IN: Supercode sets it when
 * it either found no native credential or watched the handshake fail with an auth error.
 * `'unknown'` is Supercode explicitly declining to give a verdict — measured 2026-09-21,
 * OpenCode reads `unknown` passively and `ready` under a handshake — so it is never a
 * refusal here; the caller escalates the probe first, and a harness that still cannot be
 * classified starts and reports its own error rather than being convicted on silence.
 */
export function harnessReadinessRefusal(readiness: HarnessReadiness): string | null {
  if (!readiness.installed) {
    const repair = readiness.repair ?? `Install ${readiness.label} and put its command on PATH`;
    return `${readiness.label} is not installed on this machine, so there is nothing to sign in to. ${repair} — ${OPT_IN_HINT}`;
  }
  if (readiness.auth !== 'required') return null;
  const repair =
    readiness.repair ?? `Run \`supercode harness login ${readiness.id}\` and complete sign-in`;
  return `${readiness.label} is not signed in on this machine, and Volter Editor never starts a harness on an account credential. ${repair} — ${OPT_IN_HINT}`;
}

/**
 * The launch seam. By default it hands Supercode the backend params UNCHANGED so the
 * stock CLI starts on the login the person already did, after asking Supercode whether
 * that harness is ready; only an explicit `preferredRoute` of `'managed'` or `'byok'`
 * reaches `managedInferenceLaunch`.
 */
export async function withCodingInference(
  params: unknown,
  resolveInference: () => Promise<ResolvedCodingInference | null>,
  piExtensionPath: string,
  readHarnessReadiness: (harness: string) => Promise<HarnessReadiness | null>,
): Promise<unknown> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const backend = params as RuntimeBackendParams;
  if (backend.launch !== undefined || typeof backend.harness !== 'string') return params;
  const harness = backend.harness;
  const inference = await resolveInference();
  const preferredRoute = inference?.preferredRoute ?? 'auto';
  if (preferredRoute !== 'managed' && preferredRoute !== 'byok') {
    const readiness = await readHarnessReadiness(harness);
    const refusal = readiness ? harnessReadinessRefusal(readiness) : null;
    if (refusal) throw new Error(refusal);
    return params;
  }
  if (!inference) return params;
  const launch = await managedInferenceLaunch(harness, inference, piExtensionPath);
  if (!launch) {
    throw new Error(
      `${harness} takes no provider configuration — it runs on its own device login only. Sign in with \`supercode harness login ${harness}\`, or pick a harness managed inference can configure (Codex, Claude Code, OpenCode, Pi).`,
    );
  }
  return { ...backend, launch };
}
