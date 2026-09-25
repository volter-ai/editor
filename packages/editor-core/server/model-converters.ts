/**
 * The model conversions the composed media register through their serving halves
 * (`ProjectServingServices.registerModelConverter`): what the asset library runs to turn a
 * staged source model into the runtime GLB it imports.
 */
import type { ModelConverter } from '@volter/editor-sdk/session/project-serving';

const converters: ModelConverter[] = [];

export function registerModelConverter(converter: ModelConverter): () => void {
  converters.push(converter);
  return () => {
    const index = converters.indexOf(converter);
    if (index >= 0) converters.splice(index, 1);
  };
}

/** The registered converter for `format`, or null when no medium converts it. */
export function modelConverterFor(format: string): ModelConverter | null {
  const wanted = format.toLowerCase();
  return converters.find((converter) => converter.formats.includes(wanted)) ?? null;
}
