export const toneBands = ['bass', 'mid', 'treble'] as const;
export type ToneBand = (typeof toneBands)[number];
export type ToneSettings = Record<ToneBand, number>;
export interface ToneChange { band: ToneBand; gain: number }
