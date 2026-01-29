export enum SpeedUnit {
  MS = 'm/s',
  MH = 'm/h',
  KMH = 'km/h',
  MPH = 'mph'
}

export enum TimeFormat {
  H12_SEC = '12h-sec',
  H12 = '12h',
  H24_SEC = '24h-sec',
  H24 = '24h'
}

export interface SpeedData {
  current: number;
  max: number;
  avg: number;
  unit: SpeedUnit;
}

export interface LocationState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  heading: number | null;
  timestamp: number;
}