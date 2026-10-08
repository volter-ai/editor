import { NumberInput } from './NumberInput';

interface Vec3InputProps {
  value: [number | null, number | null, number | null];
  onChange: (value: [number, number, number]) => void;
  /** Per-axis callback for multi-edit. When provided, takes priority over onChange. */
  onAxisChange?: (axis: 0 | 1 | 2, value: number) => void;
  step?: number;
  disabled?: boolean;
  /** When set, each axis field gets `data-testid="{prefix}-x|y|z"` for e2e. */
  testIdPrefix?: string | undefined;
}

export function Vec3Input({
  value,
  onChange,
  onAxisChange,
  step = 0.1,
  disabled = false,
  testIdPrefix,
}: Vec3InputProps) {
  const tid = (axis: 'x' | 'y' | 'z') => (testIdPrefix ? `${testIdPrefix}-${axis}` : undefined);
  const handleAxis = (axis: 0 | 1 | 2) => (v: number) => {
    if (onAxisChange) {
      onAxisChange(axis, v);
    } else {
      const tuple: [number, number, number] = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
      tuple[axis] = v;
      onChange(tuple);
    }
  };

  // Axis tint literals are deliberate (not tokenized): they mirror the
  // viewport gizmo's R/G/B axis colors, a cross-tool convention (Unity/
  // Blender) distinct from the semantic danger/success/accent tones.
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <NumberInput
        label="X"
        labelColor="#E06178"
        value={value[0]}
        onChange={handleAxis(0)}
        step={step}
        disabled={disabled}
        style={{ flex: 1 }}
        testId={tid('x')}
      />
      <NumberInput
        label="Y"
        labelColor="#C2ED66"
        value={value[1]}
        onChange={handleAxis(1)}
        step={step}
        disabled={disabled}
        style={{ flex: 1 }}
        testId={tid('y')}
      />
      <NumberInput
        label="Z"
        labelColor="#6BABF5"
        value={value[2]}
        onChange={handleAxis(2)}
        step={step}
        disabled={disabled}
        style={{ flex: 1 }}
        testId={tid('z')}
      />
    </div>
  );
}
