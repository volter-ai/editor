/**
 * @godot-class float
 * @role PROTOCOL
 *
 * Godot 4.7's `float` as the LEFT operand of an operator whose right operand is a built-in value,
 * transcribed from `core/variant/variant_op.cpp` and `core/math/vector{2,3}.h` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A float is a JS number; the operators here are the
 * ones Godot registers with a `double` left operand and return the right operand's type.
 */

import { op_multiply as vector2_multiply, type Vector2 } from './vector2';
import { op_multiply as vector3_multiply, type Vector3 } from './vector3';

/**
 * `float * Vector2` and `float * Vector3` (`OperatorEvaluatorMul<Vector3, double, Vector3>`,
 * `core/variant/variant_op.cpp:267` and `:269`): `operator*(double, const Vector3 &)` returns
 * `p_vec * p_scalar` (`core/math/vector3.h:445`, `core/math/vector2.h:336`), so the scalar converts
 * to `real_t` and multiplies each component, exactly the right operand's `* float`.
 *
 * @godot float.OP_MULTIPLY
 * @source core/variant/variant_op.cpp:269
 */
export function op_multiply(left: number, right: Vector3 | Vector2): Vector3 | Vector2 {
  return 'z' in right ? vector3_multiply(right, left) : vector2_multiply(right, left);
}
