/**
 * `gd-analyze run <imported-project> --frames N`: an imported project's world, mounted headlessly
 * through the harness the project-world and lifecycle proofs use (R3F's root on a stub canvas, the
 * Rapier build compat uses, the `?url` asset and callsite hooks), stepped N display frames at 60 Hz
 * with no input. Each frame's thrown error is printed with its full stack. The world runs in a
 * worker thread under a per-frame watchdog: a frame that exceeds its budget pauses the worker
 * through the inspector (`Debugger.pause`) and the paused call stack is printed, so a hang reports
 * where it spins, before the worker is terminated.
 */
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { NODE_MOUNT_IMPORTS } from '../evidence/node-assets';
import { EMITTED_RESOLVE_HOOK, linkEmittedNodeModules } from '../evidence/proofs/emitted-node-modules';

export interface RunWorldOptions {
  readonly frames: number;
  /** A frame (or the mount) taking longer than this is a hang (milliseconds). */
  readonly budgetMs: number;
  /** Profile the stepped frames (the inspector's sampling profiler) and print where time went. */
  readonly profile?: boolean;
  /** With `profile`, start sampling after this many frames (the warm-up left out). */
  readonly profileAfter?: number;
}

/** A sampled profile's self time by source-mapped function, the heaviest first. */
function profileSummary(
  profile: { readonly nodes: readonly { readonly id: number; readonly children?: readonly number[]; readonly callFrame: { readonly functionName: string; readonly scriptId: string; readonly url: string; readonly lineNumber: number; readonly columnNumber: number }; readonly hitCount?: number }[]; readonly startTime: number; readonly endTime: number },
  scripts: ReadonlyMap<string, { readonly url: string; readonly map: ScriptMap | undefined }>,
): string {
  const total = profile.nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0);
  const byFunction = new Map<string, number>();
  for (const node of profile.nodes) {
    const hits = node.hitCount ?? 0;
    if (hits === 0) continue;
    const frame = node.callFrame;
    const mapped = original(scripts.get(frame.scriptId)?.map, frame.lineNumber, frame.columnNumber);
    const where = mapped ?? `${frame.url}:${String(frame.lineNumber + 1)}`;
    const key = `${frame.functionName || '<anonymous>'} (${where.replace(/^.*\/(src|node_modules)\//u, '$1/')})`;
    byFunction.set(key, (byFunction.get(key) ?? 0) + hits);
  }
  const ms = (profile.endTime - profile.startTime) / 1000;
  const line = ([key, hits]: readonly [string, number]) => `  ${((hits / total) * 100).toFixed(1).padStart(5)}%  ${((hits / total) * ms).toFixed(0).padStart(6)} ms  ${key}`;
  // Inclusive time of the project's own functions (compat and scripts): each node's hits and its subtree's.
  const nodes = new Map(profile.nodes.map((node) => [node.id, node] as const));
  const inclusiveOf = new Map<number, number>();
  const inclusive = (id: number): number => {
    const known = inclusiveOf.get(id);
    if (known !== undefined) return known;
    const node = nodes.get(id);
    const sum = (node?.hitCount ?? 0) + (node?.children ?? []).reduce((acc, child) => acc + inclusive(child), 0);
    inclusiveOf.set(id, sum);
    return sum;
  };
  const byOwn = new Map<string, number>();
  const visit = (id: number, open: ReadonlySet<string>): void => {
    const node = nodes.get(id);
    if (node === undefined) return;
    const frame = node.callFrame;
    const mapped = original(scripts.get(frame.scriptId)?.map, frame.lineNumber, frame.columnNumber);
    let next = open;
    if (mapped !== undefined && /\/src\//u.test(mapped)) {
      const key = `${frame.functionName || '<anonymous>'} (${mapped.replace(/^.*\/src\//u, 'src/').replace(/:\d+$/u, '')})`;
      // Recursion counts once.
      if (!open.has(key)) {
        byOwn.set(key, (byOwn.get(key) ?? 0) + inclusive(id));
        next = new Set([...open, key]);
      }
    }
    for (const child of node.children ?? []) visit(child, next);
  };
  const rootNode = profile.nodes[0];
  if (rootNode !== undefined) visit(rootNode.id, new Set());
  return [
    'self time:',
    ...[...byFunction].sort((a, b) => b[1] - a[1]).slice(0, 15).map(line),
    'inclusive time of the project\'s functions:',
    ...[...byOwn].sort((a, b) => b[1] - a[1]).slice(0, 25).map(line),
  ].join('\n');
}

/** What the world driver posts from the worker. */
type WorkerReport =
  | { readonly kind: 'mounted'; readonly waitedMs: number }
  | { readonly kind: 'frame'; readonly frame: number; readonly ms: number; readonly physicsMs: number; readonly stepsMs: readonly number[]; readonly error?: string }
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly error: string };

/** The driver the worker runs, in the copied project (its imports resolve against it). */
const DRIVER = `import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import * as THREE from 'three';
import { advance, createRoot, extend } from '@react-three/fiber';
import { JSDOM } from 'jsdom';

const post = (report) => parentPort.postMessage(report);
const stackOf = (error) => (error instanceof Error ? (error.stack ?? String(error)) : String(error));
try {
  const require = createRequire(import.meta.url);
  // Physics timed on the real clock, each physics frame (a step; a frame holds as many as the
  // project's tick rate puts in it) apart from the frame (drawing, scripts' process).
  const realNow = globalThis.performance.now.bind(globalThis.performance);
  let stepsMs = [];
  let physicsBegan = 0;
  (await import('./src/lib/godot-compat/scene-tree')).godot_tree_observe_physics((phase) => {
    if (phase === 'begin') physicsBegan = realNow();
    else stepsMs.push(Math.round((realNow() - physicsBegan) * 10) / 10);
  });
  // The clock the world's main loop reads: advanced one 60 Hz frame per step.
  let now = 0;
  globalThis.performance.now = () => now;
  // What the page fetches: the capability's font (a file URL through the ?url hook) and the
  // project's imported assets under /public.
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (request, init) => {
    const text = typeof request === 'string' ? request : (request.url ?? String(request));
    // A loader's data URL (the models below) is fetched as it is.
    if (text.startsWith('data:')) return nativeFetch(request, init);
    const bytes = text.startsWith('file:') ? readFileSync(new URL(text)) : readFileSync('./public' + text);
    return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  const toData = (url) => (url.startsWith('/godot/') ? 'data:application/octet-stream;base64,' + readFileSync('./public' + url).toString('base64') : url);
  THREE.DefaultLoadingManager.setURLModifier(toData);
  require('three').DefaultLoadingManager.setURLModifier(toData);
  // The page compiles the WebP decoder from its asset URL; here it is handed over.
  const image = await import('./src/lib/godot-compat/image');
  image.godot_image_webp_module(await WebAssembly.compile(readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))));
  globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });
  // three's FileLoader reports progress with the page's ProgressEvent.
  globalThis.ProgressEvent ??= class extends Event {
    constructor(type, init = {}) { super(type); Object.assign(this, init); }
  };
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const canvas = dom.window.document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  dom.window.document.getElementById('host').appendChild(canvas);
  extend(THREE);
  const gl = {
    domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, getPixelRatio: () => 1,
    setAnimationLoop() {}, dispose() {}, shadowMap: {}, info: { render: {} }, capabilities: {},
    xr: { enabled: false, addEventListener() {}, removeEventListener() {}, setAnimationLoop() {} },
    getContext: () => ({}), toneMapping: 0, toneMappingExposure: 1, outputColorSpace: 'srgb',
  };
  const World = (await import('./src/world')).default;
  const root = createRoot(canvas);
  await root.configure({ gl, size: { width: 960, height: 540, top: 0, left: 0 }, frameloop: 'never' });
  const holder = { current: null };
  root.render(createElement('group', { ref: holder }, createElement(World)));
  // Mounted once the main scene is under the tree root (the font, the resources and Rapier load).
  const started = Date.now();
  while (Date.now() - started < workerData.mountMs && (holder.current?.children.length ?? 0) === 0) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  post({ kind: 'mounted', waitedMs: Date.now() - started });
  for (let frame = 1; frame <= workerData.frames; frame += 1) {
    now += 1000 / 60;
    let error;
    stepsMs = [];
    const began = Date.now();
    try {
      advance(now);
    } catch (thrown) {
      error = stackOf(thrown);
    }
    post({ kind: 'frame', frame, ms: Date.now() - began, physicsMs: Math.round(stepsMs.reduce((sum, ms) => sum + ms, 0) * 10) / 10, stepsMs, ...(error === undefined ? {} : { error }) });
    // Let the frame's promises (resource loads, React's commits) settle, as a page's would.
    await new Promise((resolve) => setImmediate(resolve));
  }
  post({ kind: 'done' });
  // A profiled run stays up until the profile is read.
  if (workerData.profile) await new Promise((resolve) => parentPort.once('message', resolve));
} catch (thrown) {
  post({ kind: 'failed', error: stackOf(thrown) });
}
`;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** A source map's segments by generated line: [generated column, source, line, column] (0-based). */
function decodeMappings(mappings: string): readonly (readonly (readonly number[])[])[] {
  const lines: number[][][] = [];
  const state = [0, 0, 0, 0];
  for (const line of mappings.split(';')) {
    const segments: number[][] = [];
    state[0] = 0;
    for (const segment of line.split(',')) {
      if (segment === '') continue;
      const values: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = BASE64.indexOf(char);
        value += (digit & 31) << shift;
        if ((digit & 32) !== 0) shift += 5;
        else {
          values.push((value & 1) === 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      for (let index = 0; index < values.length && index < 4; index += 1) state[index] = (state[index] as number) + (values[index] as number);
      if (values.length >= 4) segments.push([...state]);
    }
    lines.push(segments);
  }
  return lines;
}

/** A script's inline source map, as the TypeScript loader writes it: where a position came from. */
interface ScriptMap {
  readonly sources: readonly string[];
  readonly lines: readonly (readonly (readonly number[])[])[];
}

function scriptMap(sourceMapURL: string | undefined): ScriptMap | undefined {
  const match = sourceMapURL === undefined ? null : /^data:application\/json[^,]*;base64,(.*)$/u.exec(sourceMapURL);
  if (match === null) return undefined;
  const map = JSON.parse(Buffer.from(match[1] as string, 'base64').toString('utf8')) as { readonly sources: readonly string[]; readonly mappings: string };
  return { sources: map.sources, lines: decodeMappings(map.mappings) };
}

function original(map: ScriptMap | undefined, line: number, column: number): string | undefined {
  const segments = map?.lines[line];
  if (map === undefined || segments === undefined) return undefined;
  let best: readonly number[] | undefined;
  for (const segment of segments) if ((segment[0] as number) <= column) best = segment;
  if (best === undefined) return undefined;
  return `${map.sources[best[1] as number] ?? '?'}:${String((best[2] as number) + 1)}:${String((best[3] as number) + 1)}`;
}

/** The worker's paused call stack, as the inspector reports it, one frame a line (source-mapped). */
function pausedStack(
  message: { readonly params?: { readonly callFrames?: readonly Record<string, unknown>[] } },
  scripts: ReadonlyMap<string, { readonly url: string; readonly map: ScriptMap | undefined }>,
): string {
  return (message.params?.callFrames ?? [])
    .map((frame) => {
      const location = frame['location'] as { readonly scriptId: string; readonly lineNumber: number; readonly columnNumber: number };
      const script = scripts.get(location.scriptId);
      const url = (frame['url'] as string | undefined) || script?.url || `script ${location.scriptId}`;
      const name = (frame['functionName'] as string) || '<anonymous>';
      const mapped = original(script?.map, location.lineNumber, location.columnNumber);
      return `    at ${name} (${mapped === undefined ? `${url}:${String(location.lineNumber + 1)}:${String(location.columnNumber + 1)}` : mapped})`;
    })
    .join('\n');
}

export async function runImportedWorld(projectDir: string, options: RunWorldOptions): Promise<number> {
  const source = path.resolve(projectDir);
  if (!existsSync(path.join(source, 'src', 'world.tsx'))) throw new Error(`${source} has no src/world.tsx`);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-run-'));
  const cwd = process.cwd();
  const out = path.join(temp, 'project');
  try {
    cpSync(source, out, {
      recursive: true,
      filter: (entry) => !/(^|[\\/])(node_modules|logs|dist|\.vgai)([\\/]|$)/u.test(path.relative(source, entry)),
    });
    linkEmittedNodeModules(out);
    writeFileSync(path.join(out, 'gd-analyze-run-world.mts'), DRIVER);
    // The copied project is the working directory, as a proof's mount runs in it: its tsconfig
    // governs the TypeScript loader, and its public/ is what the page serves.
    process.chdir(out);
    const worker = new Worker(pathToFileURL(path.join(out, 'gd-analyze-run-world.mts')), {
      execArgv: [...NODE_MOUNT_IMPORTS, '--import', pathToFileURL(path.join(out, EMITTED_RESOLVE_HOOK)).href, '--enable-source-maps'],
      workerData: { frames: options.frames, mountMs: 60_000, profile: options.profile === true },
      stdout: false,
      stderr: false,
    });
    // The worker's inspector, reached through the main thread's session (NodeWorker domain).
    const session = new Session();
    session.connect();
    const scripts = new Map<string, { readonly url: string; readonly map: ScriptMap | undefined }>();
    let workerSession: string | undefined;
    let nextId = 1;
    const pending = new Map<number, (message: Record<string, unknown>) => void>();
    let onPaused: ((message: Record<string, unknown>) => void) | undefined;
    const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        session.post('NodeWorker.sendMessageToWorker', { sessionId: workerSession, message: JSON.stringify({ id, method, params }) });
      });
    session.on('NodeWorker.receivedMessageFromWorker', (event: { readonly params: { readonly sessionId: string; readonly message: string } }) => {
      if (event.params.sessionId !== workerSession) return;
      const message = JSON.parse(event.params.message) as Record<string, unknown>;
      if (typeof message['id'] === 'number') {
        pending.get(message['id'])?.(message);
        pending.delete(message['id']);
      } else if (message['method'] === 'Debugger.scriptParsed') {
        const params = message['params'] as { readonly scriptId: string; readonly url: string; readonly sourceMapURL?: string };
        scripts.set(params.scriptId, { url: params.url, map: scriptMap(params.sourceMapURL) });
      } else if (message['method'] === 'Debugger.paused') onPaused?.(message);
    });
    const attached = new Promise<void>((resolve) => {
      // Other threads (the TypeScript loader's) attach too: only the world's worker is ours.
      session.on('NodeWorker.attachedToWorker', (event: { readonly params: { readonly sessionId: string; readonly workerInfo: { readonly url: string } } }) => {
        if (!event.params.workerInfo.url.includes('gd-analyze-run-world')) {
          session.post('NodeWorker.sendMessageToWorker', {
            sessionId: event.params.sessionId,
            message: JSON.stringify({ id: 0, method: 'Runtime.runIfWaitingForDebugger', params: {} }),
          });
          return;
        }
        workerSession = event.params.sessionId;
        void send('Debugger.enable').then(() => send('Runtime.runIfWaitingForDebugger')).then(() => resolve());
      });
    });
    session.post('NodeWorker.enable', { waitForDebuggerOnStart: true });
    await attached;

    let lastProgress = Date.now();
    let mounted = false;
    let errors = 0;
    const physicsTimes: number[] = [];
    const stepTimes: number[] = [];
    const percentile = (times: readonly number[], p: number): number => {
      const sorted = [...times].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    };
    let maxFrame = 0;
    const finished = new Promise<number>((resolve) => {
      worker.on('message', (report: WorkerReport) => {
        lastProgress = Date.now();
        switch (report.kind) {
          case 'mounted':
            mounted = true;
            if (options.profile === true && (options.profileAfter ?? 0) === 0) void send('Profiler.enable').then(() => send('Profiler.start'));
            process.stdout.write(`mounted after ${String(report.waitedMs)} ms\n`);
            break;
          case 'frame':
            if (options.profile === true && report.frame === options.profileAfter) void send('Profiler.enable').then(() => send('Profiler.start'));
            // A frame over 250 ms, or with physics over a 60 Hz frame's 16 ms, or a physics frame over it.
            if (report.ms > 250 || report.physicsMs > 16 || report.stepsMs.some((ms) => ms > 16)) {
              process.stdout.write(`frame ${String(report.frame)} took ${String(report.ms)} ms (physics ${String(report.physicsMs)} ms: ${report.stepsMs.map(String).join(' + ')})\n`);
            }
            physicsTimes.push(report.physicsMs);
            stepTimes.push(...report.stepsMs);
            maxFrame = Math.max(maxFrame, report.ms);
            if (report.error !== undefined) {
              errors += 1;
              process.stdout.write(`frame ${String(report.frame)} threw:\n${report.error}\n`);
            }
            break;
          case 'done':
            if (options.profile === true) {
              void send('Profiler.stop').then((message) => {
                const result = message['result'] as { readonly profile: Parameters<typeof profileSummary>[0] };
                process.stdout.write(`self time over the stepped frames:\n${profileSummary(result.profile, scripts)}\n`);
                resolve(errors === 0 ? 0 : 1);
              });
            }
            process.stdout.write(
              `${String(options.frames)} frames, ${String(errors)} threw; slowest frame ${String(maxFrame)} ms; ` +
                `${String(stepTimes.length)} physics frames, slowest ${String(percentile(stepTimes, 1))} ms, p50 ${String(percentile(stepTimes, 0.5))} ms, p99 ${String(percentile(stepTimes, 0.99))} ms; ` +
                `physics per frame slowest ${String(percentile(physicsTimes, 1))} ms, p50 ${String(percentile(physicsTimes, 0.5))} ms, p99 ${String(percentile(physicsTimes, 0.99))} ms\n`,
            );
            if (options.profile !== true) resolve(errors === 0 ? 0 : 1);
            break;
          case 'failed':
            process.stdout.write(`the world failed before stepping:\n${report.error}\n`);
            resolve(1);
            break;
        }
      });
      worker.on('error', (error: unknown) => {
        process.stdout.write(`the worker failed:\n${error instanceof Error ? (error.stack ?? String(error)) : String(error)}\n`);
        resolve(1);
      });
      worker.on('exit', () => resolve(errors === 0 ? 0 : 1));
      // The watchdog: a frame (or the mount) over budget is paused and its stack printed.
      const watchdog = setInterval(() => {
        const budget = mounted ? options.budgetMs : 70_000;
        if (Date.now() - lastProgress <= budget) return;
        clearInterval(watchdog);
        const stalledAt = lastProgress;
        onPaused = (message) => {
          lastProgress = stalledAt;
          process.stdout.write(`hang: no frame for ${String(Date.now() - lastProgress)} ms; the paused stack:\n${pausedStack(message as never, scripts)}\n`);
          // A worker paused in a busy frame cannot be joined: the run ends the process here.
          process.chdir(cwd);
          rmSync(temp, { recursive: true, force: true });
          process.exit(1);
        };
        void send('Debugger.pause');
      }, 100);
      worker.on('exit', () => clearInterval(watchdog));
    });
    const code = await finished;
    session.disconnect();
    void worker.terminate();
    return code;
  } finally {
    process.chdir(cwd);
    rmSync(temp, { recursive: true, force: true });
  }
}

/** A world whose script spins in `_process`: the planted hang the self-check must locate. */
const SPIN_FILES: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Run spin check"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'main.gd': `extends Node3D

var spins: int = 0

func _process(_delta: float) -> void:
\twhile true:
\t\tspins += 1
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node3D"]
script = ExtResource("1")
`,
};

/**
 * `gd-analyze run --self-check`: imports the spinning world through the production pipeline and
 * runs it; the check holds when the hang is reported with a paused frame in the spinning script's
 * module, at the loop's line.
 */
export async function runSpinSelfCheck(tools: { readonly exporterBinary: string; readonly officialBinary: string }): Promise<number> {
  const { captureGodotProjectSnapshot } = await import('../snapshot/project-snapshot');
  const { captureGodotImportToolchainSnapshot } = await import('../snapshot/toolchain-snapshot');
  const { readGodotProjectSnapshot } = await import('../read/godot-project');
  const { bindGodotResources } = await import('../read/resource-program');
  const { bindGodotProject } = await import('../analyze/bound-project');
  const { captureGodotBoundProgram } = await import('../godot-frontend/run-bound-program');
  const { planGodotTranslation } = await import('../translate/plan');
  const { emitGodotTranslation } = await import('../translate/emit');
  const { writeGodotTranslationArtifacts } = await import('../materialize');
  const { mkdirSync, readFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-run-check-'));
  try {
    const project = path.join(temp, 'godot');
    mkdirSync(project);
    for (const [relative, text] of Object.entries(SPIN_FILES)) writeFileSync(path.join(project, relative), text);
    const snapshot = captureGodotProjectSnapshot(project);
    const toolchain = captureGodotImportToolchainSnapshot({ projectEngine: snapshot.engine, boundExporterBinary: tools.exporterBinary, officialBinary: tools.officialBinary });
    const read = () => readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority);
    const bound = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: tools.exporterBinary, projectDir: project }),
      bindGodotResources(read(), toolchain.frontend.readAuthority),
      toolchain.frontend.analysisAuthority,
      toolchain.frontend.authority,
      toolchain.frontend.apiDump,
      read(),
    );
    const translation = planGodotTranslation(bound, toolchain);
    if (translation.kind !== 'accepted-translation') {
      process.stdout.write(`self-check: the spinning world did not plan:\n${translation.diagnostics.map((entry) => `${entry.at}: ${entry.message}`).join('\n')}\n`);
      return 1;
    }
    const out = path.join(temp, 'imported');
    mkdirSync(out);
    writeGodotTranslationArtifacts(emitGodotTranslation(translation), out);
    // The loop's line in the emitted script module.
    const lines = readFileSync(path.join(out, 'src', 'scripts', 'main.ts'), 'utf8').split('\n');
    const loopLine = lines.findIndex((line) => line.includes('while (true)')) + 1;
    if (loopLine === 0) {
      process.stdout.write('self-check: the emitted main.ts has no while (true) loop\n');
      return 1;
    }
    // The run in its own process (it ends the process when it reports a hang).
    const run = spawnSync(process.execPath, [...process.execArgv, process.argv[1] as string, 'run', out, '--frames', '10', '--budget-ms', '2000'], { encoding: 'utf8', timeout: 180_000 });
    process.stdout.write(run.stdout);
    const hang = run.stdout.split('\n').find((line) => line.startsWith('hang:'));
    const located = run.stdout
      .split('\n')
      .some((line) => new RegExp(`src/scripts/main\\.ts:(${String(loopLine)}|${String(loopLine + 1)}|${String(loopLine + 2)}):`, 'u').test(line));
    const verdict = hang !== undefined && located;
    process.stdout.write(`self-check: ${verdict ? 'the hang is reported at' : 'the hang is NOT reported at'} src/scripts/main.ts:${String(loopLine)} (the _process loop)\n`);
    return verdict ? 0 : 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
