import { Checkbox, Select, TextInput, text } from '@volter/editor-sdk/widgets';
import type { CSSProperties } from 'react';

type JsonSchema = Record<string, unknown>;

function schemaRecord(value: unknown): JsonSchema {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonSchema) : {};
}

function schemaType(schema: JsonSchema): string | undefined {
  const type = schema['type'];
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.find((item): item is string => item !== 'null');
  return undefined;
}

export function defaultValueForSchema(value: unknown): unknown {
  const schema = schemaRecord(value);
  if ('default' in schema) return structuredClone(schema['default']);
  const type = schemaType(schema);
  if (type === 'object' || schema['properties']) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schemaRecord(schema['properties']))) {
      const childSchema = schemaRecord(child);
      if (
        'default' in childSchema ||
        (Array.isArray(schema['required']) && schema['required'].includes(key))
      ) {
        result[key] = defaultValueForSchema(childSchema);
      }
    }
    return result;
  }
  if (type === 'array') return [];
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return Number(schema['minimum'] ?? 0);
  return '';
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is the deliberately small JSON-Schema widget dispatch; each primitive type remains native HTML.
function PrimitiveField({
  name,
  schema,
  value,
  required,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  value: unknown;
  required: boolean;
  onChange(value: unknown): void;
}) {
  const type = schemaType(schema);
  const description = typeof schema['description'] === 'string' ? schema['description'] : null;
  const choices = Array.isArray(schema['enum']) ? schema['enum'] : null;
  const id = `tool-field:${name}`;

  if (type === 'boolean') {
    return (
      <label style={{ ...fieldStyle, gridTemplateColumns: '18px minmax(0, 1fr)' }}>
        <Checkbox
          id={id}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <span style={fieldLabelStyle}>{humanize(name)}</span>
          {description && <span style={descriptionStyle}>{description}</span>}
        </span>
      </label>
    );
  }

  const label = (
    <span style={fieldLabelStyle}>
      {humanize(name)} {!required && <span style={optionalStyle}>optional</span>}
    </span>
  );

  if (choices) {
    return (
      <label style={fieldStyle} htmlFor={id}>
        {label}
        <Select
          id={id}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          style={controlLayoutStyle}
        >
          {!required && <option value="">Not set</option>}
          {choices.map((choice) => (
            <option key={String(choice)} value={String(choice)}>
              {String(choice)}
            </option>
          ))}
        </Select>
        {description && <span style={descriptionStyle}>{description}</span>}
      </label>
    );
  }

  if (type === 'number' || type === 'integer') {
    return (
      <label style={fieldStyle} htmlFor={id}>
        {label}
        <TextInput
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={typeof schema['minimum'] === 'number' ? schema['minimum'] : undefined}
          max={typeof schema['maximum'] === 'number' ? schema['maximum'] : undefined}
          step={type === 'integer' ? 1 : 'any'}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : Number(event.target.value))
          }
          style={controlLayoutStyle}
        />
        {description && <span style={descriptionStyle}>{description}</span>}
      </label>
    );
  }

  if (type === 'array' && schemaType(schemaRecord(schema['items'])) === 'string') {
    return (
      <label style={fieldStyle} htmlFor={id}>
        {label}
        <TextInput
          id={id}
          value={Array.isArray(value) ? value.join(', ') : ''}
          onChange={(event) =>
            onChange(
              event.target.value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
          placeholder="Comma-separated values"
          style={controlLayoutStyle}
        />
        {description && <span style={descriptionStyle}>{description}</span>}
      </label>
    );
  }

  return (
    <label style={fieldStyle} htmlFor={id}>
      {label}
      <TextInput
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value || (required ? '' : undefined))}
        style={controlLayoutStyle}
      />
      {description && <span style={descriptionStyle}>{description}</span>}
    </label>
  );
}

function ObjectFields({
  schema,
  value,
  onChange,
  path = '',
}: {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange(value: Record<string, unknown>): void;
  path?: string;
}) {
  const properties = schemaRecord(schema['properties']);
  const required = new Set(Array.isArray(schema['required']) ? schema['required'] : []);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {Object.entries(properties).map(([key, child]) => {
        const childSchema = schemaRecord(child);
        const childType = schemaType(childSchema);
        const update = (next: unknown) => {
          const copy = { ...value };
          if (next === undefined) delete copy[key];
          else copy[key] = next;
          onChange(copy);
        };
        if (childType === 'object' || childSchema['properties']) {
          return (
            <fieldset key={key} style={fieldsetStyle}>
              <legend style={legendStyle}>{humanize(key)}</legend>
              {typeof childSchema['description'] === 'string' && (
                <p style={{ ...descriptionStyle, marginTop: 0 }}>{childSchema['description']}</p>
              )}
              <ObjectFields
                schema={childSchema}
                value={schemaRecord(value[key])}
                onChange={update}
                path={path ? `${path}.${key}` : key}
              />
            </fieldset>
          );
        }
        return (
          <PrimitiveField
            key={key}
            name={path ? `${path}.${key}` : key}
            schema={childSchema}
            value={value[key]}
            required={required.has(key)}
            onChange={update}
          />
        );
      })}
    </div>
  );
}

export function ToolSchemaForm({
  schema: schemaValue,
  value,
  onChange,
}: {
  schema: unknown;
  value: Record<string, unknown>;
  onChange(value: Record<string, unknown>): void;
}) {
  const schema = schemaRecord(schemaValue);
  if (!schema['properties']) {
    return <div style={descriptionStyle}>This schema has no form-compatible fields.</div>;
  }
  return <ObjectFields schema={schema} value={value} onChange={onChange} />;
}

const fieldStyle: CSSProperties = { display: 'grid', gap: 5 };
const fieldLabelStyle: CSSProperties = {
  color: text[1],
  fontWeight: 600,
  fontSize: 'var(--vgai-font-sm)',
};
const optionalStyle: CSSProperties = { color: text[3], fontWeight: 400, marginLeft: 5 };
const descriptionStyle: CSSProperties = {
  display: 'block',
  color: text[2],
  fontSize: 'var(--vgai-font-sm)',
  lineHeight: 1.4,
};
const controlLayoutStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
};
const fieldsetStyle: CSSProperties = {
  margin: 0,
  padding: 14,
  border: '1px solid var(--vgai-boundary-default)',
  borderRadius: 'var(--vgai-radius-md)',
};
const legendStyle: CSSProperties = { padding: '0 6px', color: text[1], fontWeight: 600 };
