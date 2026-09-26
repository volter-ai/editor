/** Type boundary for the preserved upstream FastNoiseLite 1.1 JavaScript implementation. */

type NoiseType = 'OpenSimplex2' | 'OpenSimplex2S' | 'Cellular' | 'Perlin' | 'ValueCubic' | 'Value';
type FractalType = 'None' | 'FBm' | 'Ridged' | 'PingPong' | 'DomainWarpProgressive' | 'DomainWarpIndependent';
type CellularDistance = 'Euclidean' | 'EuclideanSq' | 'Manhattan' | 'Hybrid';
type CellularReturn = 'CellValue' | 'Distance' | 'Distance2' | 'Distance2Add' | 'Distance2Sub' | 'Distance2Mul' | 'Distance2Div';
type DomainWarpType = 'OpenSimplex2' | 'OpenSimplex2Reduced' | 'BasicGrid';

export default class FastNoiseLiteCore {
  static readonly NoiseType: Readonly<Record<NoiseType, NoiseType>>;
  static readonly FractalType: Readonly<Record<FractalType, FractalType>>;
  static readonly CellularDistanceFunction: Readonly<Record<CellularDistance, CellularDistance>>;
  static readonly CellularReturnType: Readonly<Record<CellularReturn, CellularReturn>>;
  static readonly DomainWarpType: Readonly<Record<DomainWarpType, DomainWarpType>>;

  constructor(seed?: number);
  SetSeed(seed: number): void;
  SetFrequency(frequency: number): void;
  SetNoiseType(type: NoiseType): void;
  SetFractalType(type: FractalType): void;
  SetFractalOctaves(octaves: number): void;
  SetFractalLacunarity(lacunarity: number): void;
  SetFractalGain(gain: number): void;
  SetFractalWeightedStrength(strength: number): void;
  SetFractalPingPongStrength(strength: number): void;
  SetCellularDistanceFunction(type: CellularDistance): void;
  SetCellularReturnType(type: CellularReturn): void;
  SetCellularJitter(jitter: number): void;
  SetDomainWarpType(type: DomainWarpType): void;
  SetDomainWarpAmp(amplitude: number): void;
  GetNoise(x: number, y: number): number;
  GetNoise(x: number, y: number, z: number): number;
  DomainWrap(point: { x: number; y: number; z?: number }): void;
}
