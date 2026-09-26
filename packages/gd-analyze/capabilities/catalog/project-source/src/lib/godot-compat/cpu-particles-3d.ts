/**
 * `CPUParticles` — a Godot 3.6 CPU particle emitter, carried onto `three.quarks`' own
 * `ParticleSystem` (the owner-decided renderer, 2026-08-06). This is a FAITHFUL parameter carry,
 * not an approximation: every field below is Godot's own value put onto three.quarks' equivalent,
 * and a Godot parameter with NO faithful three.quarks equivalent is REFUSED BY NAME at read time
 * (`translate/scene-module-3d.ts`'s `readCpuParticles3D`) rather than being silently dropped.
 *
 * ## Why three.quarks, and why this is a helper and not a wrapper
 *
 * Godot's is a GPU/CPU emitter; three has no particle primitive, and three.quarks is a real,
 * maintained three particle library the engine already ships. This file does NOT hand-build a
 * `new ParticleSystem(...)` of its own: it maps the Godot params onto the engine's SHARED
 * `ParticlesDescriptor` and builds the system through the ONE shared factory,
 * `@vgai/engine/render/particles-factory`'s `createParticleSystemFromData` — the exact path the editor
 * entity-factory and the runtime scene-loader take. The two shapes a plain descriptor cannot carry
 * (Godot's box-volume emission distribution, and a mesh particle's `ArrayMesh` geometry) ride the
 * factory's `objects` companion argument: an `EmitterShape` instance and an `instancingGeometry`
 * alongside the JSON. This file then hands back three.quarks' OWN objects — the factory-built
 * `ParticleSystem`, its `emitter` (an `Object3D` the translated scene places at the node's
 * transform), and a `BatchedRenderer` — and gets out of the way: every later call is three.quarks'
 * API. That is the return-path split every backend in this folder keeps, so it is a helper, not the
 * banned wrapper.
 *
 * ## The one shape three.quarks does not have, expressed through its OWN extension seam
 *
 * ## Render mode: a billboard sprite, or a MESH particle
 *
 * Godot's CPUParticles draws each particle as a copy of its `mesh`. The default is a billboard
 * QuadMesh (a camera-facing sprite), carried onto `RenderMode.BillBoard`. When the `mesh` is a real
 * `ArrayMesh`, the particle is that geometry drawn per particle — {@link
 * GodotCpuParticles3DSpec.particleGeometry} is present and the system is built in `RenderMode.Mesh`
 * with the decoded buffer as three.quarks' `instancingGeometry`. Both modes share the SAME emission,
 * size, colour, velocity, gravity and scale-curve carries; only the render primitive differs. A mesh
 * shape three.quarks' mesh mode cannot draw — a skinned particle mesh, multiple surfaces — refuses
 * by name in `translate/scene-module-3d.ts` rather than being approximated.
 *
 * A mesh particle whose Godot material is SHADED carries too, on three.quarks' own lit mesh path
 * ({@link GodotCpuParticles3DSpec.lit} ⇒ a `MeshStandardMaterial`): see {@link materialDescriptor}
 * for both shaders' albedo products and for the reflectance defaults that make the carry exact.
 * A lit BILLBOARD has no such path and is the standing reader gap named there.
 *
 * three.quarks ships `PointEmitter`/`SphereEmitter`/`ConeEmitter`/`RectangleEmitter`/… but no 3D
 * BOX-VOLUME emitter, and `coin.tscn`'s pickup burst is `emission_shape = BOX`. three.quarks
 * exposes `EmitterShape` as a first-class plugin interface precisely so a game can add the emission
 * distribution it needs, and {@link GodotCpuEmitter} is that: it reproduces Godot 3.6 CPUParticles'
 * OWN `_particles_process` init exactly — POSITION from the emission shape (point/sphere-volume/
 * box-volume), VELOCITY from `direction` perturbed within the `spread` cone and scaled by
 * `initial_velocity`. Using the library's declared extension point to express an emission volume
 * its built-ins omit is using three.quarks directly; the math carried is Godot's, exact, not a
 * lookalike.
 *
 * ## COLOUR: the material albedo belongs on the PARTICLE, not on the material
 *
 * three.quarks' particle fragment shader for a `MeshBasicMaterial` — `particle_frag.glsl`, taken by
 * BOTH render modes this file builds (billboard via `particle_vert`, mesh via `local_particle_vert`)
 * — is `vec4 diffuseColor = vColor;` and nothing else: it declares no `diffuse` uniform, so a
 * `MeshBasicMaterial.color` set on a particle system is DEAD (only `particle_physics_frag`, reached
 * solely by a `MeshStandardMaterial` in mesh mode, reads it — and the lit carry deliberately leaves
 * that uniform at three's white default so ONE composition serves both shaders; see
 * {@link materialDescriptor}). The per-particle `color` attribute is the whole
 * fragment. So a faithful carry of
 * Godot's `albedo_color` has to be folded into the PER-PARTICLE colour; putting it on the material,
 * as this file did until 2026-08-14, renders the emitter's tint as pure WHITE.
 *
 * The composition below is Godot 3.6/GLES3's own, measured against the real binary on this box
 * (a `CPUParticles` mesh particle under an orthographic camera, black background, linear tonemap,
 * centre pixel read back; displayed sRGB):
 *
 * ```text
 *   COLOR  = CPUParticles.color · color_ramp(t)                      (both authored sRGB)
 *   ALBEDO = srgb→linear(albedo_color.rgb) · [use_as_albedo ? f(COLOR.rgb) : 1]
 *   ALPHA  = albedo_color.a                · [use_as_albedo ? COLOR.a     : 1]
 *   f = srgb→linear when `vertex_color_is_srgb`, identity otherwise. ALPHA is NEVER decoded.
 * ```
 *
 * The rows that pin each term (albedo `Color(0.822, 0.795804, 0.513098)` — `bullet.tscn`'s trail —
 * unless stated; a flat ramp; additive over black, which at ALPHA 1 is exactly ALBEDO):
 *
 * | authored | read back | what it pins |
 * |---|---|---|
 * | ramp white | `0.818, 0.792, 0.513` | the albedo TINTS the particle (sRGB round-trip identity) |
 * | no `color_ramp` at all | `0.818, 0.792, 0.513` | identical — an absent ramp is a white ramp |
 * | ramp `0.5`, `is_srgb = true` | `0.405, 0.391, 0.243` | = lin⁻¹(lin(0.822)·lin(0.5)) → the ramp is sRGB-DECODED |
 * | ramp `0.5`, `is_srgb = false` | `0.601, 0.581, 0.370` | = lin⁻¹(lin(0.822)·0.5) → raw, no decode |
 * | albedo white, ramp `0.5`, `is_srgb` t/f | `0.498` / `0.734` | the decode again, with the tint removed |
 * | `CPUParticles.color = 0.5`, ramp white | `0.405, 0.391, 0.243` | `color` multiplies, through the same decode |
 * | ramp `0.5`, `use_as_albedo = false` | `0.822, 0.795, 0.513` | the ramp COLOUR is ignored entirely |
 * | ramp alpha `0.25`, `use_as_albedo = false` | `0.822, 0.795, 0.513` | so is the ramp ALPHA — the fade DISAPPEARS |
 * | ramp alpha `0.25`, `use_as_albedo = true` | `0.433, 0.418, 0.262` | = lin⁻¹(lin(0.822)·0.25) → alpha is not decoded |
 * | `albedo_color.a = 0.5` | `0.599, 0.580, 0.370` | the albedo's own alpha multiplies ALPHA |
 * | `albedo_color.a = 0.5`, ramp alpha `0.5` | `0.434, 0.420, 0.263` | both alphas multiply |
 *
 * `vertex_color_use_as_albedo` gating the ALPHA too is the one that reads as a bug and is not:
 * Godot's generated shader does `albedo_tex *= COLOR` on the whole vec4 under that flag, so a
 * `color_ramp` authored on an emitter whose material leaves the flag off (Godot's default) does
 * NOTHING — no tint and no fade. {@link GodotCpuParticles3DSpec.vertexColorAsAlbedo} carries that,
 * so the port drops the ramp exactly where the real engine drops it.
 *
 * three.quarks composes the same product for us: `ColorOverLife.update` MULTIPLIES its gradient
 * into `particle.startColor`, so the ramp goes on the behaviour and everything constant — the
 * linear albedo, `CPUParticles.color`, both alphas — goes on `startColor`.
 *
 * ## The SPRITE's own texels: measured, and why the fix is the engine factory's
 *
 * `particle_frag.glsl` multiplies the sprite texel straight into that product with a raw
 * `texture2D` — Godot's own `albedo_tex *= COLOR` order — so the texel arrives in whatever space
 * the texture was UPLOADED in. `THREE.TextureLoader` leaves `colorSpace` at `NoColorSpace`, which
 * uploads `RGBA8` and tells the shader the texels are already linear; Godot's importer sets
 * `flags/srgb`, which is `TEXTURE_FLAG_CONVERT_TO_LINEAR` on the `.stex` and `GL_SRGB8_ALPHA8` on
 * the GPU. Same probe as the colour table above, one solid-colour sprite per row, `albedo_color`
 * white and `vertex_color_use_as_albedo` off so the centre pixel IS the texel:
 *
 * | sprite texel | real Godot 3.6 | port BEFORE | port AFTER |
 * |---|---|---|---|
 * | `128,128,128` | `0.5015` | `0.7373` (+60 bytes) | `0.5020` |
 * | `64,64,64`    | `0.2510` | `0.5373` (+73 bytes) | `0.2510` |
 * | `143,141,81` (`shine.png`'s dominant texel) | `0.5605, 0.5527, 0.3176` | `0.7725, 0.7686, 0.6000` (+54/+54/+72) | `0.5608, 0.5529, 0.3176` |
 * | `shine.png` itself, centre texel `248,233,201` | `0.9683, 0.9053, 0.7759` | `0.9882, 0.9608, 0.9020` | `0.9725, 0.9137, 0.7882` |
 * | no sprite, `albedo_color = 0.5` (pipeline control) | `0.4998` | `0.4980` | `0.4980` |
 *
 * The real engine's decode is not conditional on the runtime flag, either: an `ImageTexture` built
 * WITHOUT `FLAG_CONVERT_TO_LINEAR` read back identically to one with it (`0.5015` both ways) on
 * this box's GLES3, and the imported `shine.png` carries `flags = 23`, i.e. the flag set. The
 * residual `shine.png` gap after the fix (≈0.004–0.012) is its VRAM compression: the demo imports
 * it `compress/mode=2`, so Godot draws a DXT-quantised copy while the port draws the original PNG.
 *
 * The fix is one line in the engine's shared particle factory rather than a Godot special case: a
 * material `map` is a colour texture by definition, three's own `GLTFLoader` states
 * `SRGBColorSpace` on `baseColorTexture` for the same reason, and this file cannot reach the
 * texture anyway (the factory loads it from the descriptor's `map` URL through its own cache).
 *
 * ## The sprite's SAMPLER rides the descriptor, and `flipY` deliberately does not
 *
 * {@link GodotCpuParticles3DSpec.textureSampler} carries the `.import` sidecar's wrap/filter/
 * mipmap/anisotropy onto the descriptor's `material.mapSampler`, which the same factory applies
 * to the loaded texture. Until 2026-08-14 this path had no seam for it and the emitter degraded
 * with a note instead, so a nearest-filtered pixel-art sprite or a wrapping atlas sampled with
 * three's defaults and there was nothing to grep for. The V ORIGIN is the one axis that stays
 * out — see {@link GodotCpuParticles3DSpec.textureSampler} for why that is correctness rather
 * than an omission.
 *
 * ## `emitting` is a node ACTION, not a keyframed property
 *
 * `coin.gd` plays the `take` clip, whose `Particles:emitting` track flips this emitter on. That is
 * fired from the clip timeline by `value-track-animation.ts`'s node-action schedule, which calls
 * {@link CpuParticles3D.setEmitting} — so a one-shot burst RESTARTS every time the clip plays, which
 * is Godot's own behaviour (an `emitting = true` write re-arms a one-shot).
 *
 * ## SIMULATION TIME: `fixed_fps` and `preprocess`, transcribed from Godot's own loop
 *
 * Godot decouples the particle SIMULATION rate from the drawn frame, and pre-burns a stretch of it
 * so an emitter can appear mid-stream. Both live in ONE place in Godot — the per-frame particle
 * update — and both live in ONE place here, {@link CpuParticles3D.update}, for the same reason.
 * This is a transcription of the engine's loop, not a lookalike; the two sources are quoted where
 * the code runs, so the claim is checkable without leaving the file.
 *
 * Godot 3.6 `scene/3d/cpu_particles.cpp` `CPUParticles::_update_internal` (`3.6-stable`, :567-607):
 *
 * ```cpp
 *   if (time == 0 && pre_process_time > 0.0) {
 *       float frame_time;
 *       if (fixed_fps > 0) { frame_time = 1.0 / fixed_fps; } else { frame_time = 1.0 / 30.0; }
 *       float todo = pre_process_time;
 *       while (todo >= 0) { _particles_process(frame_time); processed = true; todo -= frame_time; }
 *   }
 *   if (fixed_fps > 0) {
 *       float frame_time = 1.0 / fixed_fps;
 *       float decr = frame_time;
 *       float ldelta = delta;
 *       if (ldelta > 0.1) { //avoid recursive stalls if fps goes below 10
 *           ldelta = 0.1;
 *       } else if (ldelta <= 0.0) { //unlikely but..
 *           ldelta = 0.001;
 *       }
 *       float todo = frame_remainder + ldelta;
 *       while (todo >= frame_time) { _particles_process(frame_time); processed = true; todo -= decr; }
 *       frame_remainder = todo;
 *   } else {
 *       _particles_process(delta);
 *       processed = true;
 *   }
 * ```
 *
 * Godot 4's GPU path is the SAME two loops, in `servers/rendering/renderer_rd/storage_rd/
 * particles_storage.cpp` `ParticlesStorage::update_particles` (`4.4-stable`, :1532-1588) — with
 * `clear` (raised by `particles_restart`) standing where 3.6 reads `time == 0`, and one extra
 * clause named under FIDELITY below:
 *
 * ```cpp
 *   double todo = particles->request_process_time;
 *   if (particles->clear) { todo += particles->pre_process_time; }
 *   if (todo > 0.0) {
 *       double frame_time;
 *       if (fixed_fps > 0) { frame_time = 1.0 / fixed_fps; } else { frame_time = 1.0 / 30.0; }
 *       …
 *       while (todo >= 0) { _particles_process(particles, frame_time); todo -= frame_time; }
 *       …
 *   }
 *   if (fixed_fps > 0) {
 *       …
 *       double delta = RendererCompositorRD::get_singleton()->get_frame_delta_time();
 *       if (delta > 0.1) { //avoid recursive stalls if fps goes below 10
 *           delta = 0.1;
 *       } else if (delta <= 0.0) { //unlikely but..
 *           delta = 0.001;
 *       }
 *       todo = particles->frame_remainder + delta;
 *       while (todo >= frame_time || particles->clear) { _particles_process(particles, frame_time); todo -= decr; }
 *       particles->frame_remainder = todo;
 *   } else { … _particles_process(particles, …get_frame_delta_time()); }
 * ```
 *
 * ### `speed_scale` multiplies the STEP, never the accumulator
 *
 * Both loops above bank the RAW frame delta. The multiplier lives one level down, inside the call
 * the loops make, and both engines put it on the first line of that call:
 *
 * ```cpp
 *   void CPUParticles::_particles_process(float p_delta) {
 *       p_delta *= speed_scale;                              // 3.6-stable, cpu_particles.cpp:620-621
 * ```
 * ```cpp
 *   frame_params.delta = p_delta * p_particles->speed_scale; // 4.4-stable, particles_storage.cpp:842
 * ```
 *
 * So there is exactly ONE owner of the multiplication here too — the step handed to
 * `BatchedRenderer.update` — and the fixed-step semantics stay honest: `fixed_fps = 60` spends 60
 * steps per second of SIM time whatever the speed, and each step simulates `1/60 · speed_scale`.
 * Scaling the banked delta instead would change the step COUNT, which is the one thing `fixed_fps`
 * exists to hold constant.
 *
 * The `preprocess` burn differs by dialect. Godot 4 saves `speed_scale`, forces it to 1 for the burn
 * and restores it, because otherwise "the speed scale of the particle system influences the TODO"
 * (`particles_storage.cpp:1546-1554`; `scene/3d/cpu_particles_3d.cpp:681-687` repeats it for 4.x's
 * CPU emitter). Godot 3.6 has no save/restore, so a 3.x burn advances by
 * `preprocess × speed_scale`. The emitted `preprocessUsesSpeedScale` dialect bit selects that one
 * multiplication at this compat boundary; no translated call contains the policy.
 *
 * ### The three.quarks mechanism, and the one it is deliberately NOT
 *
 * three.quarks' step door is `BatchedRenderer.update(delta)` — `BatchedRenderer.ts:211-217` forwards
 * that `delta` to every system it holds and then refreshes the batches. `ParticleSystem.update` is
 * private, so the renderer IS the public seam, and stepping it N times with a fixed `delta` is the
 * library's own supported way to advance N fixed steps: nothing in the system reads a clock, and
 * every behaviour integrates the `delta` it is handed (`emit(delta, …)`, `behaviors[j].update(p,
 * delta)`, `particle.age += delta`). So the burn-in and the fixed-step loop below are `renderer
 * .update(step)` called the number of times Godot calls `_particles_process`.
 *
 * The mechanism NOT used is three.quarks' own `prewarm` flag, and it is worth naming because it
 * looks like the answer: `ParticleSystem.ts:990-995` runs it only `if (this.looping && this.prewarm
 * && !this.prewarmed)`, and it burns exactly `duration * PREWARM_FPS` steps of `1 / PREWARM_FPS`
 * with `PREWARM_FPS = 60` hardcoded (`:68`). That is "one whole loop at 60 Hz for a LOOPING system"
 * — three constants Godot's `preprocess` does not have (an arbitrary number of SECONDS, at the
 * emitter's OWN `fixed_fps`, on a one-shot as readily as a stream). `objects/brick.tscn`'s emitter
 * is `one_shot = true`, so the flag would not fire at all. It is the wrong shape, not a near miss.
 *
 * ### FIDELITY — what is preserved, and what is not
 *
 * PRESERVED, exactly: the number of simulated steps and the size of each one. The accumulator banks
 * whatever the host's tick hands `update` (SIM time — this object never reads a clock) and spends it
 * in whole `1 / fixed_fps` steps, carrying Godot's own remainder, Godot's `> 0.1` stall clamp and
 * Godot's `<= 0` floor. The burn-in runs Godot's `while (todo >= 0)`, which OVERSHOOTS the seconds
 * it is asked for, in two ways a computed step count would get wrong: `preprocess = 0.1` at
 * `fixed_fps = 60` burns SEVEN steps (0.1167 s) where the division says six, and a `preprocess`
 * that lands EXACTLY on a step boundary burns one more step still (`0.1` at `fixed_fps = 10` is two
 * steps — the `>=`, where a `>` would stop at one). Running the loop reproduces both. It re-runs on every
 * (re)start, because that is what `time == 0` / `clear` mean, and it runs on the first `update`
 * after the restart rather than inside `setEmitting` — again Godot's seat, since both loops live in
 * the per-frame update and the flag is only consumed there.
 *
 * NOT preserved, two things, both bounded and both stated rather than approximated:
 *
 *  1. **Godot 4's forced first step.** 4.x's fixed-step loop is `while (todo >= frame_time ||
 *     particles->clear)`, so a restarted emitter takes one step on the clear frame no matter how
 *     little time has banked; 3.6 has no such clause and this carry follows 3.6 (the file the whole
 *     emitter is written against). The divergence is at most ONE fixed step of emission latency at
 *     start, and only when `preprocess` is 0 — a non-zero one already processes on that frame and
 *     lowers `clear` before the loop is reached.
 *  2. **Godot 4's `interpolate`** (default `true`) extrapolates the DRAWN particle forward by the
 *     unspent `frame_remainder` (`particles_storage.cpp:1268`, `copy_push_constant.frame_remainder =
 *     particles->interpolate ? particles->frame_remainder : 0.0`), which three.quarks has no
 *     counterpart for. At `fixed_fps` at or above the drawn rate the unspent remainder is smaller
 *     than a frame and the difference is sub-frame; BELOW it the difference grows to a whole
 *     simulated step and the particle visibly judders, so `translate/particles-dialect.ts` REFUSES a
 *     Godot 4 `fixed_fps` under Godot's own `screen_hz` rather than drawing the judder. Godot 3.6's
 *     `CPUParticles` has no `interpolate` property at all, so nothing is lost on that dialect.
 *
 * There is one COST that is not a divergence: each burn step calls `BatchedRenderer.update`, which
 * refreshes the draw batches as well as stepping the system. Only the last refresh of a burn is
 * ever drawn, so the extra ones buy nothing but cost time — which is why the translator refuses a
 * burn budget it cannot afford on the main thread (Godot's is a GPU dispatch; see
 * `scene-module-3d.ts`'s `readCpuParticles3DSpec`).
 *
 * ## PER-PARTICLE RANDOM RANGES: `mix(min, max, rand)` is `IntervalValue`, exactly
 *
 * Godot draws each of `initial_velocity`, `scale`, `linear_accel` (and its siblings) ONCE per
 * particle, uniformly between two bounds — the same statement in both engines:
 *
 * ```cpp
 *   params.initial_velocity_multiplier = mix(initial_linear_velocity_min, initial_linear_velocity_max, rand_from_seed(alt_seed));
 *   params.scale = vec3(mix(scale_min, scale_max, rand_from_seed(alt_seed)));   // 4.4-stable, particle_process_material.cpp:564,576
 *   p.velocity = rot * parameters[PARAM_INITIAL_LINEAR_VELOCITY] * Math::lerp(1.0f, float(Math::randf()), randomness[…]);  // 3.6-stable, cpu_particles.cpp:772
 * ```
 *
 * three.quarks' `IntervalValue` is that statement: `startGen` pushes ONE `Math.random()` into the
 * particle's own memory and `genValue` returns `lerp(a, b, memory[i])`
 * (`quarks.core/src/functions/IntervalValue.ts`) — one uniform draw per particle, held for its
 * whole life. `ParticleSystem.spawn` calls `startGen` before `genValue` for `startSpeed` and
 * `startSize` (`ParticleSystem.ts:828-836`), so both parameters carry as ranges with no
 * approximation. A range whose bounds are EQUAL emits a `ConstantValue`, so an emitter that
 * authors a constant writes the literal it always wrote.
 *
 * ## `linear_accel`: acceleration ALONG the velocity, and why it owns the whole force block
 *
 * Godot's force block reads the velocity ONCE, at the top of the step, and every term is summed
 * into a single `force` that is applied in one statement:
 *
 * ```cpp
 *   Vector3 force = gravity;
 *   force += r_p.velocity.length() > 0.0 ? r_p.velocity.normalized() * (parameters[PARAM_LINEAR_ACCEL] + …) : Vector3();
 *   …
 *   r_p.velocity += force * p_local_delta;      // 3.6-stable, cpu_particles.cpp:1075-1097
 * ```
 * ```cpp
 *   force = gravity;
 *   force += length(VELOCITY) > 0.0 ? normalize(VELOCITY) * physics_params.linear_accel : vec3(0.0);
 *   …
 *   VELOCITY += force * DELTA;                  // 4.4-stable, particle_process_material.cpp:956-977
 * ```
 *
 * three.quarks' own `ApplyForce` behaviour is exactly the gravity term
 * (`velocity.addScaledVector(direction, magnitude * delta)`), and it is what this file emits when
 * gravity is the ONLY force — which is every emitter that authors no `linear_accel`, so their
 * descriptors are unchanged. When `linear_accel` IS authored, running two behaviours in sequence
 * would let the first one's gravity rotate the velocity that the second one normalises, which is
 * not what either engine does; so {@link GodotCpuForce} takes the whole block and `ApplyForce` is
 * not emitted. ONE owner of `velocity += force · delta`, exactly where Godot puts it.
 * `radial_accel`, `tangential_accel` and `orbit_velocity` are NOT in that block here — they refuse
 * by name at translate time (`translate/scene-module-3d.ts`'s `CPU_PARTICLES_3D_RULES`), so the sum
 * this reproduces is the sum the reachable inputs actually have.
 *
 * ## `damping`: a SECOND statement on the velocity the force block wrote, not a term of the sum
 *
 * Godot damps in its own block, AFTER the force integration, reading the velocity again. Both
 * engines write the same five statements — 3.6 in `Vector3` calls, 4.4 as generated GLSL that its
 * own comment marks `// Copied from previous version.`:
 *
 * ```cpp
 *   if (parameters[PARAM_DAMPING] + tex_damping > 0.0) {
 *       float v = r_p.velocity.length();
 *       float damp = (parameters[PARAM_DAMPING] + tex_damping) * Math::lerp(1.0f, rand_from_seed(alt_seed), randomness[PARAM_DAMPING]);
 *       v -= damp * p_local_delta;
 *       if (v < 0.0) { r_p.velocity = Vector3(); }
 *       else         { r_p.velocity = r_p.velocity.normalized() * v; }
 *   }
 *   // 3.6-stable, scene/3d/cpu_particles.cpp:1114-1123 — the force block is :1075-1097, above it.
 * ```
 * ```glsl
 *   VELOCITY += force * DELTA;                     // 4.4-stable, :978, the force block's last line
 *   {
 *       // Copied from previous version.
 *       if (physics_params.damping > 0.0) {
 *           float v = length(VELOCITY);
 *           v -= physics_params.damping * DELTA;
 *           if (v < 0.0) { VELOCITY = vec3(0.0); }
 *           else         { VELOCITY = normalize(VELOCITY) * v; }
 *       }
 *   }
 *   // 4.4-stable, scene/resources/particle_process_material.cpp:980-999.
 * ```
 *
 * Three things that block IS, each of which a plausible reading gets wrong:
 *
 *  - **LINEAR decay of the SPEED, in units per second — not an exponential `v *= (1 - k·dt)`.** The
 *    subtraction is on the MAGNITUDE and the direction is re-applied unchanged, so a particle at
 *    `damping = 0.5` loses exactly 0.5 units of speed per second whatever its speed is.
 *  - **Clamped at zero, and the clamp is a HARD stop.** A particle whose speed the subtraction takes
 *    below zero gets the zero vector, not a reversed velocity — so damping never pushes a particle
 *    backwards along its own track.
 *  - **Gated on the DRAWN value being `> 0`.** Godot re-checks the gate every step against the
 *    particle's own draw, which is why {@link GodotCpuDamping} checks it per particle rather than
 *    once at construction: a range whose min is 0 has particles on both sides of it.
 *
 * The per-particle half is the ordinary range draw of the section above —
 * `params.damping = mix(damping_min, damping_max, rand_from_seed(alt_seed))`
 * (4.4-stable, `particle_process_material.cpp:556`, in the `calculate_initial_physical_params` both
 * `start()` and `process()` call off the SAME per-particle `alt_seed`, so it is one value held for
 * the particle's life) — which is `IntervalValue` exactly, as `linear_accel`'s is. Godot 3's
 * `damping_random` RATIO spelling refuses at translate time; `damping_curve` (a per-life multiplier
 * on the drawn value, `params.damping *= texture(damping_texture, …)`) refuses there too.
 *
 * It is a SEPARATE {@link Behavior} rather than a term folded into {@link GodotCpuForce}, and the
 * "one owner of the velocity write" argument is what puts it there rather than what forbids it. The
 * invariant is one owner per GODOT STATEMENT: `VELOCITY += force · DELTA` is one statement and must
 * not be split, which is why the force sum cannot be two behaviours. Damping is a DIFFERENT
 * statement, sequenced by Godot after that one and reading its result — and it must run for an
 * emitter that authors no `linear_accel` at all, where {@link GodotCpuForce} is never registered and
 * gravity rides three.quarks' own `ApplyForce` (or, at `gravity = (0,0,0)`, nothing does).
 * `objects/coin.tscn` in `starter-kit-3d-platformer` is exactly that emitter. Registration order is
 * Godot's own: after whichever behaviour owns the force write, and BEFORE the planar clamp (4.4
 * damps at `:982` and zeroes `final_velocity.z` at `:1053`).
 *
 * three.quarks ships two behaviours that touch a particle's speed and NEITHER is this block:
 * `SpeedOverLife` writes an untyped `speedModifier` from a generator keyed by normalised AGE (a
 * multiplier over life, not a rate against the current magnitude), and `LimitSpeedOverLife` pulls
 * the speed towards a CEILING by `1 - percent · dampen · delta · 20`, a proportional decay with a
 * hardcoded factor that does nothing at all below the limit. Transcribing Godot's five statements is
 * the only faithful carry, which is the same conclusion `GodotCpuForce` reached against `ApplyForce`.
 *
 * ## ORIENTATION: `particle_flag_align_y` and `particle_flag_disable_z`
 *
 * Both engines write the SAME orientation block, statement for statement — 3.6's CPU emitter in
 * `Basis` calls and 4.x's generated process shader in `TRANSFORM` columns:
 *
 * ```cpp
 *   if (flags[FLAG_DISABLE_Z]) {
 *       if (flags[FLAG_ALIGN_Y_TO_VELOCITY]) {
 *           if (p.velocity.length() > 0.0) { p.transform.basis.set_axis(1, p.velocity.normalized()); }
 *           else { p.transform.basis.set_axis(1, p.transform.basis.get_axis(1)); }
 *           p.transform.basis.set_axis(0, p.transform.basis.get_axis(1).cross(p.transform.basis.get_axis(2)).normalized());
 *           p.transform.basis.set_axis(2, Vector3(0, 0, 1));
 *       } …
 *   } else {
 *       if (flags[FLAG_ALIGN_Y_TO_VELOCITY]) {
 *           … set_axis(1, velocity.normalized()) …
 *           if (get_axis(1) == get_axis(0)) { axis0 = axis1×axis2; axis2 = axis0×axis1; }
 *           else                            { axis2 = axis0×axis1; axis0 = axis1×axis2; }
 *       } …
 *   }
 *   // 3.6-stable, scene/3d/cpu_particles.cpp:952-985; 4.4-stable,
 *   // scene/resources/particle_process_material.cpp:1072-1102 emits the identical GLSL.
 * ```
 *
 * three.quarks has no align-to-velocity behaviour, but it does have the two things such a
 * behaviour needs, both first-class: `RenderMode.Mesh` gives every particle a full per-particle
 * ORIENTATION — a `Quaternion` in `particle.rotation`, uploaded as the `rotation` vec4 attribute
 * and expanded to a basis by `local_particle_vert.glsl` — and `Behavior` is a declared plugin
 * interface ("a behavior is a function that modifies a particle's properties over time",
 * `quarks.core/src/behaviors/Behavior.ts`) whose `update(particle, delta)` runs before the library
 * integrates `position += velocity · delta` (`ParticleSystem.ts:1013-1039`). {@link
 * GodotAlignYToVelocity} is that behaviour, and it is a TRANSCRIPTION of the block above rather
 * than a lookalike: it reads the basis out of the quaternion with the same expansion the shader
 * uses — quarks' own `Matrix4.makeRotationFromQuaternion`, and `Quaternion.setFromRotationMatrix`
 * to write it back, rather than either expansion spelled out here — runs Godot's own statements in
 * Godot's own order, and writes the basis back.
 *
 * Two things make the transcription exact rather than approximate:
 *
 *  - **It sees the velocity Godot orients from.** Godot orients from `final_velocity`, the vector
 *    it also integrates the position with, AFTER the force block. Registering this behaviour LAST
 *    gives it exactly that vector, because `ApplyForce`/{@link GodotCpuForce} have already run and
 *    the position has not yet been integrated. (Godot's `final_velocity` is
 *    `controlled_displacement + VELOCITY`; every term of `controlled_displacement` — orbit, radial
 *    and directional velocity — refuses at translate time, so on every reachable input the two are
 *    the same vector.)
 *  - **A BILLBOARD particle has no such orientation**: three.quarks gives those a scalar
 *    `rotation`, so `align_y` on a non-mesh particle refuses at translate time rather than being
 *    dropped.
 *
 * `particle_flag_disable_z` is a PLANAR emitter, and it is three separate changes, all of them
 * Godot's own and all carried here:
 *
 *  1. the spread cone becomes a 2D FAN in the XY plane —
 *     `angle1_rad = atan2(direction.y, direction.x) + rand(-1,1) · spread`, `rot = (cos, sin, 0)`
 *     (3.6 `cpu_particles.cpp:769-772`; 4.4's shader is the same expression with an explicit
 *     `direction.x == 0` guard that `atan2` already answers the same way) — carried by
 *     {@link GodotCpuEmitter};
 *  2. the spawn zeroes both `velocity.z` and `origin.z` (3.6 `:899-902`, 4.4 `:907-909`) — the
 *     velocity's half is the fan above; the POSITION's is {@link GodotCpuPlanar}'s, for the reason
 *     stated there (three.quarks runs behaviours in the same `update` that emits, so there is one
 *     fixed point and it should have one writer);
 *  3. every step re-zeroes them (4.4 `final_velocity.z = 0`, `TRANSFORM[3].z = 0`, `force.z = 0`;
 *     3.6 `p.velocity.z = 0; p.transform.origin.z = 0` immediately before the integration) —
 *     {@link GodotCpuPlanar}, registered before the align behaviour. That order is Godot 4's
 *     exactly: 4.4 zeroes `final_velocity.z` at `:1053` and orients from it at `:1072`. 3.6 is the
 *     ONE place the two engines differ here — it orients at `:952-985` and only then zeroes at
 *     `:1001-1004`, so a 3.6 emitter whose `gravity` has a `z` component would orient from a
 *     velocity carrying one step of it. Godot 4's order is the one carried, because a Godot 4
 *     `.tscn` is the dialect a measured fixture authors this flag from.
 *
 * The flag also swaps the TANGENTIAL-acceleration formula and enables ORBIT velocity; both of
 * those parameters refuse by name at translate time on either flag setting, so neither reaches
 * this file and neither is silently carried under the wrong formula.
 *
 * ## Resource ownership
 *
 * **Owns:** one three.quarks `ParticleSystem` (built by the shared engine factory), its `emitter`
 * `Object3D`, its `BatchedRenderer`, the factory-built `THREE.Material` for that system, and the
 * emitter's own SIMULATION-TIME state — Godot's `frame_remainder` and its restart flag, closure
 * variables of {@link createCpuParticles3D} that nothing outside this file reads or writes. They
 * are per-EMITTER, exactly as Godot's are per-`Particles`, and are deliberately not the world's
 * fixed-step accumulator (the physics one, in the translated `src/world.tsx`): that clock is the
 * project's `physics_fps` and this one is the node's `fixed_fps`, and Godot runs both.
 * **Shares:** the sprite `Texture` — the engine factory loads it through a module-level cache keyed
 * by URL, so a texture is shared across every emitter that names it and is NOT this emitter's to
 * dispose. **Teardown:** {@link CpuParticles3D.dispose} removes the system from the renderer,
 * detaches the renderer, and disposes the factory-built material — the translated scene calls it
 * from its own tree-release path.
 */

import type {
  BehaviorJSON,
  ColorGeneratorJSON,
  ParticlesDescriptor,
  ValueGeneratorJSON,
} from '@volter/threejs-runtime/asset-formats/particles';
import {
  createParticleSystemFromData,
  type ParticleSystemObjects,
  registerParticleSystem,
  unregisterParticleSystem,
} from '@volter/threejs-runtime/render/particles-factory';
import {
  type Behavior,
  ConstantValue,
  type EmitterShape,
  IntervalValue,
  Matrix4,
  type Particle,
  PiecewiseBezier,
  Quaternion,
  type ValueGenerator,
  Vector3,
} from 'quarks.core';
import { BufferGeometry, Material, type Object3D, ShaderChunk } from 'three';
import { BatchedRenderer } from 'three.quarks';
import { GodotGradient } from './gradient';
import type { GodotGradientTexture1D } from './procedural-textures';
import { godotResourceChangedSignal } from './resource-io';
import type { GodotConnection } from './signal';
import {
  bindGodotSpatialMaterialAnimationState,
  type GodotSpatialMaterialAnimationState,
} from './spatial-material';
import type { GodotTextureConfig } from './texture-3d';

/** Godot 3.6 `CPUParticles::EmissionShape` (`scene/3d/cpu_particles.cpp`). Only the volume shapes a
 *  measured fixture authors are carried; `POINTS`/`DIRECTED_POINTS` (a baked point cloud) refuse at
 *  read time, so they never reach here. */
export type GodotEmissionShape =
  | { readonly shape: 'point' }
  | { readonly shape: 'sphere'; readonly radius: number }
  | { readonly shape: 'sphere-surface'; readonly radius: number }
  | { readonly shape: 'box'; readonly extents: readonly [number, number, number] };

/**
 * One control point of a Godot `Curve` (`scale_amount_curve`), in Godot's own `_data` order —
 * `offset` (x, in [0,1]) and `value` (y) plus the two bezier tangents. A Godot curve segment is a
 * cubic bezier whose control points are `(a.value, a.value + d/3·a.rightTangent, b.value −
 * d/3·b.leftTangent, b.value)` over `d = b.offset − a.offset` (Godot 3.6 `Curve::interpolate_local_nocheck`,
 * `scene/resources/curve.cpp`) — so a point's RIGHT tangent shapes the segment leaving it and the
 * next point's LEFT tangent shapes the segment arriving at it. All-zero tangents give a smoothstep
 * (Hermite with flat ends), NOT a straight line.
 */
export interface GodotCurvePoint {
  readonly offset: number;
  readonly value: number;
  readonly leftTangent: number;
  readonly rightTangent: number;
}

/**
 * One Godot particle parameter that may be a per-particle RANDOM range: a plain number when both
 * of Godot's bounds agree (a constant), or `[min, max]` when they do not. Godot draws it once per
 * particle as `mix(min, max, rand)`; see the module header for why `IntervalValue` IS that draw.
 */
export type GodotParamRange = number | readonly [number, number];

/** One stop of a baked Godot `Gradient` — offset in [0,1] and its RGBA. */
export interface CpuGradientStop {
  readonly offset: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** A particle ramp remains the authored Resource when the scene owns one. */
export type CpuGradientResource =
  | readonly CpuGradientStop[]
  | GodotGradient
  | GodotGradientTexture1D;

/**
 * The plain DATA a translated scene hands {@link createCpuParticles3D} — every field is Godot's own
 * value, already read off the `.tscn` and reduced to numbers/strings so the emitter can write it as
 * an object literal (the same shape `buildValueTrackClip`'s clip data has).
 */
export interface GodotCpuParticles3DSpec {
  /** `amount` — the particle count (a one-shot burst emits this many at once). */
  readonly amount: number;
  /** `lifetime` — seconds each particle lives. */
  readonly lifetime: number;
  /** Godot 4 `lifetime_randomness`: each particle draws uniformly from
   *  `[lifetime * (1 - randomness), lifetime]` once at birth. */
  readonly lifetimeRandomness?: number;
  /** `one_shot` — a single burst then stop, vs a continuous stream. */
  readonly oneShot: boolean;
  /** `local_coords` — particles born in the emitter's space (true) follow it; false is world-space. */
  readonly localCoords: boolean;
  /** The emission volume (`emission_shape` + its radius/extents). */
  readonly emission: GodotEmissionShape;
  /** `direction` — the base emission direction, before `spread`. */
  readonly direction: readonly [number, number, number];
  /** `spread`, in DEGREES — the half-angle of the cone `direction` is randomised within. */
  readonly spreadDeg: number;
  /** `initial_velocity` — the speed each particle is launched at. A `[min, max]` pair is Godot's
   *  per-particle uniform draw and carries onto three.quarks' `IntervalValue`; see the module
   *  header. */
  readonly initialVelocity: GodotParamRange;
  /** `angular_velocity` — the per-particle billboard SPIN rate, in DEGREES/sec (Godot's default is 0,
   *  no spin). Carried onto three.quarks' `RotationOverLife` as a per-particle constant rate. */
  readonly angularVelocityDeg: number;
  /** `angular_velocity_random` in [0,1] — how far below `angular_velocity` each particle's spin rate is
   *  randomised. 0 = every particle spins at exactly `angular_velocity`; 1 = uniform in
   *  ±`angular_velocity`. Godot's factor is `lerp(1, rand*2-1, random)` → uniform in `[1-2*random, 1]`. */
  readonly angularVelocityRandom: number;
  /** Godot's per-particle starting billboard angle, in degrees; a range is sampled once. */
  readonly initialAngleDeg?: GodotParamRange;
  /** `gravity` — the constant acceleration applied over life. */
  readonly gravity: readonly [number, number, number];
  /** `scale_amount` — the particle's base size (the QuadMesh is 1×1, so size == scale_amount). For a
   *  MESH particle the same scalar is `RenderMode.Mesh`'s uniform per-particle scale on
   *  {@link particleGeometry}, so a `scale_amount` of 0.3 draws the mesh at 0.3× exactly as Godot's
   *  `emission_transform.basis.scale(Vector3(s,s,s))` does. A `[min, max]` pair is Godot's
   *  per-particle uniform draw (`IntervalValue`). */
  readonly scaleAmount: GodotParamRange;
  /**
   * `linear_accel` — acceleration ALONG each particle's own current velocity direction, constant
   * per particle (a `[min, max]` pair is Godot's per-particle uniform draw). Absent or `0` is
   * Godot's default and emits nothing, so an emitter that authors none is byte-for-byte the
   * emitter that existed before there was a field here. Present ⇒ {@link GodotCpuForce} takes
   * over the whole `velocity += force · delta` block from three.quarks' `ApplyForce`; see the
   * module header for why the two cannot be run in sequence.
   */
  readonly linearAccel?: GodotParamRange;
  /**
   * `damping` — how many units of SPEED each particle loses per second, subtracted from the velocity's
   * MAGNITUDE and clamped at zero (a `[min, max]` pair is Godot's per-particle uniform draw). Absent
   * or `0` is Godot's default and its own `damping > 0.0` gate is shut, so an emitter that authors
   * none is byte-for-byte the emitter that existed before there was a field here. Present ⇒
   * {@link GodotCpuDamping} runs Godot's own block, after whichever behaviour owns the force write;
   * see the module header for both engines' source and for why it is not folded into
   * {@link GodotCpuForce}.
   */
  readonly damping?: GodotParamRange;
  /**
   * `particle_flag_align_y` — orient each particle so its LOCAL +Y axis points along its current
   * velocity. Requires a MESH particle ({@link particleGeometry}): three.quarks orients those by a
   * per-particle quaternion, and a billboard sprite has only a scalar spin, so `align_y` on a
   * billboard refuses at translate time. See the module header for the transcribed block.
   */
  readonly alignYToVelocity?: boolean;
  /**
   * `particle_flag_disable_z` — a PLANAR (2D) emitter: the spread cone becomes a fan in the XY
   * plane, and both position and velocity are pinned to `z = 0` at spawn and on every step. See
   * the module header for the three separate changes Godot makes under this flag.
   */
  readonly disableZ?: boolean;
  /**
   * The particle material's `cull_mode` as three's own `side` vocabulary — which faces are DRAWN
   * (Godot names the ones it culls, so Godot's `CULL_BACK` is three's `front`). Absent leaves the
   * factory's own default, which is what every emitter that authors no cull mode gets.
   */
  readonly side?: 'front' | 'back' | 'double';
  /**
   * The decoded particle MESH, when the CPUParticles `mesh` is a real `ArrayMesh` rather than the
   * default billboard QuadMesh. Present ⇒ `createCpuParticles3D` builds the system in
   * `RenderMode.Mesh` with this as three.quarks' `instancingGeometry` (one copy of the geometry per
   * particle), instead of a camera-facing quad sprite. It is a real `THREE.BufferGeometry` — the
   * SAME buffer the scene's `MeshInstance` of that mesh draws (three.quarks reads its
   * position/normal/uv/index attributes into its own instanced geometry, never mutating them, so the
   * two can share one decode). The size/colour/velocity/gravity/scale-curve carries all still apply;
   * only the render primitive changes. Absent ⇒ the billboard QuadMesh sprite.
   */
  readonly particleGeometry?: BufferGeometry;
  /** `scale_amount_curve`, as its Godot `Curve` control points — the SIZE multiplier over normalised
   *  particle life. Absent = a flat size (Godot's default is no curve). Carried onto three.quarks'
   *  `SizeOverLife` as an EXACT rebuild of Godot's per-segment cubic bezier, which multiplies
   *  `scale_amount`, exactly as Godot's `scale_amount · curve.interpolate(life_fraction)` does. */
  readonly scaleAmountCurve?: readonly GodotCurvePoint[];
  /** Godot 4 `ParticleProcessMaterial.alpha_curve`: an independent alpha multiplier over
   *  normalised life, using the same exact Curve control-point representation as size. */
  readonly alphaCurve?: readonly GodotCurvePoint[];
  /** CPUParticles' own flat `color`, RGBA in [0,1] — the per-particle START colour, before the ramp.
   *  Authored sRGB, like every Godot `Color`; see the module header for when it is decoded. */
  readonly color: readonly [number, number, number, number];
  /** `color_ramp` — the colour/alpha over normalised life, or absent for the flat color. Authored
   *  Gradient resources retain their identity so script mutation changes live particles.
   *  Ignored ENTIRELY (colour and alpha) when {@link vertexColorAsAlbedo} is false, which is what
   *  Godot does. */
  readonly colorRamp?: CpuGradientResource;
  /** The particle material's `albedo_color`, RGBA in [0,1] and authored sRGB — Godot's tint on every
   *  particle. Its RGB is sRGB-decoded and multiplied into the per-particle colour; its ALPHA
   *  multiplies the particle's alpha. See the module header for why it cannot ride the three
   *  material. */
  readonly materialColor: readonly [number, number, number, number];
  /** The particle material's `vertex_color_use_as_albedo` (Godot's default: FALSE). Godot applies
   *  the per-particle `COLOR` — `color` × `color_ramp`, RGB *and* alpha — only under this flag, so
   *  false means the ramp does nothing at all. */
  readonly vertexColorAsAlbedo: boolean;
  /** The particle material's `vertex_color_is_srgb` (Godot's default: FALSE). True ⇒ `COLOR.rgb` is
   *  sRGB-DECODED before it multiplies the albedo; false ⇒ it is used raw as linear. Alpha is never
   *  decoded either way. */
  readonly vertexColorIsSrgb: boolean;
  /** The particle sprite texture URL (the QuadMesh material's `albedo_texture`), or absent. */
  readonly texture?: string;
  /**
   * The sprite's `.import` sidecar sampler — the same `flags/repeat`, `flags/filter`,
   * `flags/mipmaps` and `flags/anisotropic` every other texture in a translated scene applies
   * through {@link configureGodotTexture}, carried here as DATA because this one texture is loaded
   * by the engine's shared particle factory from {@link texture} rather than by the scene.
   *
   * `sampling` is deliberately absent from the shape: it is `configureGodotTexture`'s `flipY`
   * axis, and the V ORIGIN is not a gap on this path. The factory both loads the image (three's
   * `flipY = true`) and three.quarks builds the billboard's UVs (three's own quad, V up from the
   * bottom), so the pair is internally consistent and the sprite draws upright — the same way
   * Godot's V-down images and quad UVs are the other consistent pair. Only Godot's OWN UVs (a
   * decoded `ArrayMesh`, a GridMap item) meeting a three texture need the flip, and none reach
   * this quad.
   */
  readonly textureSampler?: Omit<GodotTextureConfig, 'sampling'>;
  /** The QuadMesh material's blend — `mix` (alpha) or `add` (additive), from `params_blend_mode`. */
  readonly blend: 'mix' | 'add';
  /**
   * Whether Godot draws this material in its ALPHA pass rather than its opaque one — `true` for
   * every emitter with an additive blend or an authored transparency, `false` for a plainly opaque
   * one (Godot's own default). It is ONE decision spent on BOTH of three's knobs: `transparent`
   * verbatim, and `depthWrite` as its complement, because Godot's `depth_draw_mode` opens at
   * `DEPTH_DRAW_OPAQUE_ONLY` — "depth is drawn only for opaque objects" — and its alpha pass writes
   * depth only under the depth-prepass transparency mode this carry refuses upstream.
   *
   * See {@link materialDescriptor} for both engines' predicates and why they coincide.
   */
  readonly transparent: boolean;
  /** Godot material depth-write decision after `depth_draw_mode` and pass selection are combined. */
  readonly depthWrite?: boolean;
  /**
   * A SHADED mesh particle: Godot's material is not `flags_unshaded` / not
   * `SHADING_MODE_UNSHADED`, so its albedo is lit rather than emitted flat. Requires
   * {@link particleGeometry} — three.quarks lights `RenderMode.Mesh` and nothing else — and the
   * reader refuses a lit BILLBOARD rather than setting this. Absent ⇒ the unlit
   * `MeshBasicMaterial` path this carry has always taken.
   */
  readonly lit?: boolean;
  /**
   * `proximity_fade_distance` — the METRES over which Godot's proximity fade takes the particle's
   * alpha to zero as it approaches the geometry behind it. Present ⇔ the material authored
   * `proximity_fade_enabled = true`; absent ⇒ no fade at all and a batch three.quarks compiles
   * exactly as it always did.
   *
   * ## Godot's form, and the one three.quarks ships
   *
   * Godot emits this, verbatim, inside `if (proximity_fade_enabled)` — the GLSL it appends to the
   * generated fragment stage, quoted whole from `scene/resources/material.cpp` at `4.4-stable`
   * (`:1713-1720`, the same lines `translate/particles-dialect.ts` cites), against the
   * `uniform float proximity_fade_distance : hint_range(0.0, 4096.0, 0.01);` declared with it:
   *
   * ```glsl
   * 	// Proximity Fade: Enabled
   * 	float proximity_depth_tex = textureLod(depth_texture, SCREEN_UV, 0.0).r;
   * 	vec4 proximity_view_pos = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, proximity_depth_tex, 1.0);
   * 	proximity_view_pos.xyz /= proximity_view_pos.w;
   * 	ALPHA *= clamp(1.0 - smoothstep(proximity_view_pos.z + proximity_fade_distance, proximity_view_pos.z, VERTEX.z), 0.0, 1.0);
   * ```
   *
   * three.quarks' own soft-particle fade is a DIFFERENT function of a different shape
   * (`soft_fragment.glsl`, quoted in `@vgai/engine/render/soft-particle-depth`): a LINEAR ramp over
   * two distances, multiplied into `gl_FragColor` — every channel, not just alpha. On a mix-blended
   * sprite that darkens where Godot only fades; on an additive one it squares the fade
   * (`rgb·f · a·f` against Godot's `rgb · a·f`). So {@link applyGodotProximityFade} rewrites the
   * batch's fragment stage into Godot's form. Both halves of the difference are closed there, and
   * the RAMP is closed here, by how this distance is carried:
   *
   * `softNearFade = 0`, `softFarFade = proximityFadeDistance` makes quarks' own
   * `saturate(SOFT_INV_FADE_DISTANCE * ((viewDepth - SOFT_NEAR_FADE) - linearDepth))` reduce to
   * `s = saturate(gap / distance)`, where `gap` is exactly Godot's `proximity_view_pos.z - VERTEX.z` in
   * magnitude (quarks' `linearDepth` varying is `-mvPosition.z`, the same positive view distance
   * its `linearize_depth(readDepth)` produces for the scene). Godot's own expression is
   * `clamp(1 - smoothstep(sceneZ + d, sceneZ, VERTEX.z), 0, 1)`, whose interpolant is `1 - s`; and
   * `smoothstep` is symmetric about `(0.5, 0.5)` (`S(x) + S(1-x) = 1` for `S(x) = 3x² - 2x³`), so
   * `1 - S(1 - s)` IS `S(s)`. The carried form is therefore `smoothstep(0.0, 1.0, s)` — Godot's
   * curve exactly, not a resample of it.
   *
   * A value of `0` is refused at translate time rather than carried: it is a division by zero here
   * and `smoothstep(edge, edge, x)` — explicitly undefined in GLSL — there.
   */
  readonly proximityFadeDistance?: number;
  /**
   * `fixed_fps` — the rate the SIMULATION runs at, independent of the drawn frame. Absent or `0` is
   * Godot's own "no fixed simulation rate": every `update(delta)` steps by that `delta`, which is
   * what this carry did before there was a field here, so an emitter that omits it is byte-for-byte
   * the emitter that existed. Non-zero ⇒ {@link CpuParticles3D.update} banks the delta and spends it
   * in whole `1 / fixedFps` steps — see the module header for the loop and its two sources.
   */
  readonly fixedFps?: number;
  /**
   * `preprocess` — SECONDS of simulation burnt in when emission (re)starts, so the effect appears
   * already mid-stream instead of from nothing. Absent or `0` ⇒ no burn. The burn runs on the first
   * {@link CpuParticles3D.update} after each {@link CpuParticles3D.setEmitting}`(true)` /
   * {@link CpuParticles3D.restart}, at `1 / fixedFps` (or Godot's `1 / 30` when there is no fixed
   * rate) — Godot's own seat and Godot's own step size. The burn runs at UNIT speed whatever
   * {@link speedScale} is, which is Godot 4's own save/restore; see the module header.
   */
  readonly preprocess?: number;
  /** Godot 3 applies speed_scale during preprocess; Godot 4 temporarily forces unit speed. */
  readonly preprocessUsesSpeedScale?: boolean;
  /**
   * `speed_scale` — a multiplier on the simulated delta. Absent or `1` is Godot's unit clock, so an
   * emitter that omits it is byte-for-byte the emitter that existed before there was a field here.
   *
   * It multiplies the STEP, never the accumulator: Godot applies it inside `_particles_process`,
   * after the fixed-step loop has decided how many steps to spend and how big each is, so
   * `fixedFps = 60` still spends 60 steps per second of SIM time and each advances the particles by
   * `1/60 · speedScale`. See the module header for both engines' source lines, and for the one
   * thing the scale deliberately does NOT touch (the `preprocess` burn).
   */
  readonly speedScale?: number;
}

/** The live emitter a translated scene holds. `emitter` is placed in the three graph at the node's
 *  transform; `renderer` must sit at the Scene root (identity) and be stepped every frame. */
export interface CpuParticles3D {
  /** three.quarks' `ParticleSystem.emitter` — an `Object3D`, placed at the CPUParticles node's
   *  transform so emission happens where Godot's node is. */
  readonly emitter: Object3D;
  /** three.quarks' renderer for this system. It draws particles in WORLD space, so it must be added
   *  to the Scene root (identity), NOT under the transformed emitter. */
  readonly renderer: BatchedRenderer;
  /** `emitting` — Godot's node action. `true` (re)starts emission (a one-shot re-arms its burst);
   *  `false` stops it. */
  setEmitting(on: boolean): void;
  /**
   * `emitting`, READ back — `starter-kit-3d-platformer` `player.gd:77`/`:92` writes it every
   * physics frame and Godot's property is readable.
   *
   * A compat-owned MIRROR of the last {@link setEmitting}/{@link restart}, for the reason
   * `physics-body-3d.ts`'s axis-lock mirror is one: three.quarks has the pause/play control and no
   * predicate for it. It stays truthful because this object is the only thing in the lane that
   * pauses or plays the system — the factory below starts it paused, which is the `false` this
   * opens at.
   */
  readonly emitting: boolean;
  /** Live particle count, backed by the native continuous rate or one-shot burst generator. */
  amount: number;
  /** Runtime particle lifetime in seconds, backed by the native system duration/life generators. */
  lifetime: number;
  /** Multiplier applied to every native simulation step, without changing fixed-step cadence. */
  speedScale: number;
  /** Seconds of native simulation consumed on the next start/restart. */
  preprocess: number;
  /** Native simulation frequency; zero follows the host's simulation delta directly. */
  fixedFps: number;
  /** Whether native particle positions remain in the emitter's local transform space. */
  localCoords: boolean;
  /** Godot's first draw-pass Mesh Resource, retained as the exact native Three geometry used by
   * three.quarks for every particle instance. Replacing it rebuilds the native renderer batch. */
  drawPass1: BufferGeometry | null;
  /** GeometryInstance3D.material_override: the retained Material Resource feeding the quarks
   * render batch. Multiple particles nodes may hold this exact object. */
  materialOverride: Material;
  /**
   * `restart()` — `starter-kit-3d-platformer` `brick.gd:25`, which re-fires a one-shot burst when
   * a brick breaks.
   *
   * Godot 4's `GPUParticles3D::restart()` clears the live particles and sets `emitting` true, so it
   * is EXACTLY what `emitting = true` already does here (three.quarks' `restart()` rewinds time and
   * re-emits, then `play()`). It is named separately rather than left to the caller because the two
   * are two Godot members, and one emitted spelling for two idioms is how a claim stops being
   * checkable.
   */
  restart(): void;
  /** The number of live particles — three.quarks' own `ParticleSystem.particleNum`. A stable
   *  observation point (proof that emission actually happened), not a control. */
  readonly particleCount: number;
  /**
   * Step the simulation + renderer by `delta` SIM seconds — the delta the host's tick hands the
   * translated scene's animate walk, never a clock this object reads.
   *
   * With no `fixed_fps` this is one `BatchedRenderer.update(delta)`, as it always was. With one, it
   * is Godot's accumulator: bank the delta, spend it in whole `1 / fixed_fps` steps, carry the
   * remainder to the next call — so the simulation advances the same number of steps for a given
   * span of sim time whatever the frame rate, and a `preprocess` burn-in runs first on the frame
   * after emission (re)starts. The module header quotes both engines' loops.
   */
  update(delta: number): void;
  /** Remove the system from its renderer, detach the renderer, and dispose the material/texture. */
  dispose(): void;
}

const retainedParticleMaterials = new WeakMap<Material, number>();

function retainParticleMaterial(material: Material): void {
  retainedParticleMaterials.set(material, (retainedParticleMaterials.get(material) ?? 0) + 1);
}

function releaseParticleMaterial(material: Material): void {
  const remaining = (retainedParticleMaterials.get(material) ?? 1) - 1;
  if (remaining > 0) {
    retainedParticleMaterials.set(material, remaining);
    return;
  }
  retainedParticleMaterials.delete(material);
  material.dispose();
}

/** Capture the factory-built material as the authored material_override Resource. */
export function captureGodotCpuParticles3DMaterialOverride(
  particles: CpuParticles3D,
  source: GodotSpatialMaterialAnimationState,
): Material {
  bindGodotSpatialMaterialAnimationState(particles.materialOverride, source);
  return particles.materialOverride;
}

/** Seat an already-retained material_override Resource on another particles renderer. */
export function setGodotCpuParticles3DMaterialOverride(
  particles: CpuParticles3D,
  material: Material,
): void {
  particles.materialOverride = material;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * The faithful carrier of Godot 3.6 CPUParticles' emission: POSITION from the emission volume and
 * VELOCITY from `direction`-within-`spread`, reproduced through three.quarks' own `EmitterShape`
 * interface. three.quarks sets `particle.startSpeed` from the system's `startSpeed` generator before
 * calling {@link initialize}, so this normalises the sampled direction and scales by it — the same
 * `velocity.normalize().multiplyScalar(startSpeed)` contract three.quarks' built-in emitters use.
 */
export class GodotCpuEmitter implements EmitterShape {
  readonly type = 'godot_cpu';

  constructor(
    private readonly emission: GodotEmissionShape,
    private readonly direction: readonly [number, number, number],
    private readonly spreadRad: number,
    /** `particle_flag_disable_z` — a PLANAR emitter: the spread becomes Godot's 2D fan and the
     *  spawn pins `z` to 0 on both position and velocity. See the module header. */
    private readonly disableZ = false,
  ) {}

  // biome-ignore lint/suspicious/noExplicitAny: three.quarks' Particle carries quarks.core Vector3s.
  initialize(particle: any): void {
    const p = particle.position;
    switch (this.emission.shape) {
      case 'point':
        p.set(0, 0, 0);
        break;
      case 'sphere': {
        // A uniform point in the sphere VOLUME (cube-root radius), the same draw Godot's box shape has.
        const r = this.emission.radius * Math.cbrt(Math.random());
        const theta = Math.random() * 2 * Math.PI;
        const cosPhi = Math.random() * 2 - 1;
        const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
        p.set(r * sinPhi * Math.cos(theta), r * sinPhi * Math.sin(theta), r * cosPhi);
        break;
      }
      case 'sphere-surface': {
        // Godot 4 EMISSION_SHAPE_SPHERE_SURFACE: a uniform direction on the sphere with radius
        // fixed at the authored value (the volume variant above is the same draw with cbrt(rand)).
        const theta = Math.random() * 2 * Math.PI;
        const cosPhi = Math.random() * 2 - 1;
        const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
        p.set(
          this.emission.radius * sinPhi * Math.cos(theta),
          this.emission.radius * sinPhi * Math.sin(theta),
          this.emission.radius * cosPhi,
        );
        break;
      }
      case 'box': {
        const [ex, ey, ez] = this.emission.extents;
        p.set(
          (Math.random() * 2 - 1) * ex,
          (Math.random() * 2 - 1) * ey,
          (Math.random() * 2 - 1) * ez,
        );
        break;
      }
    }

    const [dx, dy, dz] = this.direction;
    if (this.disableZ) {
      // Godot's PLANAR spread, verbatim: one angle in the XY plane, about `direction`'s own
      // bearing. `float angle1_rad = Math::atan2(direction.y, direction.x) + (Math::randf() * 2.0
      // - 1.0) * Math_PI * spread / 180.0; Vector3 rot = Vector3(cos(angle1_rad),
      // sin(angle1_rad), 0.0);` (3.6-stable, cpu_particles.cpp:769-772). 4.4's shader writes the
      // same expression with an explicit `direction.x == 0` guard whose two arms
      // (`sign(direction.y) * pi/2`) are what `atan2` already returns there.
      const angle = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * this.spreadRad;
      particle.velocity.set(Math.cos(angle), Math.sin(angle), 0);
      particle.velocity.normalize().multiplyScalar(particle.startSpeed);
      // Godot's spawn ALSO does `p.velocity.z = 0.0; p.transform.origin.z = 0.0;` (3.6
      // `cpu_particles.cpp:899-902`; 4.4 `particle_process_material.cpp:907-909`). The velocity is
      // already planar above, and the POSITION's `z` is {@link GodotCpuPlanar}'s — see there for
      // why that is one owner rather than a dropped statement.
      return;
    }

    // Velocity: `direction`, perturbed within the spread cone (uniform over the cap's solid angle),
    // then normalised and scaled by three.quarks' `startSpeed` — Godot's `initial_velocity`.
    let len = Math.hypot(dx, dy, dz);
    if (len === 0) len = 1;
    const ax = dx / len;
    const ay = dy / len;
    const az = dz / len;
    const cosTheta = 1 - Math.random() * (1 - Math.cos(this.spreadRad));
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = Math.random() * 2 * Math.PI;
    // Cone sample around +Z, then rotate +Z onto the axis.
    const lx = sinTheta * Math.cos(phi);
    const ly = sinTheta * Math.sin(phi);
    const lz = cosTheta;
    rotateZOnto(particle.velocity, lx, ly, lz, ax, ay, az);
    particle.velocity.normalize().multiplyScalar(particle.startSpeed);
  }

  update(): void {
    // Godot's emission distribution has no per-frame state; each particle is sampled at birth.
  }

  toJSON(): { type: string } {
    return { type: this.type };
  }

  clone(): EmitterShape {
    return new GodotCpuEmitter(this.emission, this.direction, this.spreadRad, this.disableZ);
  }
}

/**
 * Godot's per-STEP half of `particle_flag_disable_z` — `final_velocity.z = 0` before the position
 * is integrated, `force.z = 0` inside the force block, and `TRANSFORM[3].z = 0` after it (4.4
 * `particle_process_material.cpp:1052-1054,:974-975,:1113-1114`). 3.6 spells the same step as the
 * two lines below, verbatim and in this order — `p.velocity.z = 0.0; p.transform.origin.z = 0.0;`
 * (`cpu_particles.cpp:1001-1004`) sitting immediately before its own
 * `p.transform.origin += p.velocity * local_delta` at `:1006`; it has no `force.z` clause and
 * wipes the `z` off the velocity after the force block instead, which is the same fixed point.
 *
 * All three collapse to the two lines below because a behaviour runs BEFORE three.quarks
 * integrates `position += velocity · delta`: zeroing the velocity's `z` here is Godot's
 * `final_velocity.z = 0` (and subsumes `force.z = 0`, which only exists to keep the velocity
 * planar), and zeroing the position's `z` here is Godot's `TRANSFORM[3].z = 0` one step earlier —
 * the same fixed point, since a planar velocity never adds any `z` back.
 *
 * This is the SINGLE owner of the position's `z`, including at SPAWN. Godot zeroes it there too,
 * and {@link GodotCpuEmitter} deliberately does not: three.quarks emits a burst and runs the
 * behaviours over it inside the SAME `update` call (`ParticleSystem.ts:1009-1039` — `emit`, then
 * the behaviour loop, then the integration), so a particle is never observed, drawn or integrated
 * with the `z` its emission volume drew. Measured rather than argued: removing the emitter shape's
 * own zeroing changes nothing any test can see, and a second writer for one invariant is what this
 * lane's "one owner" rule exists to prevent.
 */
export class GodotCpuPlanar implements Behavior {
  readonly type = 'godot_cpu_planar';

  initialize(): void {
    // No per-particle state: `update` is a fixed point, so the first one does the spawn's work.
  }

  update(particle: Particle): void {
    particle.velocity.z = 0;
    particle.position.z = 0;
  }

  frameUpdate(): void {
    // No per-frame state.
  }

  toJSON(): { type: string } {
    return { type: this.type };
  }

  clone(): Behavior {
    return new GodotCpuPlanar();
  }

  reset(): void {
    // No state to reset.
  }
}

/**
 * Godot's whole force block — `force = gravity + normalize(VELOCITY) · linear_accel`, applied as
 * ONE `VELOCITY += force · DELTA` — for the emitters that author a `linear_accel`. See the module
 * header for both engines' source and for why this replaces three.quarks' `ApplyForce` rather
 * than running beside it.
 *
 * `linear_accel` is drawn once per particle from {@link accel} (a `ConstantValue` or, for a Godot
 * range, an `IntervalValue` reading this particle's own memory) — Godot's
 * `params.linear_accel = mix(linear_accel_min, linear_accel_max, rand_from_seed(alt_seed))`.
 */
export class GodotCpuForce implements Behavior {
  readonly type = 'godot_cpu_force';

  constructor(
    private readonly gravity: readonly [number, number, number],
    private readonly accel: ValueGenerator,
  ) {}

  initialize(particle: Particle): void {
    this.accel.startGen(particle.memory);
  }

  update(particle: Particle, delta: number): void {
    const v = particle.velocity;
    const [gx, gy, gz] = this.gravity;
    let fx = gx;
    let fy = gy;
    let fz = gz;
    // `force += r_p.velocity.length() > 0.0 ? r_p.velocity.normalized() * linear_accel : Vector3();`
    const len = Math.hypot(v.x, v.y, v.z);
    if (len > 0) {
      const a = this.accel.genValue(particle.memory);
      fx += (v.x / len) * a;
      fy += (v.y / len) * a;
      fz += (v.z / len) * a;
    }
    // `r_p.velocity += force * p_local_delta;` — the one place the sum is applied.
    v.x += fx * delta;
    v.y += fy * delta;
    v.z += fz * delta;
  }

  frameUpdate(): void {
    // No per-frame state: `linear_accel` is per-particle, not per-frame.
  }

  toJSON(): { type: string } {
    return { type: this.type };
  }

  clone(): Behavior {
    return new GodotCpuForce(this.gravity, this.accel.clone());
  }

  reset(): void {
    // No state to reset.
  }
}

/**
 * Godot's damping block — the SPEED loses `damping` units per second, clamped at zero, with the
 * direction re-applied unchanged. Quoted whole from both engines in the module header, which also
 * states why this is a behaviour of its own rather than a term of {@link GodotCpuForce}'s sum.
 *
 * `damping` is drawn once per particle from {@link damping} (a `ConstantValue`, or an
 * `IntervalValue` reading this particle's own memory for a Godot range) — Godot's
 * `params.damping = mix(damping_min, damping_max, rand_from_seed(alt_seed))`.
 */
export class GodotCpuDamping implements Behavior {
  readonly type = 'godot_cpu_damping';

  constructor(private readonly damping: ValueGenerator) {}

  initialize(particle: Particle): void {
    this.damping.startGen(particle.memory);
  }

  update(particle: Particle, delta: number): void {
    // `if (physics_params.damping > 0.0) {` — Godot's gate, re-read every step against THIS
    // particle's own draw, so a range straddling 0 damps only the particles that drew above it.
    const damp = this.damping.genValue(particle.memory);
    if (!(damp > 0)) return;
    const v = particle.velocity;
    // `float v = length(VELOCITY);`
    const speed = Math.hypot(v.x, v.y, v.z);
    // A particle already at rest takes Godot's `v < 0.0` arm for any `damp · DELTA > 0` and is
    // assigned the zero vector it already holds, so returning is the same state — and it is the one
    // input on which the `else` arm's `normalize` would divide by zero (Godot 3's `Vector3` returns
    // a zero axis there and GLSL's `normalize` is undefined, so the two engines would not even
    // agree). Nothing else reaches it: `damp > 0` is gated above and `delta` is positive.
    if (speed === 0) return;
    // `v -= physics_params.damping * DELTA;`
    const damped = speed - damp * delta;
    // `if (v < 0.0) { VELOCITY = vec3(0.0); } else { VELOCITY = normalize(VELOCITY) * v; }`
    if (damped < 0) {
      v.x = 0;
      v.y = 0;
      v.z = 0;
      return;
    }
    const scale = damped / speed;
    v.x *= scale;
    v.y *= scale;
    v.z *= scale;
  }

  frameUpdate(): void {
    // No per-frame state: `damping` is per-particle, not per-frame.
  }

  toJSON(): { type: string } {
    return { type: this.type };
  }

  clone(): Behavior {
    return new GodotCpuDamping(this.damping.clone());
  }

  reset(): void {
    // No state to reset.
  }
}

/** quarks' generators take a memory slot; `PiecewiseBezier`'s is unused, and one shared empty
 *  array keeps the per-particle read allocation-free. */
const _curveMemory: never[] = [];

/**
 * Godot 4's independent `alpha_curve`, multiplied after the ordinary particle colour ramp.
 *
 * The curve is evaluated by the SAME object the size curve is emitted as — quarks'
 * `PiecewiseBezier` over {@link godotCurveJSON}'s control points — rather than by a second
 * hand-written cubic. One evaluator, so the two cannot disagree.
 */
export class GodotAlphaOverLife implements Behavior {
  readonly type = 'godot_alpha_over_life';

  private readonly curve: PiecewiseBezier;

  constructor(private readonly points: readonly GodotCurvePoint[]) {
    this.curve = PiecewiseBezier.fromJSON(godotCurveJSON(points));
  }

  initialize(): void {
    // The curve is deterministic and owns no per-particle random state.
  }

  update(particle: Particle): void {
    // Godot's `Curve::interpolate` HOLDS the endpoint value outside the curve's own domain, and
    // the segments below already span [0,1]; clamping is that hold, and it is also what keeps a
    // particle whose age has just passed its life off `PiecewiseBezier`'s out-of-range 0.
    const t = particle.age / particle.life;
    particle.color.w *= this.curve.genValue(_curveMemory, t < 0 ? 0 : t > 1 ? 1 : t);
  }

  frameUpdate(): void {
    // No per-frame state.
  }

  toJSON(): { type: string } {
    return { type: this.type };
  }

  clone(): Behavior {
    return new GodotAlphaOverLife(this.points);
  }

  reset(): void {
    // No state to reset.
  }
}

function retainedGradient(value: Exclude<CpuGradientResource, readonly CpuGradientStop[]>): GodotGradient {
  if (value instanceof GodotGradient) return value;
  const gradient = value.get_gradient();
  if (gradient === null) throw new Error('ParticlesMaterial.color_ramp GradientTexture has no Gradient.');
  return gradient;
}

/**
 * A live Godot Gradient resource on three.quarks' Behavior extension seam. Unlike descriptor JSON,
 * this reads the retained Resource on every particle update, so `set_color`, `set_offset`, and a
 * GradientTexture's replacement `gradient` take effect without replacing the particle system.
 */
export class GodotGradientOverLife implements Behavior {
  readonly type = 'godot_gradient_over_life';

  constructor(
    private readonly resource: Exclude<CpuGradientResource, readonly CpuGradientStop[]>,
    private readonly isSrgb: boolean,
  ) {}

  initialize(): void {
    // The retained Gradient owns its points; this behavior owns no per-particle random state.
  }

  update(particle: Particle): void {
    const t = particle.age / particle.life;
    const sampled = retainedGradient(this.resource).sample(t < 0 ? 0 : t > 1 ? 1 : t);
    const encode = this.isSrgb ? srgbToLinear : (component: number): number => component;
    particle.color.set(
      encode(sampled.r) * particle.startColor.x,
      encode(sampled.g) * particle.startColor.y,
      encode(sampled.b) * particle.startColor.z,
      sampled.a * particle.startColor.w,
    );
  }

  frameUpdate(): void {
    // Resource changes are read directly by update; no cached generator needs rebuilding.
  }

  toJSON(): { type: string } {
    return { type: this.type };
  }

  clone(): Behavior {
    return new GodotGradientOverLife(this.resource, this.isSrgb);
  }

  reset(): void {
    // No state to reset.
  }
}

/**
 * Godot's `particle_flag_align_y` (with `particle_flag_disable_z` choosing which of its two
 * branches runs), transcribed onto three.quarks' per-particle mesh QUATERNION. The block this
 * reproduces is quoted in the module header; both engines write it identically.
 *
 * The quaternion IS the particle's basis, so each step expands it to Godot's three `TRANSFORM`
 * columns with the same expansion `local_particle_vert.glsl` uses, runs Godot's statements in
 * Godot's order, and packs the result back. A particle whose velocity is exactly zero takes
 * Godot's `else` arm — "keep the axis you have" — which leaves the quaternion untouched.
 */
export class GodotAlignYToVelocity implements Behavior {
  readonly type = 'godot_align_y';

  constructor(private readonly disableZ: boolean) {}

  initialize(): void {
    // three.quarks has already given a mesh particle its `startRotation` quaternion.
  }

  update(particle: Particle): void {
    const q = particle.rotation;
    if (!(q instanceof Quaternion)) return;
    const v = particle.velocity;
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed === 0) return;
    const y: Vec3 = [v.x / speed, v.y / speed, v.z / speed];
    if (this.disableZ) {
      // `set_axis(0, get_axis(1).cross(get_axis(2)).normalized()); set_axis(2, Vector3(0, 0, 1));`
      // — the X axis is derived from the axis-2 the particle STILL HAS (which is `(0,0,1)` from the
      // second step on, and the emitter's own third column before that), and only then is axis-2
      // pinned. Reading the live column rather than assuming `(0,0,1)` is what keeps a world-space
      // emitter with a rotated node right on its particles' first step.
      const [, , c2] = columns(q);
      const x = normalized(cross(y, c2));
      if (x === undefined) return;
      pack(q, x, y, [0, 0, 1]);
      return;
    }
    const [c0, , c2] = columns(q);
    const x0 = normalized(c0) ?? c0;
    const z0 = normalized(c2) ?? c2;
    // `if (get_axis(1) == get_axis(0))` — Godot's degeneracy guard, an EXACT component-wise
    // equality in both engines (a `Vector3::operator==` in 3.6, a GLSL `vec3 ==` in 4.4). It is
    // reproduced as an exact comparison here too; the arms differ in which axis is derived first,
    // and only a velocity that lands exactly on the current X axis takes the first one.
    if (y[0] === x0[0] && y[1] === x0[1] && y[2] === x0[2]) {
      const x = normalized(cross(y, z0));
      if (x === undefined) return;
      const z = normalized(cross(x, y));
      if (z === undefined) return;
      pack(q, x, y, z);
      return;
    }
    const z = normalized(cross(x0, y));
    if (z === undefined) return;
    const x = normalized(cross(y, z));
    if (x === undefined) return;
    pack(q, x, y, z);
  }

  frameUpdate(): void {
    // No per-frame state.
  }

  toJSON(): { type: string } {
    return { type: this.type };
  }

  clone(): Behavior {
    return new GodotAlignYToVelocity(this.disableZ);
  }

  reset(): void {
    // No state to reset.
  }
}

/** One basis axis. */
type Vec3 = readonly [number, number, number];

/** `a × b`. */
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** `v.normalized()`, or `undefined` for the zero vector — the case Godot's `.normalized()` leaves
 *  as a zero axis and this transcription declines to write, keeping the last valid basis. */
function normalized(v: Vec3): Vec3 | undefined {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) return undefined;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Scratch for the quaternion↔basis pair below. Module-scoped because both run per PARTICLE per
 *  step, and a fresh matrix per particle is garbage the emitter would generate every frame. */
const _basis = new Matrix4();
const _c0 = new Vector3();
const _c1 = new Vector3();
const _c2 = new Vector3();

/** A rotation quaternion expanded to its three basis COLUMNS — quarks' own
 *  `Matrix4.makeRotationFromQuaternion`, which is the identical expansion three.quarks'
 *  `local_particle_vert.glsl` runs on the `rotation` attribute to build the particle matrix
 *  (`compose` with a unit scale: the same nine products, each multiplied by an exact 1). */
function columns(q: Quaternion): [Vec3, Vec3, Vec3] {
  const e = _basis.makeRotationFromQuaternion(q).elements;
  return [
    [e[0] as number, e[1] as number, e[2] as number],
    [e[4] as number, e[5] as number, e[6] as number],
    [e[8] as number, e[9] as number, e[10] as number],
  ];
}

/** The inverse of {@link columns}: three orthonormal basis columns packed back into `q`, through
 *  quarks' own `Quaternion.setFromRotationMatrix` — Shepperd's method, branch on the largest
 *  diagonal term, expression for expression what this file used to spell out. */
function pack(q: Quaternion, c0: Vec3, c1: Vec3, c2: Vec3): void {
  q.setFromRotationMatrix(
    _basis.makeBasis(
      _c0.set(c0[0], c0[1], c0[2]),
      _c1.set(c1[0], c1[1], c1[2]),
      _c2.set(c2[0], c2[1], c2[2]),
    ),
  );
}

/** Godot's `mix(min, max, rand)` as three.quarks' own generator INSTANCE — a `ConstantValue` when
 *  the two bounds agree (which is what an emitter authoring a single value has), an
 *  `IntervalValue` otherwise. See the module header for why `IntervalValue` IS Godot's draw. */
function paramGenerator(range: GodotParamRange): ValueGenerator {
  if (typeof range === 'number') return new ConstantValue(range);
  const [min, max] = range;
  return min === max ? new ConstantValue(min) : new IntervalValue(min, max);
}

/** The same draw as {@link paramGenerator}, in the engine descriptor's JSON vocabulary — for the
 *  two parameters the shared factory builds itself (`startSpeed`, `startSize`). */
function rangeGenerator(range: GodotParamRange): ValueGeneratorJSON {
  if (typeof range === 'number') return { type: 'ConstantValue', value: range };
  const [min, max] = range;
  return min === max
    ? { type: 'ConstantValue', value: min }
    : { type: 'IntervalValue', a: min, b: max };
}

/** `+Z`, the axis the cone above is sampled around. */
const _zAxis = new Vector3(0, 0, 1);
/** Scratch for {@link rotateZOnto}: the target axis and the shortest-arc rotation onto it. */
const _coneAxis = new Vector3();
const _coneRotation = new Quaternion();

/**
 * Rotate the unit vector `(lx,ly,lz)` (sampled about +Z) so that +Z maps onto the unit axis
 * `(ax,ay,az)`, in place on `out`.
 *
 * The rotation is quarks' own `Quaternion.setFromUnitVectors` — the shortest arc between two unit
 * vectors, which is the same rotation the hand-rolled Rodrigues expansion this replaced computed,
 * without its 1e-6 identity/flip cliff (that guard existed only because Rodrigues divides by
 * `sin(angle)`; the half-way-quaternion form has no such division). The one place the two differ
 * is the exactly ANTIPARALLEL axis, where the perpendicular is arbitrary: quarks picks a 180°
 * turn about -Y and the old expansion picked one about +X. Both take +Z to -Z, and the cone's own
 * `phi` is uniform about that axis, so the emitted distribution is the same one.
 */
function rotateZOnto(
  out: Vector3,
  lx: number,
  ly: number,
  lz: number,
  ax: number,
  ay: number,
  az: number,
): void {
  out
    .set(lx, ly, lz)
    .applyQuaternion(_coneRotation.setFromUnitVectors(_zAxis, _coneAxis.set(ax, ay, az)));
}

/**
 * The Godot particle material as the engine's shared `ParticlesDescriptor` material — shading
 * model, blend, opacity/depth, cull side and, when present, the sprite texture path. The shared
 * factory turns this into the three material three.quarks patches with the per-particle
 * colour/size/rotation.
 *
 * ## `type`: which of three.quarks' two particle shaders draws this
 *
 * `basic` ⇒ a `MeshBasicMaterial`, which three.quarks wraps in `particle_vert`/`local_particle_vert`
 * + `particle_frag` — flat, unlit, the path every emitter here took before there was a
 * {@link GodotCpuParticles3DSpec.lit}. `standard` ⇒ a `MeshStandardMaterial`, which in
 * `RenderMode.Mesh` swaps in `local_particle_physics_vert`/`particle_physics_frag`
 * (`three.quarks@0.16.0` `src/SpriteBatch.ts:180-190`) — three's own `STANDARD` shader with the
 * per-particle instancing matrix in the vertex stage, so the instanced copies are LIT by the
 * scene's lights exactly as Godot's shaded particle is.
 *
 * The lit/unlit split is DECIDED upstream (`translate/scene-module-3d.ts`'s `cpuMeshShading`, one
 * owner for both dialects) and it is checked on the MESH path only, because that is the only path
 * three.quarks can light. A lit BILLBOARD is a standing gap in the reader, not a property of this
 * file: the QuadMesh branch reads the same colour properties and never looks at `flags_unshaded`,
 * so it arrives here and draws unlit. Closing it touches every committed port that draws a sprite,
 * so it is its own unit.
 *
 * ## `transparent`/`depthWrite`: Godot's alpha-pass decision, spent on three's two knobs
 *
 * Godot puts a surface in its alpha pass when `has_alpha = has_base_alpha || uses_blend_alpha`
 * (`SceneShaderForwardClustered::ShaderData::uses_alpha_pass()`,
 * `servers/rendering/renderer_rd/forward_clustered/scene_shader_forward_clustered.h:253-261`,
 * 4.4-stable), and gives the OPAQUE branch `FLAG_PASS_DEPTH` while the alpha branch gets it only
 * under a depth-prepass transparency (`render_forward_clustered.cpp:3976-3986`). So depth-write is
 * exactly the complement of the pass, which is why there is one spec field and not two.
 *
 * three's predicates coincide with Godot's on the term that matters. `#define OPAQUE` is set when
 * `material.transparent === false && material.blending === NormalBlending`
 * (`three/src/renderers/webgl/WebGLPrograms.js:251`) and forces `diffuseColor.a = 1.0`
 * (`<opaque_fragment>`) — which is Godot's opaque material never writing `ALPHA` at all, since the
 * generated shader emits `ALPHA *= albedo.a * albedo_tex.a;` only when
 * `transparency != TRANSPARENCY_DISABLED` (`scene/resources/material.cpp:1700-1701`). And three
 * keeps blending on for a non-normal blend whatever `transparent` says
 * (`WebGLState.js:774-776`), so an additive Godot material draws additively either way — it is
 * carried as `transparent` regardless because Godot's `uses_blend_alpha` puts it in the alpha
 * pass, where it does not write depth.
 *
 * ## `roughness`/`metalness`/`emissive` are deliberately absent, and that is exact
 *
 * Godot's `BaseMaterial3D` constructor opens at `set_roughness(1.0)`, `set_metallic(0.0)`,
 * `set_emission(Color(0, 0, 0))` and `set_specular(0.5)` (`scene/resources/material.cpp:3467-3471`);
 * three's `MeshStandardMaterial` opens at `roughness = 1.0`, `metalness = 0.0`,
 * `emissive = 0x000000`, and its dielectric F0 is the fixed `vec3( 0.04 )` of
 * `<lights_physical_fragment>` — precisely Godot's `F0 = 0.16 * specular * specular` at
 * `specular = 0.5` (`scene_forward_lights_inc.glsl:48-53`). The two engines' defaults are the same
 * numbers, so a material that authors none of them needs no field here; one that DOES author them
 * refuses by name at read time rather than arriving with a term this descriptor cannot carry.
 *
 * ## Deliberately NO `color`, on either shading model
 *
 * `particle_frag.glsl` shades a `MeshBasicMaterial` from the per-particle colour alone and declares
 * no `diffuse` uniform, so a colour here would be dead weight on the unlit path. On the LIT path
 * `diffuse` IS read — `vec4 diffuseColor = vec4( diffuse, opacity )` — but the product three then
 * computes, `diffuse · map · vColor` through `<map_fragment>` and `<color_fragment>`, is the same
 * `albedo · albedo_tex · COLOR` Godot computes, so the albedo may ride EITHER term. It keeps riding
 * {@link startColorGradient} with the ramp and `CPUParticles.color`, because that is one colour
 * composition for both shaders instead of two that must agree.
 */
function materialDescriptor(spec: GodotCpuParticles3DSpec): ParticlesDescriptor['material'] {
  const sampler = mapSampler(spec.textureSampler);
  return {
    type: spec.lit === true ? 'standard' : 'basic',
    ...(spec.texture !== undefined ? { map: spec.texture } : {}),
    ...(sampler === undefined ? {} : { mapSampler: sampler }),
    blending: spec.blend === 'add' ? 'additive' : 'normal',
    transparent: spec.transparent,
    depthWrite: spec.depthWrite ?? !spec.transparent,
    // Godot's `cull_mode`, already translated to three's own DRAWN-faces vocabulary at read time.
    // Absent leaves the factory's default alone, so an emitter authoring no cull mode is unchanged.
    ...(spec.side === undefined ? {} : { side: spec.side }),
  };
}

/** Godot's `.import` sampler vocabulary as the engine descriptor's own — one rename (`repeat`,
 *  Godot's single flag for both axes, is three's `wrap`), everything else carried by name. An
 *  absent field stays absent so the factory leaves three's default alone. */
function mapSampler(
  config: Omit<GodotTextureConfig, 'sampling'> | undefined,
): ParticlesDescriptor['material']['mapSampler'] {
  if (config === undefined) return undefined;
  const sampler = {
    ...(config.repeat === undefined ? {} : { wrap: config.repeat }),
    ...(config.filter === undefined ? {} : { filter: config.filter }),
    ...(config.mipmaps === undefined ? {} : { mipmaps: config.mipmaps }),
    ...(config.anisotropy === undefined ? {} : { anisotropy: config.anisotropy }),
  };
  return Object.keys(sampler).length === 0 ? undefined : sampler;
}

/**
 * Godot 3.6/GLES3's sRGB→linear decode, the exact `mix(pow((c+0.055)/1.055, 2.4), c/12.92,
 * lessThan(c, 0.04045))` its generated SpatialMaterial shader runs on an authored `Color`.
 *
 * **Deliberately not three's `Color.setRGB(…, SRGBColorSpace)`**, which is the door
 * `reflection-probe-3d.ts` uses and the obvious rung to evict onto. Three reasons, in order of
 * weight:
 *
 *  1. That conversion is GATED on a global switch — `ColorManagement.convert` returns the colour
 *     untouched when `ColorManagement.enabled === false`. A host or a port that flips it would
 *     silently stop decoding here, and an undecoded albedo is the pale washed-out emitter this
 *     file's measured colour tables exist to prevent. What this file needs is Godot's shader
 *     arithmetic, which is not a fact about three's working colour space.
 *  2. Three spells the transfer function with rounded reciprocals (`c * 0.0773993808`,
 *     `pow(c * 0.9478672986 + 0.0521327014, 2.4)`) rather than Godot's own divisions, so the
 *     result is no longer the cited expression: measured max |Δ| 2.4e-10 over [0,1]. Harmless as a
 *     colour, but this file's rule is that every number cites Godot.
 *  3. `Color.setRGB` is a three-channel, allocating API, and both call sites need a SCALAR composed
 *     with per-channel flags (`vertex_color_use_as_albedo`, `vertex_color_is_srgb`).
 */
function srgbToLinear(c: number): number {
  return c < 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * The Godot CPUParticles params as the engine's SHARED {@link ParticlesDescriptor} — the JSON the
 * one shared factory reads. Every value here is Godot's own, mapped onto the descriptor's own field:
 * lifecycle (duration/looping/local↔world), the per-particle start generators, the emission rate +
 * one-shot burst, the billboard-vs-mesh render mode, the material, and the behaviour stack (gravity,
 * colour ramp, per-particle spin, size curve). The two shapes JSON cannot carry — Godot's box-volume
 * emission distribution and a mesh particle's `ArrayMesh` — are NOT here; they ride the factory's
 * `objects` companion argument (an `EmitterShape` instance and an `instancingGeometry`).
 */
function particlesDescriptor(spec: GodotCpuParticles3DSpec): ParticlesDescriptor {
  const lifetime = Math.max(spec.lifetime, 0.001);
  const meshParticle = spec.particleGeometry !== undefined;

  const behaviors: BehaviorJSON[] = [];
  // Gravity — a constant acceleration over life. Godot's default is (0,-9.8,0). This is Godot's
  // WHOLE force block whenever gravity is its only term, which is every emitter that authors no
  // `linear_accel`; when one IS authored, `GodotCpuForce` owns the block instead and nothing is
  // emitted here (see the module header for why they cannot both run).
  const [gx, gy, gz] = spec.gravity;
  const gLen = Math.hypot(gx, gy, gz);
  if (gLen > 0 && spec.linearAccel === undefined) {
    behaviors.push({
      type: 'ApplyForce',
      direction: [gx / gLen, gy / gLen, gz / gLen],
      magnitude: { type: 'ConstantValue', value: gLen },
    });
  }
  // color_ramp — colour + alpha over normalised life, but ONLY under `vertex_color_use_as_albedo`:
  // Godot's shader multiplies the whole `COLOR` vec4 into albedo under that flag and does not touch
  // it otherwise, so an emitter whose material leaves the flag off (Godot's default) neither tints
  // nor fades. three.quarks' `ColorOverLife` MULTIPLIES this gradient into `startColor`, which is
  // exactly Godot's `CPUParticles.color · color_ramp(t)` product.
  if (
    spec.vertexColorAsAlbedo &&
    ((Array.isArray(spec.colorRamp) && spec.colorRamp.length > 0) ||
      (spec.alphaCurve !== undefined && spec.alphaCurve.length > 0))
  ) {
    const ramp = (Array.isArray(spec.colorRamp) ? spec.colorRamp : undefined) ?? [
      { offset: 0, r: 1, g: 1, b: 1, a: 1 },
      { offset: 1, r: 1, g: 1, b: 1, a: 1 },
    ];
    behaviors.push({
      type: 'ColorOverLife',
      color: rampGradient(ramp, spec.vertexColorIsSrgb),
    });
  }
  // angular_velocity — a per-particle CONSTANT billboard spin. Godot 3.6's `_particle_process` accrues
  // `custom[0] = deg2rad(age * angular_velocity * lerp(1, rand*2-1, angular_velocity_random))`, i.e. a
  // fixed-per-particle rate whose factor is uniform in `[1-2*random, 1]`. three.quarks' RotationOverLife
  // accumulates `rotation += delta * angularVelocity` on the numeric billboard rotation, so the mapped
  // generator IS that per-particle rate in RAD/sec: a ConstantValue when there is no randomness, else an
  // IntervalValue over `[rate*(1-2*random), rate]` — sampled ONCE per particle by three.quarks' interval
  // memory (`IntervalValue.startGen`), the same "each particle draws one fixed spin" model Godot has.
  if (spec.angularVelocityDeg !== 0) {
    const rateRad = spec.angularVelocityDeg * DEG_TO_RAD;
    const random = spec.angularVelocityRandom;
    behaviors.push({
      type: 'RotationOverLife',
      angularVelocity:
        random === 0
          ? { type: 'ConstantValue', value: rateRad }
          : { type: 'IntervalValue', a: rateRad * (1 - 2 * random), b: rateRad },
    });
  }
  // scale_amount_curve — per-particle SIZE over normalised life. three.quarks' SizeOverLife does
  // `particle.size = startSize · gen(age/life)`, and startSize is `scale_amount`, so the generator IS
  // Godot's `curve.interpolate(life_fraction)` and the product is Godot's `scale_amount · interpolate`.
  if (spec.scaleAmountCurve !== undefined && spec.scaleAmountCurve.length > 0) {
    behaviors.push({ type: 'SizeOverLife', size: godotCurveJSON(spec.scaleAmountCurve) });
  }

  return {
    duration: lifetime,
    looping: !spec.oneShot,
    worldSpace: !spec.localCoords,
    // A `mesh` that is a decoded ArrayMesh renders in three.quarks' MESH render mode — one copy of the
    // geometry per particle, its `startSize` the uniform per-particle scale and its per-particle colour
    // multiplied into the fragment (`vertex_color_use_as_albedo` in Godot) — exactly as Godot's
    // CPUParticles draws a non-quad `mesh`. Absent ⇒ the default camera-facing billboard quad sprite.
    renderMode: meshParticle ? 'mesh' : 'billboard',
    // `proximity_fade_enabled` — see {@link GodotCpuParticles3DSpec.proximityFadeDistance} for why
    // the near fade is 0 and the far fade is Godot's whole distance. Those two make three.quarks'
    // own ramp the `saturate(gap / distance)` Godot's `smoothstep` interpolates over;
    // {@link applyGodotProximityFade} supplies the curve and moves the product onto ALPHA.
    // `softParticles` is what compiles the batch's depth sampler in at all, and the engine's
    // `registerParticleSystem` reads it to arm the scene-depth prepass that fills it.
    ...(spec.proximityFadeDistance === undefined
      ? {}
      : {
          softParticles: true,
          softNearFade: 0,
          softFarFade: spec.proximityFadeDistance,
        }),
    startLife:
      spec.lifetimeRandomness === undefined || spec.lifetimeRandomness === 0
        ? { type: 'ConstantValue', value: lifetime }
        : {
            type: 'IntervalValue',
            a: lifetime * (1 - spec.lifetimeRandomness),
            b: lifetime,
          },
    // Godot's `mix(min, max, rand)` per particle — a `ConstantValue` when both of its bounds agree,
    // so an emitter authoring a single value writes the generator it always wrote.
    startSpeed: rangeGenerator(spec.initialVelocity),
    startSize: rangeGenerator(spec.scaleAmount),
    startRotation: rangeGenerator(scaleParamRange(spec.initialAngleDeg ?? 0, DEG_TO_RAD)),
    startColor: startColorGradient(spec),
    // A one-shot fires the whole `amount` at once (explosiveness 1); a continuous stream emits
    // `amount` over one lifetime. The reader refuses any partial explosiveness, so these two are all
    // that reach here.
    emissionOverTime: { type: 'ConstantValue', value: spec.oneShot ? 0 : spec.amount / lifetime },
    emissionBursts: spec.oneShot
      ? [
          {
            time: 0,
            count: { type: 'ConstantValue', value: spec.amount },
            cycle: 1,
            interval: 0,
            probability: 1,
          },
        ]
      : [],
    behaviors,
    material: materialDescriptor(spec),
  };
}

/** Scale both arms of a Godot scalar/range without changing where its one per-particle draw lives. */
function scaleParamRange(range: GodotParamRange, factor: number): GodotParamRange {
  return typeof range === 'number' ? range * factor : [range[0] * factor, range[1] * factor];
}

/**
 * three.quarks' own soft-particle fade, VERBATIM (`three.quarks@0.16.0`,
 * `src/shaders/chunks/soft_fragment.glsl.ts`) — the two statements Godot spells differently, and
 * therefore the two this rewrite replaces. Split in two because they are two separate divergences:
 * the RAMP (linear where Godot smoothsteps) and the TARGET (the whole fragment colour where Godot
 * touches alpha alone).
 */
const QUARKS_SOFT_FADE_RAMP =
  'float softParticlesFade = saturate(SOFT_INV_FADE_DISTANCE * ((viewDepth - SOFT_NEAR_FADE) - linearDepth));';
const QUARKS_SOFT_FADE_APPLY = 'gl_FragColor *= softParticlesFade;';

/** Godot's `smoothstep` over the same interpolant — see {@link GodotCpuParticles3DSpec.proximityFadeDistance}. */
const GODOT_PROXIMITY_FADE_RAMP =
  'float softParticlesFade = smoothstep(0.0, 1.0, saturate(SOFT_INV_FADE_DISTANCE * ((viewDepth - SOFT_NEAR_FADE) - linearDepth)));';
/** Godot's `ALPHA *= …` — alpha alone, so a mix-blended sprite fades without darkening and an
 *  additive one scales once rather than twice. */
const GODOT_PROXIMITY_FADE_APPLY = 'gl_FragColor.a *= softParticlesFade;';

/**
 * three.quarks' fragment stage does not carry the fade inline — it writes
 * `#include <soft_fragment>` and registers the chunk into three's own `ShaderChunk` at import time
 * (`src/shaders/particle_frag.glsl.ts:33`, `src/shaders/chunks/register-shader-chunks.ts`). This
 * is that include, i.e. the seat the rewritten chunk is spliced into.
 */
const QUARKS_SOFT_FADE_INCLUDE = '#include <soft_fragment>';

/**
 * Rewrite one three.quarks batch material's fragment stage from the library's soft-particle fade
 * into Godot's proximity fade.
 *
 * The rewrite is spliced into the batch's OWN `ShaderMaterial` (`SpriteBatch.ts:222-229`) before its
 * first compile — never into `THREE.ShaderChunk['soft_fragment']` itself, which is process-global
 * and shared with every other soft-particle user in the host, including the engine's own
 * quarks-semantics `ParticlesDescriptor.softParticles`. Godot's fade is a Godot fact and stays on
 * Godot's particles.
 *
 * Only the two DIVERGING statements are ours; the sampling around them is copied from the library's
 * live chunk, so a three.quarks release that changes how the depth is read reaches this carry
 * unchanged. And because both anchors are checked HERE, at construction, a release that MOVES either
 * statement fails loudly with the anchor named instead of silently leaving the library's own fade —
 * which is the shape of failure a string rewrite otherwise has.
 *
 * A lit MESH particle is the one case with no fragment source to splice into — three.quarks draws
 * that through `ParticleMeshStandardMaterial`, three's own `MeshStandardMaterial` with the particle
 * chunks spliced in at compile time. The emitter refuses that combination upstream
 * (`translate/scene-module-3d.ts`'s `refuseLitProximityFade`), and this throws if one ever reaches it.
 */
export function applyGodotProximityFade(renderer: BatchedRenderer, at: string): void {
  for (const batch of renderer.batches) {
    const material = batch.material as { fragmentShader?: string; needsUpdate?: boolean };
    const source = material.fragmentShader;
    if (typeof source !== 'string') {
      throw new Error(
        `${at}: a Godot proximity fade on a particle three.quarks draws through ` +
          '`ParticleMeshStandardMaterial` (a lit mesh particle). That material has no readable ' +
          '`fragmentShader` to splice into, so this refuses rather than leaving three.quarks` ' +
          'linear whole-colour fade in place of Godot`s smoothstep on ALPHA.',
      );
    }
    // Already Godot's — the include is spent. Idempotent because `createCpuParticles3D` is not the
    // only thing that may reach a live renderer.
    if (!source.includes(QUARKS_SOFT_FADE_INCLUDE)) continue;
    const chunk = (ShaderChunk as Record<string, string | undefined>)['soft_fragment'];
    if (
      typeof chunk !== 'string' ||
      !chunk.includes(QUARKS_SOFT_FADE_RAMP) ||
      !chunk.includes(QUARKS_SOFT_FADE_APPLY)
    ) {
      throw new Error(
        `${at}: three.quarks' \`soft_fragment\` chunk no longer contains ` +
          `\`${QUARKS_SOFT_FADE_RAMP}\` and \`${QUARKS_SOFT_FADE_APPLY}\`, the two statements this ` +
          'carry rewrites into Godot`s proximity fade. The library moved; re-read ' +
          '`src/shaders/chunks/soft_fragment.glsl.ts` and update both anchors.',
      );
    }
    material.fragmentShader = source.replace(
      QUARKS_SOFT_FADE_INCLUDE,
      chunk
        .replace(QUARKS_SOFT_FADE_RAMP, GODOT_PROXIMITY_FADE_RAMP)
        .replace(QUARKS_SOFT_FADE_APPLY, GODOT_PROXIMITY_FADE_APPLY),
    );
    material.needsUpdate = true;
  }
}

/**
 * Build a live {@link CpuParticles3D} from Godot CPUParticles DATA. The system starts PAUSED — Godot
 * `emitting` defaults false on the fixtures that author a clip to turn it on — so nothing emits until
 * {@link CpuParticles3D.setEmitting} is called.
 *
 * The Godot params become an engine {@link ParticlesDescriptor} and the SHARED factory
 * (`createParticleSystemFromData`) builds the `ParticleSystem` — the exact path the editor
 * entity-factory and runtime scene-loader take. Godot's own box-volume emission (the
 * {@link GodotCpuEmitter} plugin shape) and a mesh particle's decoded `ArrayMesh` — neither
 * JSON-serialisable — ride the factory's `objects` companion argument. `defaultSprite: false` keeps
 * a texture-less billboard the plain colored quad Godot draws (the factory otherwise substitutes an
 * authoring soft-sprite for a map-less material).
 */
export function createCpuParticles3D(spec: GodotCpuParticles3DSpec): CpuParticles3D {
  const shape = new GodotCpuEmitter(
    spec.emission,
    spec.direction,
    spec.spreadDeg * DEG_TO_RAD,
    spec.disableZ === true,
  );

  const objects: ParticleSystemObjects = {
    shape: shape as unknown as EmitterShape,
    defaultSprite: false,
  };
  if (spec.particleGeometry !== undefined) objects.instancingGeometry = spec.particleGeometry;

  const { system } = createParticleSystemFromData(particlesDescriptor(spec), objects);
  retainParticleMaterial(system.material);
  // The behaviours a JSON descriptor cannot carry, in Godot's own per-step order — the force block,
  // then the damping block, then the planar clamp, then the orientation, which is why they are
  // appended in this sequence.
  // `addBehavior` is three.quarks' own registration door (`ParticleSystem.ts:1346`), and the
  // library runs behaviours in registration order before it integrates the position, so appending
  // them after the descriptor's colour/size behaviours (which read neither velocity nor rotation)
  // puts each one exactly where Godot puts it. Damping in particular MUST follow whichever
  // behaviour owns the force write — `GodotCpuForce` here, or the descriptor's own `ApplyForce`
  // (which the factory registered first, ahead of everything appended below) — because Godot damps
  // the velocity that block just wrote.
  if (spec.linearAccel !== undefined) {
    system.addBehavior(new GodotCpuForce(spec.gravity, paramGenerator(spec.linearAccel)));
  }
  if (spec.damping !== undefined)
    system.addBehavior(new GodotCpuDamping(paramGenerator(spec.damping)));
  if (spec.disableZ === true) system.addBehavior(new GodotCpuPlanar());
  if (spec.alignYToVelocity === true) {
    system.addBehavior(new GodotAlignYToVelocity(spec.disableZ === true));
  }
  if (
    spec.vertexColorAsAlbedo &&
    spec.colorRamp !== undefined &&
    !Array.isArray(spec.colorRamp)
  ) {
    system.addBehavior(
      new GodotGradientOverLife(
        spec.colorRamp as Exclude<CpuGradientResource, readonly CpuGradientStop[]>,
        spec.vertexColorIsSrgb,
      ),
    );
  }
  // ColorOverLife (a real ramp, or the flat reset installed above) writes the complete start
  // colour on every update; alpha_curve is Godot's independent multiplier and therefore follows it.
  if (spec.vertexColorAsAlbedo && spec.alphaCurve !== undefined && spec.alphaCurve.length > 0) {
    system.addBehavior(new GodotAlphaOverLife(spec.alphaCurve));
  }
  system.pause();

  const renderer = new BatchedRenderer();
  // The engine's own door, not `renderer.addSystem` directly: it is what arms the scene-depth
  // prepass for a `softParticles` system and what seeds the far-depth default under it, so a fade
  // this emitter asked for is either fed real scene depth or inert — never sampling nothing.
  registerParticleSystem(renderer, system);
  if (spec.proximityFadeDistance !== undefined) {
    applyGodotProximityFade(renderer, 'createCpuParticles3D');
  }

  // The readable half of `emitting` — see the member's doc. The factory above starts the system
  // paused, so this opens false and every later change goes through the two writers below.
  let emitting = false;
  let drawPass1 = spec.particleGeometry ?? null;
  const emptyDrawPass = new BufferGeometry();
  let drawPassChanged: GodotConnection | null = null;
  let materialOverrideChanged: GodotConnection | null = null;
  const rebuildMaterialOverrideBatch = (): void => {
    const batchIndex = renderer.systemToBatchIndex.get(system);
    const batch = batchIndex === undefined ? undefined : renderer.batches[batchIndex];
    if (batch === undefined) {
      throw new Error('CPUParticles3D.material_override has no retained three.quarks render batch.');
    }
    const priorSource = batch.settings.material;
    const priorNative = batch.material;
    batch.settings.material = system.material.clone();
    batch.rebuildMaterial();
    priorSource.dispose();
    if (!Array.isArray(priorNative) && priorNative !== batch.material) priorNative.dispose();
    if (spec.proximityFadeDistance !== undefined) {
      applyGodotProximityFade(renderer, 'CPUParticles3D.material_override');
    }
  };
  const observeMaterialOverride = (): void => {
    materialOverrideChanged?.disconnect();
    materialOverrideChanged = godotResourceChangedSignal(system.material).connect(
      rebuildMaterialOverrideBatch,
    );
  };
  observeMaterialOverride();
  const reseatDrawPassBatch = (): void => {
    unregisterParticleSystem(renderer, system);
    // Do not assign `system.instancingGeometry`: three.quarks' public convenience setter calls
    // restart() and clears every live particle. Godot changes only the render mesh. RendererSettings
    // is the library's live batch-description carrier, so changing it between unregister/register
    // rebuilds the native batch without touching simulation state.
    system.getRendererSettings().instancingGeometry = drawPass1 ?? emptyDrawPass;
    registerParticleSystem(renderer, system);
    if (spec.proximityFadeDistance !== undefined) {
      applyGodotProximityFade(renderer, 'Particles.draw_pass_1');
    }
  };
  const observeDrawPass = (): void => {
    drawPassChanged?.disconnect();
    drawPassChanged = drawPass1 === null
      ? null
      : godotResourceChangedSignal(drawPass1).connect(reseatDrawPassBatch);
  };
  observeDrawPass();

  // Godot's SIMULATION-TIME state for this emitter, and nothing else's (see Resource ownership).
  let fixedFps = spec.fixedFps ?? 0;
  let preprocess = spec.preprocess ?? 0;
  let speedScale = spec.speedScale ?? 1;
  let localCoords = spec.localCoords;
  let lifetime = Math.max(spec.lifetime, 0.001);
  let amount = spec.amount;
  /** Godot's `frame_remainder`: sim time banked but not yet spent on a whole fixed step. */
  let frameRemainder = 0;
  /** Godot 3.6's `time == 0` / Godot 4's `clear` — "this emitter has just (re)started", the gate on
   *  the `preprocess` burn. Raised by the two writers below and consumed by the next `update`,
   *  which is the frame Godot consumes it on: BOTH engines run the burn inside the per-frame
   *  particle update, never inside `restart()`. That is also why the burn cannot be done here at
   *  construction — three.quarks' `ParticleSystem.update` DISPOSES a system whose emitter has not
   *  been added under a `Scene` yet (`ParticleSystem.ts:975-980`), and at construction it has not. */
  let burnPending = false;

  /**
   * Godot's `preprocess` burn — `while (todo >= 0) _particles_process(frame_time)`, with Godot's own
   * step size: the fixed step when there is one, `1 / 30` otherwise (3.6 `cpu_particles.cpp:567-582`,
   * 4.x `particles_storage.cpp:1532-1555`, both quoted in the module header). The `>=` is Godot's,
   * and so is the repeated subtraction: together they overshoot the requested seconds by up to two
   * steps. Transcribing the loop keeps that; computing a step count would not.
   *
   * Godot 4 deliberately does NOT multiply this step by `speedScale`: it saves the scale, forces it
   * to 1 for the burn and restores it, with the source comment "We need this otherwise the speed
   * scale of the particle system influences the TODO" (`particles_storage.cpp:1546-1554`,
   * `4.4-stable`; `scene/3d/cpu_particles_3d.cpp:681-687` does the same). Godot 3.6 has no such
   * save/restore and therefore burns `preprocess × speed_scale`; `preprocessUsesSpeedScale` carries
   * that exact dialect difference into the one native update call below.
   */
  const burnPreprocess = (): void => {
    const step = fixedFps > 0 ? 1 / fixedFps : 1 / 30;
    let todo = preprocess;
    while (todo >= 0) {
      renderer.update(step * (spec.preprocessUsesSpeedScale === true ? speedScale : 1));
      todo -= step;
    }
  };

  const assertNativeStepSupported = (fps: number, scale: number): void => {
    const fixedStep = fps > 0 ? scale / fps : 0;
    if (fixedStep > 0.1) {
      throw new RangeError(
        `Particles fixed step ${fixedStep}s exceeds three.quarks' exact 0.1s native step ceiling.`,
      );
    }
    const preprocessStep =
      spec.preprocessUsesSpeedScale === true && preprocess > 0
        ? scale * (fps > 0 ? 1 / fps : 1 / 30)
        : 0;
    if (preprocessStep > 0.1) {
      throw new RangeError(
        `Particles preprocess step ${preprocessStep}s exceeds three.quarks' exact 0.1s native step ceiling.`,
      );
    }
  };

  return {
    emitter: system.emitter,
    renderer,
    setEmitting(on: boolean): void {
      emitting = on;
      if (on) {
        // Godot re-arms a one-shot on every `emitting = true`; restart() rewinds time and re-emits.
        system.restart();
        system.play();
        // `CPUParticles::restart()` zeroes `time` AND `frame_remainder` (3.6 `cpu_particles.cpp:238-242`),
        // and a zeroed `time` is what re-arms the burn.
        frameRemainder = 0;
        burnPending = preprocess > 0;
      } else {
        system.pause();
      }
    },
    get emitting(): boolean {
      return emitting;
    },
    get amount(): number {
      return amount;
    },
    set amount(value: number) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError('Particles.amount must be a positive integer.');
      }
      amount = value;
      const mutableSystem = system as unknown as {
        emissionOverTime: ValueGenerator;
        emissionBursts: Array<{ count: ValueGenerator }>;
      };
      if (spec.oneShot) {
        const burst = mutableSystem.emissionBursts[0];
        if (burst === undefined) throw new Error('Particles one-shot native burst owner is missing.');
        burst.count = new ConstantValue(value);
      } else {
        mutableSystem.emissionOverTime = new ConstantValue(value / lifetime);
      }
    },
    get lifetime(): number {
      return lifetime;
    },
    set lifetime(value: number) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError('Particles.lifetime must be greater than zero.');
      }
      lifetime = value;
      const mutableSystem = system as unknown as {
        duration: number;
        startLife: ValueGenerator;
        emissionOverTime: ValueGenerator;
      };
      mutableSystem.duration = value;
      mutableSystem.startLife = spec.lifetimeRandomness === undefined || spec.lifetimeRandomness === 0
        ? new ConstantValue(value)
        : new IntervalValue(value * (1 - spec.lifetimeRandomness), value);
      mutableSystem.emissionOverTime = new ConstantValue(spec.oneShot ? 0 : amount / value);
    },
    get speedScale(): number {
      return speedScale;
    },
    set speedScale(value: number) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError('Particles.speed_scale must be a finite non-negative number.');
      }
      assertNativeStepSupported(fixedFps, value);
      speedScale = value;
    },
    get preprocess(): number {
      return preprocess;
    },
    set preprocess(value: number) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError('Particles.preprocess must be a finite non-negative number.');
      }
      if (spec.preprocessUsesSpeedScale === true && value > 0) {
        const step = speedScale * (fixedFps > 0 ? 1 / fixedFps : 1 / 30);
        if (step > 0.1) {
          throw new RangeError(
            `Particles preprocess step ${step}s exceeds three.quarks' exact 0.1s native step ceiling.`,
          );
        }
      }
      preprocess = value;
    },
    get fixedFps(): number {
      return fixedFps;
    },
    set fixedFps(value: number) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('Particles.fixed_fps must be a non-negative integer.');
      }
      assertNativeStepSupported(value, speedScale);
      fixedFps = value;
    },
    get localCoords(): boolean {
      return localCoords;
    },
    set localCoords(value: boolean) {
      if (typeof value !== 'boolean') {
        throw new TypeError('Particles.local_coords must be a bool.');
      }
      if (value === localCoords) return;
      if (value === false && spec.disableZ === true) {
        throw new RangeError(
          'Particles.local_coords cannot be disabled while particle_flag_disable_z is enabled: ' +
            'three.quarks has no exact world-space planar clamp.',
        );
      }
      localCoords = value;
      // ParticleSystem owns this coordinate decision directly. Existing particles retain their
      // numeric positions and are interpreted under the new space on the next native render, just
      // as Godot switches the process-material coordinate transform without rebuilding particles.
      system.worldSpace = !value;
    },
    get drawPass1(): BufferGeometry | null {
      return drawPass1;
    },
    set drawPass1(value: BufferGeometry | null) {
      if (value !== null && !(value instanceof BufferGeometry)) {
        throw new TypeError('Particles.draw_pass_1 requires a retained Mesh resource or null.');
      }
      if (value === drawPass1) return;
      drawPassChanged?.disconnect();
      drawPassChanged = null;
      drawPass1 = value;
      // A null draw pass uses an empty native geometry rather than removing the system: Godot
      // continues simulating particles without a mesh and shows them if one is assigned later.
      reseatDrawPassBatch();
      observeDrawPass();
    },
    get materialOverride(): Material {
      return system.material;
    },
    set materialOverride(value: Material) {
      if (!(value instanceof Material)) {
        throw new TypeError('CPUParticles3D.material_override requires a retained Material Resource.');
      }
      const previous = system.material;
      if (value === previous) return;
      materialOverrideChanged?.disconnect();
      materialOverrideChanged = null;
      retainParticleMaterial(value);
      system.material = value;
      rebuildMaterialOverrideBatch();
      // We rebuilt the one retained batch synchronously above. Do not let ParticleSystem's next
      // simulation step repeat its generic delete/add rebuild and strand an empty batch.
      system.neededToUpdateRender = false;
      releaseParticleMaterial(previous);
      observeMaterialOverride();
    },
    restart(): void {
      // Godot's restart() IS `emitting = true` plus a clear, which is what setEmitting(true) does.
      this.setEmitting(true);
    },
    get particleCount(): number {
      return system.particleNum;
    },
    update(delta: number): void {
      // Godot runs BOTH loops here, in the per-frame particle update, in this order.
      if (burnPending) {
        burnPending = false;
        burnPreprocess();
      }
      if (fixedFps <= 0) {
        // Godot's `else` branch: `_particles_process(delta)` — the frame's own delta, scaled inside
        // that call by `speed_scale` and otherwise unclamped by the engine (three.quarks applies
        // its own `> 0.1` ceiling inside the system).
        renderer.update(delta * speedScale);
        return;
      }
      const frameTime = 1 / fixedFps;
      // `if (ldelta > 0.1) ldelta = 0.1; else if (ldelta <= 0.0) ldelta = 0.001;` — Godot's own
      // stall clamp ("avoid recursive stalls if fps goes below 10") and its zero floor, both
      // verbatim from the two loops quoted in the module header. The banked delta is the RAW one:
      // neither engine scales what the accumulator spends, only what a spent step simulates.
      let banked = delta;
      if (banked > 0.1) banked = 0.1;
      else if (banked <= 0) banked = 0.001;
      let todo = frameRemainder + banked;
      while (todo >= frameTime) {
        // `p_delta *= speed_scale` (3.6) / `frame_params.delta = p_delta * speed_scale` (4.x) — the
        // ONE seat the multiplication lives in, exactly where Godot puts it.
        renderer.update(frameTime * speedScale);
        todo -= frameTime;
      }
      frameRemainder = todo;
    },
    dispose(): void {
      // The other half of `registerParticleSystem` above — it also disarms the depth prepass and
      // hands the renderer the inert far-depth default back.
      drawPassChanged?.disconnect();
      materialOverrideChanged?.disconnect();
      unregisterParticleSystem(renderer, system);
      system.dispose();
      emptyDrawPass.dispose();
      renderer.removeFromParent();
      // The factory-built material is this system's; the sprite texture is the factory's shared,
      // URL-cached resource and is NOT disposed here.
      releaseParticleMaterial(system.material);
    },
  };
}

/**
 * A {@link ValueGeneratorJSON} `PiecewiseBezier` that reproduces a Godot `Curve` EXACTLY — not a
 * resample. The shared factory rebuilds it through quarks' own `PiecewiseBezier.fromJSON`
 * (`Bezier(p0,p1,p2,p3)` per segment), so the emitted numbers ARE the control points.
 *
 * Godot 3.6 evaluates a `Curve` per segment `[a,b]` as a cubic bezier over `local = (t−a.offset)/d`,
 * `d = b.offset−a.offset`, with control points `(a.value, a.value + d/3·a.rightTangent, b.value −
 * d/3·b.leftTangent, b.value)` (`Curve::interpolate_local_nocheck`, `scene/resources/curve.cpp`), and
 * holds the endpoint value outside `[first.offset, last.offset]` (`Curve::interpolate`). three.quarks'
 * `Bezier.genValue` is the IDENTICAL polynomial and `PiecewiseBezier` normalises each segment by
 * `(t−startX)/(endX−startX)` — the same `local/d` — so this carry is exact, tangents and all (there is
 * no fidelity ceiling to state, unlike a resample). `max_value` is deliberately ignored: Godot's
 * `interpolate` applies NO min/max clamp (verified against 3.6 source), so the stored point values ARE
 * the emitted values — `max_value` is only the editor's vertical drag bound.
 *
 * These control points are the ONE description of a Godot `Curve` in this file: the size curve is
 * emitted from them, and {@link GodotAlphaOverLife} evaluates them through the same quarks
 * `PiecewiseBezier` the factory would build. A second hand-written evaluation of the same
 * polynomial is exactly the pair that drifts.
 */
function godotCurveJSON(points: readonly GodotCurvePoint[]): ValueGeneratorJSON {
  const functions: {
    function: { p0: number; p1: number; p2: number; p3: number };
    start: number;
  }[] = [];
  const first = points[0] as GodotCurvePoint;
  const last = points[points.length - 1] as GodotCurvePoint;
  // Godot holds `first.value` for t < first.offset — a flat leading segment when the curve starts late.
  if (first.offset > 0) {
    functions.push({
      function: { p0: first.value, p1: first.value, p2: first.value, p3: first.value },
      start: 0,
    });
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as GodotCurvePoint;
    const b = points[i + 1] as GodotCurvePoint;
    const d = b.offset - a.offset;
    // A segment that spans nothing (two points at one offset, which Godot's editor permits) would
    // be normalised by `(t−startX)/(endX−startX)` = 0/0 inside `PiecewiseBezier`, i.e. NaN out of
    // an evaluator that used to hand back `b.value`. It carries no values a neighbour does not.
    if (d <= 0) continue;
    const yac = a.value + (d / 3) * a.rightTangent;
    const ybc = b.value - (d / 3) * b.leftTangent;
    functions.push({ function: { p0: a.value, p1: yac, p2: ybc, p3: b.value }, start: a.offset });
  }
  // Godot holds `last.value` for t > last.offset — a flat trailing segment out to 1 (PiecewiseBezier's
  // final segment always ends at 1). Also covers the single-point curve (no real segment above).
  if (last.offset < 1 || functions.length === 0) {
    functions.push({
      function: { p0: last.value, p1: last.value, p2: last.value, p3: last.value },
      start: last.offset,
    });
  }
  return { type: 'PiecewiseBezier', functions };
}

/** A {@link ColorGeneratorJSON} `Gradient` from a baked Godot color ramp (RGB curve + alpha curve) —
 *  the same `[Vector3(r,g,b), offset]` / `[alpha, offset]` key pairs quarks' `Gradient.fromJSON`
 *  rebuilds. `isSrgb` is the material's `vertex_color_is_srgb`: true ⇒ each stop's RGB is decoded to
 *  the linear space the fragment shades in, false ⇒ Godot uses the authored numbers raw. Alpha is
 *  never decoded (Godot's `mix(…)` covers `.rgb` only). */
function rampGradient(stops: readonly CpuGradientStop[], isSrgb: boolean): ColorGeneratorJSON {
  const enc = isSrgb ? srgbToLinear : (c: number) => c;
  return {
    type: 'Gradient',
    color: {
      type: 'CLinearFunction',
      subType: 'Color',
      keys: stops.map((s) => ({
        value: { r: enc(s.r), g: enc(s.g), b: enc(s.b) },
        pos: s.offset,
      })),
    },
    alpha: {
      type: 'CLinearFunction',
      subType: 'Number',
      keys: stops.map((s) => ({ value: s.a, pos: s.offset })),
    },
  };
}

/**
 * The CONSTANT half of Godot's particle colour, as three.quarks' `startColor` — everything the ramp
 * does not vary, in the linear space the fragment shades in:
 *
 *   `srgb→linear(albedo_color.rgb) · [use_as_albedo ? f(CPUParticles.color.rgb) : 1]`, alpha
 *   `albedo_color.a · [use_as_albedo ? CPUParticles.color.a : 1]`.
 *
 * `ColorOverLife` multiplies the ramp into this, so the pair reproduces Godot's whole product. The
 * albedo is HERE and not on the three material because `particle_frag.glsl` never reads a material
 * colour — see the module header, which carries the real-engine readback for every term.
 */
function startColorGradient(spec: GodotCpuParticles3DSpec): ColorGeneratorJSON {
  const [mr, mg, mb, ma] = spec.materialColor;
  const enc = spec.vertexColorIsSrgb ? srgbToLinear : (c: number) => c;
  const vc = spec.vertexColorAsAlbedo;
  const [pr, pg, pb, pa] = spec.color;
  const r = srgbToLinear(mr) * (vc ? enc(pr) : 1);
  const g = srgbToLinear(mg) * (vc ? enc(pg) : 1);
  const b = srgbToLinear(mb) * (vc ? enc(pb) : 1);
  const a = ma * (vc ? pa : 1);
  return {
    type: 'Gradient',
    color: {
      type: 'CLinearFunction',
      subType: 'Color',
      keys: [
        { value: { r, g, b }, pos: 0 },
        { value: { r, g, b }, pos: 1 },
      ],
    },
    alpha: {
      type: 'CLinearFunction',
      subType: 'Number',
      keys: [
        { value: a, pos: 0 },
        { value: a, pos: 1 },
      ],
    },
  };
}
