export const toneBands = ['bass', 'mid', 'treble'] as const;
export type ToneBand = (typeof toneBands)[number];
export type ToneSettings = Record<ToneBand, number>;
export interface ToneChange { band: ToneBand; gain: number }

export function validGain(gain: unknown): gain is number {
  return typeof gain === 'number' && Number.isInteger(gain) && gain >= -10 && gain <= 10;
}

export function parseToneChange(body: unknown): ToneChange | null {
  if (!body || typeof body !== 'object' || !('band' in body) || !('gain' in body) || Object.keys(body).length !== 2) return null;
  const { band, gain } = body;
  return toneBands.some((known) => known === band) && validGain(gain) ? { band: band as ToneBand, gain } : null;
}

export type ToneQuery = (band: ToneBand, gain?: number) => Promise<number>;

export class ToneConflict extends Error {}

async function readSettings(query: ToneQuery): Promise<ToneSettings> {
  return { bass: await query('bass'), mid: await query('mid'), treble: await query('treble') };
}

async function setGain(query: ToneQuery, band: ToneBand, gain: number) {
  await query(band, gain);
  const actual = await query(band);
  if (actual !== gain) throw new Error('The amplifier did not confirm the requested tone setting.');
  return actual;
}

export function createToneOperations(withConnection: <T>(operation: (query: ToneQuery) => Promise<T>) => Promise<T>) {
  return {
    read: () => withConnection(readSettings),
    change: ({ band, gain }: ToneChange) => withConnection((query) => setGain(query, band, gain)),
    async replace(expected: ToneSettings, target: ToneSettings) {
      const attempted: ToneBand[] = [];
      if (toneBands.some((band) => !validGain(target[band]))) throw new ToneConflict('Invalid EQ settings.');
      try {
        return await withConnection(async (query) => {
          const current = await readSettings(query);
          if (toneBands.some((band) => expected[band] !== current[band])) {
            throw new ToneConflict('The EQ has changed since measurement. Review the current settings before trying again.');
          }
          for (const band of toneBands) {
            if (target[band] === current[band]) continue;
            attempted.push(band);
            await setGain(query, band, target[band]);
          }
          return target;
        });
      } catch (error) {
        if (!attempted.length) throw error;
        try {
          await withConnection(async (query) => {
            for (const band of attempted) {
              const actual = await query(band);
              if (actual === expected[band]) continue;
              if (actual !== target[band]) throw new Error('EQ changed elsewhere.');
              await setGain(query, band, expected[band]);
            }
          });
        } catch {
          throw new Error('Could not restore all EQ settings. Check Tone controls against your saved original settings.');
        }
        throw new Error('Could not confirm the EQ change. The previous settings were restored.');
      }
    },
  };
}
