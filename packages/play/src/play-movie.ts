/**
 * A CUTSCENE OR A SEQUENCE, PLAYED BY ANY RUNNER: the file's own movie (`DocumentPlayMovie`) for a span
 * of scene frames on the game's clock, its camera cuts and markers, and the camera handed back with a
 * blend when it ends. The editor's runner (`play-script.ts`) and a web export's (`play-runner.ts`) each
 * hold one, call `advance(dt)` with every update and `frame(seconds)` after each frame's updates, and
 * `end()` when the run stops; the context's `cutscene`, `sequence` and `markers` start and read it.
 */
import type * as THREE from 'three';
import type { DocumentPlayMovie } from '@volter/sdk/kit/document-play-extension';
import { cameraTransition } from './camera-transition';
import type { ModelPlayCutscene, ModelPlayCutsceneOptions, ModelPlayCutsceneResult, ModelPlayCutsceneSpan, ModelPlayMarker,
  ModelPlayScriptLife, ModelPlaySequenceOptions } from './play-context';

/** What a movie player reaches of its runner. */
export interface MoviePlayerHost {
  /** The document's movie; null when it lends none. */
  movie(): DocumentPlayMovie | null;
  /** The camera the run draws through. */
  camera(): THREE.Camera;
  /** The copy's root (a sequence's `at` by name). */
  readonly root: THREE.Object3D;
  append(source: 'play' | 'script', kind: string, facts?: Record<string, unknown>): void;
  /** A script callback (`onDone`, `onMarker`) that threw. */
  report(what: string, error: unknown): void;
}

/** One run's movie player. */
export interface MoviePlayer {
  markers(): readonly ModelPlayMarker[];
  cutscene(alive: ModelPlayScriptLife, span: ModelPlayCutsceneSpan | undefined, options: ModelPlayCutsceneOptions): ModelPlayCutscene;
  sequence(alive: ModelPlayScriptLife, span: ModelPlayCutsceneSpan | undefined, options: ModelPlaySequenceOptions): ModelPlayCutscene;
  /** One update's worth, on the game's clock, after the characters' clips. */
  advance(dt: number): void;
  /** After a frame's updates: the movie's camera, or the hand-back blend. */
  frame(seconds: number): void;
  /** The run is ending: a running one stops where it is, and the camera is left to the run. */
  end(): void;
}

/** A cutscene the runner plays (`ModelPlayContext.cutscene`). */
interface Cutscene {
  readonly owner: ModelPlayScriptLife;
  readonly start: number;
  readonly end: number;
  readonly fps: number;
  readonly speed: number;
  readonly blend: number;
  /** The camera it looks through throughout, or null for the movie's own cuts. */
  readonly camera: string | null;
  /** Whether it takes the camera at all (a sequence may leave it to the script). */
  readonly takesCamera: boolean;
  /** What it drives and where (a sequence's collection and placement). */
  readonly scope: { readonly collection?: string; readonly at?: unknown; readonly anchor?: string } | undefined;
  elapsed: number;
  frame: number;
  /** The frame of the last marker said. */
  passed: number;
  marker: ModelPlayMarker | null;
  /** The camera looked through last (undefined before the first frame). */
  shot: string | null | undefined;
  playing: boolean;
  /** Put the camera's own settings back. */
  readonly restore: () => void;
  readonly resolve: (result: ModelPlayCutsceneResult) => void;
  readonly onDone: ((result: ModelPlayCutsceneResult) => void) | undefined;
  readonly onMarker: ((marker: ModelPlayMarker) => void) | undefined;
}

export function moviePlayer(host: MoviePlayerHost): MoviePlayer {
  /** THE RUNNING CUTSCENE, and the camera blending back from the last one. */
  let cutscene: Cutscene | null = null;
  let handBack: ReturnType<typeof cameraTransition> | null = null;
  const movie = (): DocumentPlayMovie | null => host.movie();
  /** The span a cutscene asked for, as scene frames, or why it cannot play. */
  const spanOf = (span: ModelPlayCutsceneSpan | undefined, end: string | number | undefined):
    { start: number; end: number } | { refused: string } => {
    const lent = movie();
    const scene = lent?.scene();
    if (!lent || !scene) return { refused: lent ? "the scene's movie could not be read" : 'this document lends no movie' };
    const markers = lent.markers();
    const frameOf = (at: string | number | undefined, fallback: number): number | string => {
      if (at === undefined) return fallback;
      if (typeof at === 'number') return Number.isFinite(at) ? at : `${at} is not a frame`;
      const marker = markers.find((one) => one.name === at);
      return marker ? marker.frame : `the Timeline has no marker "${at}"${markers.length ? `; it has ${markers.map((one) => `"${one.name}"`).join(', ')}` : ''}`;
    };
    const bounds = typeof span === 'object' && span !== null ? span : { start: span, end };
    const from = frameOf(bounds.start, scene.start);
    if (typeof from === 'string') return { refused: from };
    const to = frameOf(bounds.end ?? end, scene.end);
    if (typeof to === 'string') return { refused: to };
    if (to < from) return { refused: `it ends (frame ${to}) before it starts (frame ${from})` };
    return { start: from, end: to };
  };
  /** The camera's own settings, put back when a cutscene ends. */
  const cameraSettings = (cam: THREE.Camera) => {
    const perspective = cam as THREE.PerspectiveCamera;
    const saved = {
      position: cam.position.clone(), quaternion: cam.quaternion.clone(),
      ...(perspective.isPerspectiveCamera ? { fov: perspective.fov, near: perspective.near, far: perspective.far, zoom: perspective.zoom, filmOffset: perspective.filmOffset, view: perspective.view ? { ...perspective.view } : null } : {}),
    };
    return (): void => {
      cam.position.copy(saved.position);
      cam.quaternion.copy(saved.quaternion);
      if (perspective.isPerspectiveCamera && saved.fov !== undefined) {
        Object.assign(perspective, { fov: saved.fov, near: saved.near, far: saved.far, zoom: saved.zoom, filmOffset: saved.filmOffset, view: saved.view });
      }
      (cam as THREE.PerspectiveCamera).updateProjectionMatrix?.();
      cam.updateMatrixWorld(true);
    };
  };
  /**
   * End the running cutscene: `at` the span's end (posed there first) or where it is. The camera
   * is handed back (`'blend'`: its own settings restored, then blended to from the movie's last
   * shot), restored at once (`'restore'`, another cutscene takes it), or left alone (`'leave'`,
   * the run is ending and Play's own return owns the camera).
   */
  const finishCutscene = (scene: Cutscene, skipped: boolean, at: 'end' | 'here', cameraBack: 'blend' | 'restore' | 'leave'): void => {
    if (cutscene !== scene || !scene.playing) return;
    scene.playing = false;
    cutscene = null;
    const lent = movie();
    if (at === 'end') scene.frame = scene.end;
    const cam = host.camera();
    if (lent) {
      lent.seek(scene.frame, scene.scope);
      // THE LAST SHOT, looked through once more, is where the hand-back blend starts.
      const shot = scene.takesCamera ? scene.camera ?? lent.cameraAt(scene.frame) : null;
      if (shot && cameraBack === 'blend') lent.look(cam, shot);
      lent.seek(null);
    }
    if (scene.takesCamera) {
      handBack = cameraBack === 'blend' && scene.blend > 0 ? cameraTransition(cam, { instant: false, duration: scene.blend }) : null;
      if (cameraBack !== 'leave') scene.restore();
    }
    const result: ModelPlayCutsceneResult = { skipped, frame: scene.frame };
    host.append('play', 'cutscene', { event: 'end', frame: scene.frame, skipped });
    scene.resolve(result);
    if (scene.owner.value && scene.onDone) {
      try { scene.onDone(result); }
      catch (error) { host.report('cutscene onDone', error); }
    }
  };
  /** The markers between the last frame shown and this one, each said once. */
  const passMarkers = (scene: Cutscene, upTo: number): void => {
    const lent = movie();
    if (!lent) return;
    for (const marker of lent.markers()) {
      if (marker.frame < scene.start || marker.frame > upTo || marker.frame <= scene.passed) continue;
      scene.passed = marker.frame;
      scene.marker = marker;
      host.append('play', 'cutscene', { event: 'marker', marker: marker.name, frame: marker.frame });
      if (scene.owner.value && scene.onMarker) {
        try { scene.onMarker(marker); }
        catch (error) { host.report('cutscene onMarker', error); }
      }
    }
  };
  /** One update's worth of the running cutscene, on the game's clock. */
  const advanceCutscene = (dt: number): void => {
    const scene = cutscene;
    if (!scene) return;
    // A cutscene goes with the script that started it (replaced, failed, or stopped).
    if (!scene.owner.value) { finishCutscene(scene, true, 'here', 'blend'); return; }
    scene.elapsed += dt;
    const raw = scene.start + scene.elapsed * scene.fps * scene.speed;
    // THE LAST FRAME IS SHOWN FOR A FRAME, as Blender's playback shows it, before it ends.
    if (raw >= scene.end + 1 || (scene.end === scene.start && scene.elapsed > 0)) { finishCutscene(scene, false, 'end', 'blend'); return; }
    scene.frame = Math.min(scene.end, raw);
    passMarkers(scene, Math.floor(scene.frame));
    movie()?.seek(scene.frame, scene.scope);
  };
  /** After the frame's updates: the movie's camera while a cutscene runs, else the hand-back blend. */
  const cutsceneCamera = (deltaSeconds: number): void => {
    const lent = movie();
    const scene = cutscene;
    if (scene && lent && scene.takesCamera) {
      const shot = scene.camera ?? lent.cameraAt(scene.frame);
      const looked = shot !== null && lent.look(host.camera(), shot);
      if (shot !== scene.shot) {
        scene.shot = shot;
        // A camera the model lacks (a typo in `camera`) is said with the cut; the script's own
        // camera then stays.
        host.append('play', 'cutscene', { event: 'cut', camera: shot, frame: Math.floor(scene.frame), ...(shot !== null && !looked ? { missing: true } : {}) });
      }
      return;
    }
    if (handBack) {
      handBack.frame(host.camera(), deltaSeconds);
      if (handBack.acceptingKeys()) handBack = null;
    }
  };
  const markers = () => {
      return (movie()?.markers() ?? []).map((marker) => ({ ...marker }));
    };
  /** Start a cutscene or a sequence (one at a time: a running one ends where it is). */
  const begin = (alive: ModelPlayScriptLife, span: ModelPlayCutsceneSpan | undefined, options: Omit<ModelPlayCutsceneOptions, 'camera'> & { readonly collection?: string },
    how: { readonly takesCamera: boolean; readonly camera: string | null; readonly scope: Cutscene['scope'] }): ModelPlayCutscene => {
      let resolve!: (result: ModelPlayCutsceneResult) => void;
      const done = new Promise<ModelPlayCutsceneResult>((settle) => { resolve = settle; });
      let bounds = alive.value ? spanOf(span, options.end) : { refused: 'the script that asked has stopped' };
      const lent = movie();
      const scene = lent?.scene();
      if (!('refused' in bounds) && options.collection && lent?.hasCollection && !lent.hasCollection(options.collection))
        bounds = { refused: `the file has no collection "${options.collection}" holding anything that moves` };
      if ('refused' in bounds || !lent || !scene) {
        const refused = 'refused' in bounds ? bounds.refused : 'this document lends no movie';
        const frame = 'refused' in bounds ? scene?.start ?? 0 : bounds.start;
        if (alive.value) host.append('play', 'cutscene', { event: 'refused', span: span ?? null, why: refused });
        const result: ModelPlayCutsceneResult = { skipped: true, frame, refused };
        resolve(result);
        if (alive.value && options.onDone) queueMicrotask(() => { if (alive.value) options.onDone!(result); });
        return { frame, playing: false, marker: null, done, stop() {} };
      }
      // ONE AT A TIME: a running one ends where it is, and the new one takes over.
      if (cutscene) finishCutscene(cutscene, true, 'here', 'restore');
      // A hand-back still blending is cut short when the new one takes the camera.
      if (how.takesCamera) handBack = null;
      const restore = how.takesCamera ? cameraSettings(host.camera()) : () => {};
      const running: Cutscene = {
        owner: alive, start: bounds.start, end: bounds.end, fps: scene.fps, speed: Math.max(0, options.speed ?? 1),
        blend: Math.max(0, options.blend ?? 0.5), camera: how.camera, takesCamera: how.takesCamera, scope: how.scope,
        elapsed: 0, frame: bounds.start, passed: -Infinity, marker: null, shot: undefined, playing: true, restore, resolve,
        onDone: options.onDone, onMarker: options.onMarker,
      };
      cutscene = running;
      host.append('play', 'cutscene', { event: 'start', from: bounds.start, to: bounds.end, fps: scene.fps,
        camera: how.takesCamera ? how.camera ?? lent.cameraAt(bounds.start) : null, span: span ?? null,
        ...(options.collection ? { collection: options.collection } : {}), ...(how.scope?.at ? { placed: true } : {}) });
      passMarkers(running, bounds.start);
      lent.seek(bounds.start, how.scope);
      return {
        get frame() { return running.frame; },
        get playing() { return running.playing; },
        get marker() { return running.marker; },
        done,
        stop(at = 'end') { finishCutscene(running, true, at, 'blend'); },
      };
  };
  return {
    markers,
    cutscene(alive, span, options) {
      return begin(alive, span, options, { takesCamera: true, camera: options.camera ?? null, scope: undefined });
    },
    sequence(alive, span, options) {
      const at = typeof options.at === 'string' ? host.root.getObjectByName(options.at) ?? undefined : options.at;
      const scope = {
        ...(options.collection ? { collection: options.collection } : {}),
        ...(at ? { at, anchor: options.anchor ?? `${options.collection ?? 'Sequence'}.Anchor` } : {}),
      };
      return begin(alive, span, options, {
        takesCamera: options.camera !== undefined && options.camera !== false,
        camera: typeof options.camera === 'string' ? options.camera : null,
        scope,
      });
    },
    advance: (dt) => advanceCutscene(dt),
    frame: (seconds) => cutsceneCamera(seconds),
    end() { if (cutscene) finishCutscene(cutscene, true, 'here', 'leave'); },
  };
}
