/**
 * @godot-class FastNoiseLite
 * @role BINDING
 *
 * The types of the `fastnoise-lite` package (FastNoise Lite's own JavaScript port, MIT), which
 * ships none: the library Godot's `FastNoiseLite` (`modules/noise/fastnoise_lite.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) wraps in C++, as `fast-noise-lite.ts` binds it. Only
 * the members compat calls are declared.
 */

declare module 'fastnoise-lite' {
  export default class FastNoiseLite {
    static readonly NoiseType: Readonly<Record<'OpenSimplex2' | 'OpenSimplex2S' | 'Cellular' | 'Perlin' | 'ValueCubic' | 'Value', string>>;
    static readonly FractalType: Readonly<Record<'None' | 'FBm' | 'Ridged' | 'PingPong' | 'DomainWarpProgressive' | 'DomainWarpIndependent', string>>;
    static readonly CellularDistanceFunction: Readonly<Record<'Euclidean' | 'EuclideanSq' | 'Manhattan' | 'Hybrid', string>>;
    static readonly CellularReturnType: Readonly<Record<'CellValue' | 'Distance' | 'Distance2' | 'Distance2Add' | 'Distance2Sub' | 'Distance2Mul' | 'Distance2Div', string>>;
    constructor(seed?: number);
    SetSeed(seed: number): void;
    SetFrequency(frequency: number): void;
    SetNoiseType(noiseType: string): void;
    SetFractalType(fractalType: string): void;
    SetFractalOctaves(octaves: number): void;
    SetFractalLacunarity(lacunarity: number): void;
    SetFractalGain(gain: number): void;
    SetFractalWeightedStrength(weightedStrength: number): void;
    SetFractalPingPongStrength(pingPongStrength: number): void;
    SetCellularDistanceFunction(cellularDistanceFunction: string): void;
    SetCellularReturnType(cellularReturnType: string): void;
    SetCellularJitter(cellularJitter: number): void;
    GetNoise(x: number, y: number): number;
    GetNoise(x: number, y: number, z: number): number;
  }
}
