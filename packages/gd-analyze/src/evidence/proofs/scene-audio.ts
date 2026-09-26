/**
 * The scene-audio proof: the platformer's sounds (`.wav` files and their `wav` importer sidecars:
 * trimmed, normalized, QOA-compressed, one looping) used by an AudioStreamPlayer3D (autoplay,
 * volume, maximum distance, doppler) and an AudioStreamPlayer over an AudioStreamRandomizer, as the
 * platformer's player and enemy scenes author them, imported by official Godot and read back
 * through Godot's getters (each stream's length, rate, channels, format and loop; each player's
 * settings and whether it plays; the randomizer's pool and settings), against the components the
 * production pipeline emits for the same project, mounted in Node by @react-three/fiber with the
 * sounds fetched from their copies, read through compat's getters.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { bindGodotProject } from '../../analyze/bound-project';
import { monorepoImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { writeGodotTranslationArtifacts } from '../../materialize';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { captureGodotImportToolchainSnapshot } from '../../snapshot/toolchain-snapshot';
import { GODOT_SCENE_AUDIO_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';
import { readFileSync } from 'node:fs';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
/** The platformer's images this proof imports, with their `.import` sidecars. */
const FIXTURE = path.join(PACKAGE_ROOT, 'test/fixtures/platformer-3d-godot4');
const IMAGES = ['enemy/robot_walk.wav', 'player/sound_jump.wav', 'coin/sound_coin.wav'] as const;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene audio proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=64
window/size/viewport_height=64

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'main.tscn': `[gd_scene load_steps=5 format=3]

[ext_resource type="AudioStream" path="res://${IMAGES[0]}" id="1_walk"]
[ext_resource type="AudioStream" path="res://${IMAGES[1]}" id="2_jump"]
[ext_resource type="AudioStream" path="res://${IMAGES[2]}" id="3_coin"]

[sub_resource type="AudioStreamRandomizer" id="AudioStreamRandomizer_jump"]
random_pitch = 1.03
streams_count = 1
stream_0/stream = ExtResource("2_jump")

[node name="Main" type="Node3D"]

[node name="SoundWalkLoop" type="AudioStreamPlayer3D" parent="."]
stream = ExtResource("1_walk")
volume_db = 12.0
autoplay = true
max_distance = 30.0
doppler_tracking = 1

[node name="SoundJump" type="AudioStreamPlayer" parent="."]
stream = SubResource("AudioStreamRandomizer_jump")
volume_db = -6.0

[node name="Sound" type="AudioStreamPlayer3D" parent="."]
stream = ExtResource("3_coin")
`,
};

/** The native probe, written into the project only after the target side has read it. */
const OBSERVE = `extends SceneTree

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _wav(s: AudioStreamWAV) -> Array:
\treturn [_bits(s.get_length()), s.mix_rate, s.stereo, s.format, s.loop_mode, s.loop_begin, s.loop_end]

func _process(_delta: float) -> bool:
\tvar main: Node = load("res://main.tscn").instantiate()
\troot.add_child(main)
\tvar walk: AudioStreamPlayer3D = main.get_node("SoundWalkLoop")
\tvar jump: AudioStreamPlayer = main.get_node("SoundJump")
\tvar coin: AudioStreamPlayer3D = main.get_node("Sound")
\tvar r: AudioStreamRandomizer = jump.stream
\tvar rows := {
\t\t"walk": [_wav(walk.stream), _bits(walk.volume_db), walk.autoplay, _bits(walk.max_distance), walk.doppler_tracking, walk.attenuation_model, _bits(walk.unit_size), walk.is_playing()],
\t\t"jump": [_bits(jump.volume_db), _bits(jump.pitch_scale), jump.is_playing(), _bits(r.random_pitch), r.streams_count, _wav(r.get_stream(0)), r.playback_mode],
\t\t"coin": [_wav(coin.stream), coin.is_playing()],
\t}
\tprint("AUDIO " + JSON.stringify(rows))
\treturn true
`;

function inputDigest(): string {
  return sha256(
    Object.entries({ ...files, 'observe.gd': OBSERVE, ...Object.fromEntries(IMAGES.flatMap((image) => [[image, sha256(readFileSync(path.join(FIXTURE, image)))], [`${image}.import`, readFileSync(path.join(FIXTURE, `${image}.import`), 'utf8')]])) })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

/**
 * Mounts the emitted main scene with R3F's own root and reads each player and stream through compat. The
 * `fetch` reads the copied files before the scene module (whose streams start loading when it is
 * evaluated) is imported; the reads wait for every load.
 */
const MOUNT = `import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import * as AS from './src/lib/godot-compat/audio-stream';
import * as W from './src/lib/godot-compat/audio-stream-wav';
import * as R from './src/lib/godot-compat/audio-stream-randomizer';
import * as P from './src/lib/godot-compat/audio-stream-player';
import * as P3 from './src/lib/godot-compat/audio-stream-player-3d';
import * as N from './src/lib/godot-compat/node';
import * as ST from './src/lib/godot-compat/scene-tree';
import { godot_resource_loader_settled } from './src/lib/godot-compat/resource-loader';

globalThis.fetch = async (url) => {
  const bytes = readFileSync('./public' + String(url));
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const { MainScene } = await import('./src/scenes/main');
await godot_resource_loader_settled();
const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const wav = (s) => [bits(AS.get_length(s)), W.get_mix_rate(s), W.is_stereo(s), W.get_format(s), W.get_loop_mode(s), W.get_loop_begin(s), W.get_loop_end(s)];
extend(THREE);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const canvas = {
  width: 64, height: 64, style: {}, clientWidth: 64, clientHeight: 64,
  addEventListener() {}, removeEventListener() {}, getContext() { return null; },
  getBoundingClientRect() { return { width: 64, height: 64, top: 0, left: 0 }; },
};
const gl = {
  domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, getPixelRatio: () => 1,
  setAnimationLoop() {}, dispose() {}, shadowMap: {}, info: { render: {} }, capabilities: {},
  xr: { enabled: false, addEventListener() {}, removeEventListener() {}, setAnimationLoop() {} },
  getContext: () => ({}),
};
const root = createRoot(canvas);
await root.configure({ gl, size: { width: 64, height: 64, top: 0, left: 0 }, frameloop: 'never' });
const holder = { current: null };
await act(async () => { root.render(createElement('group', { ref: holder }, createElement(MainScene, { name: 'Main' }))); });
const main = holder.current.children[0];
// The scene enters the tree as the root's add_child does (autoplay plays on entering).
ST.godot_tree_set_root(holder.current.parent);
N.mountGodotScriptTree(main, []);
const find = (name) => main.getObjectByName(name);
const walk = find('SoundWalkLoop');
const jump = find('SoundJump');
const coin = find('Sound');
const r = P.get_stream(jump);
const rows = {
  walk: [wav(P3.get_stream(walk)), bits(P3.get_volume_db(walk)), P3.is_autoplay_enabled(walk), bits(P3.get_max_distance(walk)), P3.get_doppler_tracking(walk), P3.get_attenuation_model(walk), bits(P3.get_unit_size(walk)), P3.is_playing(walk)],
  jump: [bits(P.get_volume_db(jump)), bits(P.get_pitch_scale(jump)), P.is_playing(jump), bits(R.get_random_pitch(r)), R.get_streams_count(r), wav(R.get_stream(r, 0)), R.get_playback_mode(r)],
  coin: [wav(P3.get_stream(coin)), P3.is_playing(coin)],
};
await act(async () => { root.unmount(); });
console.log('AUDIO ' + JSON.stringify(rows));
process.exit(0);
`;

function mountedAudio(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('AUDIO '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('AUDIO '.length)) as unknown;
}

export async function measureSceneAudioProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_AUDIO_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-audio-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(project, relative), source);
    }
    for (const image of IMAGES) {
      mkdirSync(path.dirname(path.join(project, image)), { recursive: true });
      copyFileSync(path.join(FIXTURE, image), path.join(project, image));
      copyFileSync(path.join(FIXTURE, `${image}.import`), path.join(project, `${image}.import`));
    }
    const snapshot = captureGodotProjectSnapshot(project);
    const toolchain = captureGodotImportToolchainSnapshot({
      projectEngine: snapshot.engine,
      boundExporterBinary: exporterBinary,
      officialBinary,
    });
    const bound = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: project }),
      bindGodotResources(
        readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority),
        toolchain.frontend.readAuthority,
      ),
      toolchain.frontend.analysisAuthority,
      toolchain.frontend.authority,
      toolchain.frontend.apiDump,
      readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority),
    );
    const translation = planGodotTranslation(bound, toolchain);
    if (translation.kind !== 'accepted-translation') {
      throw new Error(translation.diagnostics.map((entry) => `${entry.at}: ${entry.message}`).join('\n'));
    }
    const out = path.join(temp, 'out');
    mkdirSync(out);
    writeGodotTranslationArtifacts(emitGodotTranslation(translation), out);
    symlinkSync(path.join(MONOREPO_ROOT, 'node_modules'), path.join(out, 'node_modules'));
    const target = mountedAudio(out);

    // Native: Godot's editor imports the images by their sidecars, then the scene is instantiated.
    const imported = spawnSync(officialBinary, ['--editor', '--headless', '--path', project, '--import', '--quit'], {
      encoding: 'utf8',
      timeout: 180_000,
    });
    if (imported.error !== undefined || imported.status !== 0) {
      throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
    }
    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('AUDIO '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native audio probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('AUDIO '.length)) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-audio',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(nativeJson),
          comparison: sha256(comparison),
        },
        agree: nativeJson === targetJson,
        detail: `native ${nativeJson}\ntarget ${targetJson}`,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
