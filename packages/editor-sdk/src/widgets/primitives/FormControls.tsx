import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, type = 'text', ...props },
  ref,
) {
  return <input {...props} ref={ref} type={type} className={classes('vgai-input', className)} />;
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return <select {...props} ref={ref} className={classes('vgai-select', className)} />;
});

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Canonical multiline editor field. Paint and interaction states live in theme.css. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, ...props },
  ref,
) {
  return (
    <textarea {...props} ref={ref} className={classes('vgai-input vgai-textarea', className)} />
  );
});

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref,
) {
  return (
    <input {...props} ref={ref} type="checkbox" className={classes('vgai-checkbox', className)} />
  );
});

export type ColorSwatchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** Native color picker with editor-owned dimensions, border, and focus treatment. */
export const ColorSwatchInput = forwardRef<HTMLInputElement, ColorSwatchInputProps>(
  function ColorSwatchInput({ className, ...props }, ref) {
    return (
      <input
        {...props}
        ref={ref}
        type="color"
        className={classes('vgai-color-swatch', className)}
      />
    );
  },
);

export type FileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** File input kept native for platform behavior while sharing editor focus/disabled states. */
export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(function FileInput(
  { className, ...props },
  ref,
) {
  return (
    <input {...props} ref={ref} type="file" className={classes('vgai-file-input', className)} />
  );
});

export type RangeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const RangeInput = forwardRef<HTMLInputElement, RangeInputProps>(function RangeInput(
  { className, ...props },
  ref,
) {
  return <input {...props} ref={ref} type="range" className={classes('vgai-range', className)} />;
});
