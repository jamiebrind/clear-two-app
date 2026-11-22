import { randomUUID } from 'node:crypto';
import { createSweepWave, sweepLifetimeMs, TuningConflict } from '../src/sweepPlayback.ts';
export { parseTuningSettings, TuningConflict, verifySweepPlayback, verifyTuningRoom } from '../src/sweepPlayback.ts';

export function createSweepPlayback() {
  let wave: Buffer | undefined;
  let current: { token: string; address: string; expires: number } | undefined;
  return {
    issue(address: string) {
      if (current && Date.now() < current.expires) throw new TuningConflict('A sweep is still in progress. Wait for it to finish.');
      const token = `${randomUUID()}.wav`;
      current = { token, address, expires: Date.now() + sweepLifetimeMs };
      return token;
    },
    read(token: string, address?: string) {
      if (current?.token === token && current.address === address && Date.now() < current.expires) return wave ??= Buffer.from(createSweepWave());
    },
  };
}
