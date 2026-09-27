/**
 * @godot-class ParticlesShaderGLES3
 * @role PROTOCOL
 *
 * The Compatibility renderer's particle shaders, as Godot's build embeds them
 * (`drivers/gles3/shaders/particles.glsl`, `particles_copy.glsl`, `stdlib_inc.glsl`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`), byte for byte (the `vendor/gles3-shaders` lock; the
 * scene-particles proof checks each against it): Copyright (c) 2014-present Godot Engine
 * contributors (see AUTHORS.md); Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur; MIT License.
 * `gpu-particles-3d.ts` assembles a program from them the way `gles3_builders.py` and
 * `ShaderGLES3::_build_variant_code` do.
 */

/**
 * `drivers/gles3/shaders/particles.glsl`.
 *
 * @godot ParticlesShaderGLES3 (protocol)
 * @source drivers/gles3/shaders/particles.glsl:1
 */
export const GODOT_PARTICLES_GLSL = `/* clang-format off */
#[modes]

mode_default =

#[specializations]

MODE_3D = false
USERDATA1_USED = false
USERDATA2_USED = false
USERDATA3_USED = false
USERDATA4_USED = false
USERDATA5_USED = false
USERDATA6_USED = false

#[vertex]

#define SDF_MAX_LENGTH 16384.0

layout(std140) uniform GlobalShaderUniformData { //ubo:1
	vec4 global_shader_uniforms[MAX_GLOBAL_SHADER_UNIFORMS];
};

// This needs to be outside clang-format so the ubo comment is in the right place
#ifdef MATERIAL_UNIFORMS_USED
layout(std140) uniform MaterialUniforms{ //ubo:2

#MATERIAL_UNIFORMS

};
#endif

/* clang-format on */

#define MAX_ATTRACTORS 32

#define ATTRACTOR_TYPE_SPHERE uint(0)
#define ATTRACTOR_TYPE_BOX uint(1)
#define ATTRACTOR_TYPE_VECTOR_FIELD uint(2)

struct Attractor {
	mat4 transform;
	vec4 extents; // Extents or radius. w-channel is padding.

	uint type;
	float strength;
	float attenuation;
	float directionality;
};

#define MAX_COLLIDERS 32

#define COLLIDER_TYPE_SPHERE uint(0)
#define COLLIDER_TYPE_BOX uint(1)
#define COLLIDER_TYPE_SDF uint(2)
#define COLLIDER_TYPE_HEIGHT_FIELD uint(3)
#define COLLIDER_TYPE_2D_SDF uint(4)

struct Collider {
	mat4 transform;
	vec4 extents; // Extents or radius. w-channel is padding.

	uint type;
	float scale;
	float pad0;
	float pad1;
};

layout(std140) uniform FrameData { //ubo:0
	bool emitting;
	uint cycle;
	float system_phase;
	float prev_system_phase;

	float explosiveness;
	float randomness;
	float time;
	float delta;

	float particle_size;
	float amount_ratio;
	float pad1;
	float pad2;

	uint random_seed;
	uint attractor_count;
	uint collider_count;
	uint frame;

	mat4 emission_transform;

	vec3 emitter_velocity;
	float interp_to_end;

	Attractor attractors[MAX_ATTRACTORS];
	Collider colliders[MAX_COLLIDERS];
};

#define PARTICLE_FLAG_ACTIVE uint(1)
#define PARTICLE_FLAG_STARTED uint(2)
#define PARTICLE_FLAG_TRAILED uint(4)
#define PARTICLE_FRAME_MASK uint(0xFFFF)
#define PARTICLE_FRAME_SHIFT uint(16)

// ParticleData
layout(location = 0) in highp vec4 color;
layout(location = 1) in highp vec4 velocity_flags;
layout(location = 2) in highp vec4 custom;
layout(location = 3) in highp vec4 xform_1;
layout(location = 4) in highp vec4 xform_2;
#ifdef MODE_3D
layout(location = 5) in highp vec4 xform_3;
#endif
#ifdef USERDATA1_USED
in highp vec4 userdata1;
#endif
#ifdef USERDATA2_USED
in highp vec4 userdata2;
#endif
#ifdef USERDATA3_USED
in highp vec4 userdata3;
#endif
#ifdef USERDATA4_USED
in highp vec4 userdata4;
#endif
#ifdef USERDATA5_USED
in highp vec4 userdata5;
#endif
#ifdef USERDATA6_USED
in highp vec4 userdata6;
#endif

out highp vec4 out_color; //tfb:
out highp vec4 out_velocity_flags; //tfb:
out highp vec4 out_custom; //tfb:
out highp vec4 out_xform_1; //tfb:
out highp vec4 out_xform_2; //tfb:
#ifdef MODE_3D
out highp vec4 out_xform_3; //tfb:MODE_3D
#endif
#ifdef USERDATA1_USED
out highp vec4 out_userdata1; //tfb:USERDATA1_USED
#endif
#ifdef USERDATA2_USED
out highp vec4 out_userdata2; //tfb:USERDATA2_USED
#endif
#ifdef USERDATA3_USED
out highp vec4 out_userdata3; //tfb:USERDATA3_USED
#endif
#ifdef USERDATA4_USED
out highp vec4 out_userdata4; //tfb:USERDATA4_USED
#endif
#ifdef USERDATA5_USED
out highp vec4 out_userdata5; //tfb:USERDATA5_USED
#endif
#ifdef USERDATA6_USED
out highp vec4 out_userdata6; //tfb:USERDATA6_USED
#endif

uniform sampler2D height_field_texture; //texunit:0

uniform float lifetime;
uniform bool clear;
uniform uint total_particles;
uniform bool use_fractional_delta;

uint hash(uint x) {
	x = ((x >> uint(16)) ^ x) * uint(0x45d9f3b);
	x = ((x >> uint(16)) ^ x) * uint(0x45d9f3b);
	x = (x >> uint(16)) ^ x;
	return x;
}

vec3 safe_normalize(vec3 direction) {
	const float EPSILON = 0.001;
	if (length(direction) < EPSILON) {
		return vec3(0.0);
	}
	return normalize(direction);
}

// Needed whenever 2D sdf texture is read from as it is packed in RGBA8.
float vec4_to_float(vec4 p_vec) {
	return dot(p_vec, vec4(1.0 / (255.0 * 255.0 * 255.0), 1.0 / (255.0 * 255.0), 1.0 / 255.0, 1.0)) * 2.0 - 1.0;
}

#GLOBALS

void main() {
	bool apply_forces = true;
	bool apply_velocity = true;
	float local_delta = delta;

	float mass = 1.0;

	bool restart = false;

	bool restart_position = false;
	bool restart_rotation_scale = false;
	bool restart_velocity = false;
	bool restart_color = false;
	bool restart_custom = false;

	mat4 xform = mat4(1.0);
	uint flags = 0u;

	if (clear) {
		out_color = vec4(1.0);
		out_custom = vec4(0.0);
		out_velocity_flags = vec4(0.0);
	} else {
		out_color = color;
		out_velocity_flags = velocity_flags;
		out_custom = custom;
		xform[0] = xform_1;
		xform[1] = xform_2;
#ifdef MODE_3D
		xform[2] = xform_3;
#endif
		xform = transpose(xform);
		flags = floatBitsToUint(velocity_flags.w);
#ifdef USERDATA1_USED
		out_userdata1 = userdata1;
#endif
#ifdef USERDATA2_USED
		out_userdata2 = userdata2;
#endif
#ifdef USERDATA3_USED
		out_userdata3 = userdata3;
#endif
#ifdef USERDATA4_USED
		out_userdata4 = userdata4;
#endif
#ifdef USERDATA5_USED
		out_userdata5 = userdata5;
#endif
#ifdef USERDATA6_USED
		out_userdata6 = userdata6;
#endif
	}

	//clear started flag if set
	flags &= ~PARTICLE_FLAG_STARTED;

	bool collided = false;
	vec3 collision_normal = vec3(0.0);
	float collision_depth = 0.0;

	vec3 attractor_force = vec3(0.0);

#if !defined(DISABLE_VELOCITY)

	if (bool(flags & PARTICLE_FLAG_ACTIVE)) {
		xform[3].xyz += out_velocity_flags.xyz * local_delta;
	}
#endif
	uint index = uint(gl_VertexID);
	if (emitting) {
		float restart_phase = float(index) / float(total_particles);

		if (randomness > 0.0) {
			uint seed = cycle;
			if (restart_phase >= system_phase) {
				seed -= uint(1);
			}
			seed *= uint(total_particles);
			seed += index;
			float random = float(hash(seed) % uint(65536)) / 65536.0;
			restart_phase += randomness * random * 1.0 / float(total_particles);
		}

		restart_phase *= (1.0 - explosiveness);

		if (system_phase > prev_system_phase) {
			// restart_phase >= prev_system_phase is used so particles emit in the first frame they are processed

			if (restart_phase >= prev_system_phase && restart_phase < system_phase) {
				restart = true;
				if (use_fractional_delta) {
					local_delta = (system_phase - restart_phase) * lifetime;
				}
			}

		} else if (delta > 0.0) {
			if (restart_phase >= prev_system_phase) {
				restart = true;
				if (use_fractional_delta) {
					local_delta = (1.0 - restart_phase + system_phase) * lifetime;
				}

			} else if (restart_phase < system_phase) {
				restart = true;
				if (use_fractional_delta) {
					local_delta = (system_phase - restart_phase) * lifetime;
				}
			}
		}

		if (restart) {
			flags = emitting ? (PARTICLE_FLAG_ACTIVE | PARTICLE_FLAG_STARTED | (cycle << PARTICLE_FRAME_SHIFT)) : 0u;
			restart_position = true;
			restart_rotation_scale = true;
			restart_velocity = true;
			restart_color = true;
			restart_custom = true;
		}
	}

	bool particle_active = bool(flags & PARTICLE_FLAG_ACTIVE);

	uint particle_number = (flags >> PARTICLE_FRAME_SHIFT) * uint(total_particles) + index;

	if (restart && particle_active) {
#CODE : START
	}

	if (particle_active) {
		for (uint i = 0u; i < attractor_count; i++) {
			vec3 dir;
			float amount;
			vec3 rel_vec = xform[3].xyz - attractors[i].transform[3].xyz;
			vec3 local_pos = rel_vec * mat3(attractors[i].transform);

			if (attractors[i].type == ATTRACTOR_TYPE_SPHERE) {
				dir = safe_normalize(rel_vec);
				float d = length(local_pos) / attractors[i].extents.x;
				if (d > 1.0) {
					continue;
				}
				amount = max(0.0, 1.0 - d);
			} else if (attractors[i].type == ATTRACTOR_TYPE_BOX) {
				dir = safe_normalize(rel_vec);

				vec3 abs_pos = abs(local_pos / attractors[i].extents.xyz);
				float d = max(abs_pos.x, max(abs_pos.y, abs_pos.z));
				if (d > 1.0) {
					continue;
				}
				amount = max(0.0, 1.0 - d);
			} else if (attractors[i].type == ATTRACTOR_TYPE_VECTOR_FIELD) {
			}
			mediump float attractor_attenuation = attractors[i].attenuation;
			amount = pow(amount, attractor_attenuation);
			dir = safe_normalize(mix(dir, attractors[i].transform[2].xyz, attractors[i].directionality));
			attractor_force -= mass * amount * dir * attractors[i].strength;
		}

		float particle_size = particle_size;

#ifdef USE_COLLISION_SCALE

		particle_size *= dot(vec3(length(xform[0].xyz), length(xform[1].xyz), length(xform[2].xyz)), vec3(0.33333333333));

#endif

		if (collider_count == 1u && colliders[0].type == COLLIDER_TYPE_2D_SDF) {
			//2D collision

			vec2 pos = xform[3].xy;
			vec4 to_sdf_x = colliders[0].transform[0];
			vec4 to_sdf_y = colliders[0].transform[1];
			vec2 sdf_pos = vec2(dot(vec4(pos, 0, 1), to_sdf_x), dot(vec4(pos, 0, 1), to_sdf_y));

			vec4 sdf_to_screen = vec4(colliders[0].extents.xyz, colliders[0].scale);

			vec2 uv_pos = sdf_pos * sdf_to_screen.xy + sdf_to_screen.zw;

			if (all(greaterThan(uv_pos, vec2(0.0))) && all(lessThan(uv_pos, vec2(1.0)))) {
				vec2 pos2 = pos + vec2(0, particle_size);
				vec2 sdf_pos2 = vec2(dot(vec4(pos2, 0, 1), to_sdf_x), dot(vec4(pos2, 0, 1), to_sdf_y));
				float sdf_particle_size = distance(sdf_pos, sdf_pos2);

				float d = vec4_to_float(texture(height_field_texture, uv_pos)) * SDF_MAX_LENGTH;

				// Allowing for a small epsilon to allow particle just touching colliders to count as collided
				const float EPSILON = 0.001;
				d -= sdf_particle_size;
				if (d < EPSILON) {
					vec2 n = normalize(vec2(
							vec4_to_float(texture(height_field_texture, uv_pos + vec2(EPSILON, 0.0))) - vec4_to_float(texture(height_field_texture, uv_pos - vec2(EPSILON, 0.0))),
							vec4_to_float(texture(height_field_texture, uv_pos + vec2(0.0, EPSILON))) - vec4_to_float(texture(height_field_texture, uv_pos - vec2(0.0, EPSILON)))));

					collided = true;
					sdf_pos2 = sdf_pos + n * d;
					pos2 = vec2(dot(vec4(sdf_pos2, 0, 1), colliders[0].transform[2]), dot(vec4(sdf_pos2, 0, 1), colliders[0].transform[3]));

					n = pos - pos2;

					collision_normal = normalize(vec3(n, 0.0));
					collision_depth = length(n);
				}
			}

		} else {
			for (uint i = 0u; i < collider_count; i++) {
				vec3 normal;
				float depth;
				bool col = false;

				vec3 rel_vec = xform[3].xyz - colliders[i].transform[3].xyz;
				vec3 local_pos = rel_vec * mat3(colliders[i].transform);

				// Allowing for a small epsilon to allow particle just touching colliders to count as collided
				const float EPSILON = 0.001;
				if (colliders[i].type == COLLIDER_TYPE_SPHERE) {
					float d = length(rel_vec) - (particle_size + colliders[i].extents.x);

					if (d < EPSILON) {
						col = true;
						depth = -d;
						normal = normalize(rel_vec);
					}
				} else if (colliders[i].type == COLLIDER_TYPE_BOX) {
					vec3 abs_pos = abs(local_pos);
					vec3 sgn_pos = sign(local_pos);

					if (any(greaterThan(abs_pos, colliders[i].extents.xyz))) {
						//point outside box

						vec3 closest = min(abs_pos, colliders[i].extents.xyz);
						vec3 rel = abs_pos - closest;
						depth = length(rel) - particle_size;
						if (depth < EPSILON) {
							col = true;
							normal = mat3(colliders[i].transform) * (normalize(rel) * sgn_pos);
							depth = -depth;
						}
					} else {
						//point inside box
						vec3 axis_len = colliders[i].extents.xyz - abs_pos;
						// there has to be a faster way to do this?
						if (all(lessThan(axis_len.xx, axis_len.yz))) {
							normal = vec3(1, 0, 0);
						} else if (all(lessThan(axis_len.yy, axis_len.xz))) {
							normal = vec3(0, 1, 0);
						} else {
							normal = vec3(0, 0, 1);
						}

						col = true;
						depth = dot(normal * axis_len, vec3(1)) + particle_size;
						normal = mat3(colliders[i].transform) * (normal * sgn_pos);
					}
				} else if (colliders[i].type == COLLIDER_TYPE_SDF) {
				} else if (colliders[i].type == COLLIDER_TYPE_HEIGHT_FIELD) {
					vec3 local_pos_bottom = local_pos;
					local_pos_bottom.y -= particle_size;

					if (any(greaterThan(abs(local_pos_bottom), colliders[i].extents.xyz))) {
						continue;
					}
					const float DELTA = 1.0 / 8192.0;

					vec3 uvw_pos = vec3(local_pos_bottom / colliders[i].extents.xyz) * 0.5 + 0.5;

					float y = texture(height_field_texture, uvw_pos.xz).r;

					if (y + EPSILON > uvw_pos.y) {
						//inside heightfield

						vec3 pos1 = (vec3(uvw_pos.x, y, uvw_pos.z) * 2.0 - 1.0) * colliders[i].extents.xyz;
						vec3 pos2 = (vec3(uvw_pos.x + DELTA, texture(height_field_texture, uvw_pos.xz + vec2(DELTA, 0)).r, uvw_pos.z) * 2.0 - 1.0) * colliders[i].extents.xyz;
						vec3 pos3 = (vec3(uvw_pos.x, texture(height_field_texture, uvw_pos.xz + vec2(0, DELTA)).r, uvw_pos.z + DELTA) * 2.0 - 1.0) * colliders[i].extents.xyz;

						normal = normalize(cross(pos1 - pos2, pos1 - pos3));
						float local_y = (vec3(local_pos / colliders[i].extents.xyz) * 0.5 + 0.5).y;

						col = true;
						depth = dot(normal, pos1) - dot(normal, local_pos_bottom);
					}
				}

				if (col) {
					if (!collided) {
						collided = true;
						collision_normal = normal;
						collision_depth = depth;
					} else {
						vec3 c = collision_normal * collision_depth;
						c += normal * max(0.0, depth - dot(normal, c));
						collision_normal = normalize(c);
						collision_depth = length(c);
					}
				}
			}
		}
	}

	if (particle_active) {
#CODE : PROCESS
	}

	flags &= ~PARTICLE_FLAG_ACTIVE;
	if (particle_active) {
		flags |= PARTICLE_FLAG_ACTIVE;
	}

	xform = transpose(xform);
	out_xform_1 = xform[0];
	out_xform_2 = xform[1];
#ifdef MODE_3D
	out_xform_3 = xform[2];
#endif
	out_velocity_flags.w = uintBitsToFloat(flags);
}

/* clang-format off */
#[fragment]

void main() {
}
/* clang-format on */
`;

/**
 * `drivers/gles3/shaders/particles_copy.glsl`.
 *
 * @godot ParticlesShaderGLES3 (protocol)
 * @source drivers/gles3/shaders/particles_copy.glsl:1
 */
export const GODOT_PARTICLES_COPY_GLSL = `/* clang-format off */
#[modes]

mode_default =

#[specializations]

MODE_3D = false

#[vertex]

#include "stdlib_inc.glsl"

// ParticleData
layout(location = 0) in highp vec4 color;
layout(location = 1) in highp vec4 velocity_flags;
layout(location = 2) in highp vec4 custom;
layout(location = 3) in highp vec4 xform_1;
layout(location = 4) in highp vec4 xform_2;
#ifdef MODE_3D
layout(location = 5) in highp vec4 xform_3;
#endif

/* clang-format on */
out highp vec4 out_xform_1; //tfb:
out highp vec4 out_xform_2; //tfb:
#ifdef MODE_3D
out highp vec4 out_xform_3; //tfb:MODE_3D
#endif
flat out highp uvec4 instance_color_custom_data; //tfb:

uniform lowp vec3 sort_direction;
uniform highp float frame_remainder;

uniform highp vec3 align_up;
uniform highp uint align_mode;

uniform highp mat4 inv_emission_transform;

uniform uint align_channel_filter;
uniform uint align_axis;

#define ALIGN_DISABLED uint(0)
#define ALIGN_BILLBOARD uint(1)
#define ALIGN_Y_TO_VELOCITY uint(2)
#define ALIGN_Z_BILLBOARD_Y_TO_VELOCITY uint(3)
#define ALIGN_LOCAL_BILLBOARD uint(4)

#define CHANNEL_FILTER_NONE uint(0)
#define CHANNEL_FILTER_X uint(1)
#define CHANNEL_FILTER_Y uint(2)
#define CHANNEL_FILTER_Z uint(3)
#define CHANNEL_FILTER_W uint(4)

#define ALIGN_AXIS_X uint(0)
#define ALIGN_AXIS_Y uint(1)
#define ALIGN_AXIS_Z uint(2)

#define PARTICLE_FLAG_ACTIVE uint(1)

#define FLT_MAX float(3.402823466e+38)

void main() {
	// Set scale to zero and translate to -INF so particle will be invisible
	// even for materials that ignore rotation/scale (i.e. billboards).
	mat4 txform = mat4(vec4(0.0), vec4(0.0), vec4(0.0), vec4(-FLT_MAX, -FLT_MAX, -FLT_MAX, 0.0));
	if (bool(floatBitsToUint(velocity_flags.w) & PARTICLE_FLAG_ACTIVE)) {
#ifdef MODE_3D
		txform = transpose(mat4(xform_1, xform_2, xform_3, vec4(0.0, 0.0, 0.0, 1.0)));
#else
		txform = transpose(mat4(xform_1, xform_2, vec4(0.0, 0.0, 1.0, 0.0), vec4(0.0, 0.0, 0.0, 1.0)));
#endif

		if (align_mode == ALIGN_DISABLED) {
			// nothing
		} else if (align_mode == ALIGN_BILLBOARD) {
			float angle = 0.;
			if (align_channel_filter == CHANNEL_FILTER_NONE) {
				mat3 local = mat3(normalize(cross(align_up, sort_direction)), align_up, sort_direction);
				local = local * mat3(txform);
				txform[0].xyz = local[0];
				txform[1].xyz = local[1];
				txform[2].xyz = local[2];
			} else {
				if (align_channel_filter == CHANNEL_FILTER_X) {
					angle = custom.x;

				} else if (align_channel_filter == CHANNEL_FILTER_Y) {
					angle = custom.y;

				} else if (align_channel_filter == CHANNEL_FILTER_Z) {
					angle = custom.z;

				} else if (align_channel_filter == CHANNEL_FILTER_W) {
					angle = custom.w;
				}

				vec3 axis = normalize(sort_direction);
				float s = sin(angle);
				float c = cos(angle);
				float oc = 1.0 - c;
				mat3 rotated = mat3(
						oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s,
						oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s,
						oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c);
				vec3 new_up = rotated * align_up;
				mat3 local = mat3(normalize(cross(new_up, sort_direction)), new_up, sort_direction);
				local = local * mat3(txform);
				txform[0].xyz = local[0];
				txform[1].xyz = local[1];
				txform[2].xyz = local[2];
			}
		} else if (align_mode == ALIGN_Y_TO_VELOCITY) {
			vec3 v = velocity_flags.xyz;
			float s = (length(txform[0]) + length(txform[1]) + length(txform[2])) / 3.0;
			if (length(v) > 0.0) {
				txform[1].xyz = normalize(v);
			} else {
				txform[1].xyz = normalize(txform[1].xyz);
			}

			txform[0].xyz = normalize(cross(txform[1].xyz, txform[2].xyz));
			txform[2].xyz = vec3(0.0, 0.0, 1.0) * s;
			txform[0].xyz *= s;
			txform[1].xyz *= s;
		} else if (align_mode == ALIGN_Z_BILLBOARD_Y_TO_VELOCITY) {
			vec3 sv = velocity_flags.xyz - sort_direction * dot(sort_direction, velocity_flags.xyz); //screen velocity

			if (length(sv) == 0.0) {
				sv = align_up;
			}

			sv = normalize(sv);

			txform[0].xyz = normalize(cross(sv, sort_direction)) * length(txform[0]);
			txform[1].xyz = sv * length(txform[1]);
			txform[2].xyz = sort_direction * length(txform[2]);
		} else if (align_mode == ALIGN_LOCAL_BILLBOARD) {
			if (align_axis == ALIGN_AXIS_X) {
				vec3 len = vec3(
						length(txform[0].xyz),
						length(txform[1].xyz),
						length(txform[2].xyz));
				txform[0].xyz = normalize(txform[0].xyz);
				txform[1].xyz = normalize(cross(sort_direction, txform[0].xyz));
				txform[2].xyz = cross(txform[0].xyz, txform[1].xyz);

				txform[0].xyz *= len.x;
				txform[1].xyz *= len.y;
				txform[2].xyz *= len.z;
			} else if (align_axis == ALIGN_AXIS_Y) {
				vec3 len = vec3(
						length(txform[0].xyz),
						length(txform[1].xyz),
						length(txform[2].xyz));
				txform[1].xyz = normalize(txform[1].xyz);
				txform[0].xyz = normalize(cross(txform[1].xyz, sort_direction));
				txform[2].xyz = cross(txform[0].xyz, txform[1].xyz);

				txform[0].xyz *= len.x;
				txform[1].xyz *= len.y;
				txform[2].xyz *= len.z;
			}
		}

		txform[3].xyz += velocity_flags.xyz * frame_remainder;

#ifndef MODE_3D
		// In global mode, bring 2D particles to local coordinates
		// as they will be drawn with the node position as origin.
		txform = inv_emission_transform * txform;
#endif
	}
	txform = transpose(txform);

	instance_color_custom_data.x = packHalf2x16(color.xy);
	instance_color_custom_data.y = packHalf2x16(color.zw);
	instance_color_custom_data.z = packHalf2x16(custom.xy);
	instance_color_custom_data.w = packHalf2x16(custom.zw);
	out_xform_1 = txform[0];
	out_xform_2 = txform[1];
#ifdef MODE_3D
	out_xform_3 = txform[2];
#endif
}

/* clang-format off */
#[fragment]

void main() {
}
/* clang-format on */
`;

/**
 * `drivers/gles3/shaders/stdlib_inc.glsl`.
 *
 * @godot ParticlesShaderGLES3 (protocol)
 * @source drivers/gles3/shaders/stdlib_inc.glsl:1
 */
export const GODOT_STDLIB_INC_GLSL = `// Compatibility renames. These are exposed with the "godot_" prefix
// to work around two distinct Adreno bugs:
// 1. Some Adreno devices expose ES310 functions in ES300 shaders.
//    Internally, we must use the "godot_" prefix, but user shaders
//    will be mapped automatically.
// 2. Adreno 3XX devices have poor implementations of the other packing
//    functions, so we just use our own there to keep it simple.

#ifdef USE_HALF2FLOAT
// Floating point pack/unpack functions are part of the GLSL ES 300 specification used by web and mobile.
// It appears to be safe to expose these on mobile, but when running through ANGLE this appears to break.
uint float2half(uint f) {
	uint e = f & uint(0x7f800000);
	if (e <= uint(0x38000000)) {
		return uint(0);
	} else {
		return ((f >> uint(16)) & uint(0x8000)) |
				(((e - uint(0x38000000)) >> uint(13)) & uint(0x7c00)) |
				((f >> uint(13)) & uint(0x03ff));
	}
}

uint half2float(uint h) {
	uint h_e = h & uint(0x7c00);
	return ((h & uint(0x8000)) << uint(16)) | uint((h_e >> uint(10)) != uint(0)) * (((h_e + uint(0x1c000)) << uint(13)) | ((h & uint(0x03ff)) << uint(13)));
}

uint godot_packHalf2x16(vec2 v) {
	return float2half(floatBitsToUint(v.x)) | float2half(floatBitsToUint(v.y)) << uint(16);
}

vec2 godot_unpackHalf2x16(uint v) {
	return vec2(uintBitsToFloat(half2float(v & uint(0xffff))),
			uintBitsToFloat(half2float(v >> uint(16))));
}

uint godot_packUnorm2x16(vec2 v) {
	uvec2 uv = uvec2(round(clamp(v, vec2(0.0), vec2(1.0)) * 65535.0));
	return uv.x | uv.y << uint(16);
}

vec2 godot_unpackUnorm2x16(uint p) {
	return vec2(float(p & uint(0xffff)), float(p >> uint(16))) * 0.000015259021; // 1.0 / 65535.0 optimization
}

uint godot_packSnorm2x16(vec2 v) {
	uvec2 uv = uvec2(round(clamp(v, vec2(-1.0), vec2(1.0)) * 32767.0) + 32767.0);
	return uv.x | uv.y << uint(16);
}

vec2 godot_unpackSnorm2x16(uint p) {
	vec2 v = vec2(float(p & uint(0xffff)), float(p >> uint(16)));
	return clamp((v - 32767.0) * vec2(0.00003051851), vec2(-1.0), vec2(1.0));
}

#define packHalf2x16 godot_packHalf2x16
#define unpackHalf2x16 godot_unpackHalf2x16
#define packUnorm2x16 godot_packUnorm2x16
#define unpackUnorm2x16 godot_unpackUnorm2x16
#define packSnorm2x16 godot_packSnorm2x16
#define unpackSnorm2x16 godot_unpackSnorm2x16

#endif // USE_HALF2FLOAT

// Always expose these as they are ES310 functions and not available in ES300 or GLSL 330.

uint godot_packUnorm4x8(vec4 v) {
	uvec4 uv = uvec4(round(clamp(v, vec4(0.0), vec4(1.0)) * 255.0));
	return uv.x | (uv.y << uint(8)) | (uv.z << uint(16)) | (uv.w << uint(24));
}

vec4 godot_unpackUnorm4x8(uint p) {
	return vec4(float(p & uint(0xff)), float((p >> uint(8)) & uint(0xff)), float((p >> uint(16)) & uint(0xff)), float(p >> uint(24))) * 0.00392156862; // 1.0 / 255.0
}

uint godot_packSnorm4x8(vec4 v) {
	uvec4 uv = uvec4(round(clamp(v, vec4(-1.0), vec4(1.0)) * 127.0) + 127.0);
	return uv.x | uv.y << uint(8) | uv.z << uint(16) | uv.w << uint(24);
}

vec4 godot_unpackSnorm4x8(uint p) {
	vec4 v = vec4(float(p & uint(0xff)), float((p >> uint(8)) & uint(0xff)), float((p >> uint(16)) & uint(0xff)), float(p >> uint(24)));
	return clamp((v - vec4(127.0)) * vec4(0.00787401574), vec4(-1.0), vec4(1.0));
}

#define packUnorm4x8 godot_packUnorm4x8
#define unpackUnorm4x8 godot_unpackUnorm4x8
#define packSnorm4x8 godot_packSnorm4x8
#define unpackSnorm4x8 godot_unpackSnorm4x8
`;
