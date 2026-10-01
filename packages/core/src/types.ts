import type { ConversionSettings } from './units';

/** Time (minutes) -> value in canonical units. Missing = undefined (never 0). */
export type Series = Partial<Record<number, number | undefined>>;

export interface Inputs {
  glucose?: Series; // mmol/L
  insulin?: Series; // pmol/L
  ffa?: Series; // mmol/L (fasting = time 0)
  tg?: number; // mmol/L
  hdl?: number; // mmol/L
  weight?: number; // kg
  bmi?: number; // kg/m2
  waist?: number; // cm
  age?: number; // years
  sex?: 'male' | 'female';
}

/** Normal-population reference means, canonical units; areas in canonical-unit*h. */
export interface Reference {
  name?: string;
  insulin_0?: number;
  glucose_0?: number;
  ffa_0?: number;
  insulin_area_0_1_2h?: number;
  glucose_area_0_1_2h?: number;
  ffa_area_0_1_2h?: number;
  insulin_area_0_2h?: number;
  glucose_area_0_2h?: number;
  ffa_area_0_2h?: number;
}

export type Status = 'ok' | 'unavailable' | 'error';
export type Direction = 'higher_more_sensitive' | 'higher_more_resistant' | 'unknown';

export interface Result {
  id: string;
  value: number | null;
  status: Status;
  direction: Direction;
  unit?: string;
  reasons: string[];
  warnings: string[];
  details?: Record<string, unknown>;
  conversion: ConversionSettings;
}
