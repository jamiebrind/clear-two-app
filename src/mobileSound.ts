import { createGroup } from '../server/group.ts';
import { createSpeaker } from './speaker.ts';
import { delay } from './delay.ts';
import { createToneOperations, parseToneChange, validGain, type ToneBand, type ToneQuery } from './tone.ts';
import { createSweepWave, parseTuningSettings, sweepLifetimeMs, TuningConflict, verifySweepPlayback, verifyTuningRoom } from './sweepPlayback.ts';

interface SoundPlugin {
  tone(options: { address: string; band: ToneBand; gain?: number }): Promise<{ gain: number }>;
  serveSweep(options: { address: string; wav: string }): Promise<{ url: string }>;
}

function mobileTone(address: string, plugin: SoundPlugin) {
  let nextSend = 0;
  const query: ToneQuery = async (band, gain) => {
    const wait = Math.ceil(nextSend - performance.now());
    if (wait > 0) await delay(wait);
    try {
      const reply = await plugin.tone(gain === undefined ? { address, band } : { address, band, gain });
      if (!validGain(reply.gain)) throw new Error('Invalid tone value from the amplifier.');
      return reply.gain;
    } finally {
      // The native call may spend time connecting before it sends the command.
      nextSend = performance.now() + 225;
    }
  };
  const operations = createToneOperations((operation) => operation(query));
  let pending = Promise.resolve();
  // Keep an entire EQ transaction, including its recovery, together on this amplifier.
  return <T>(operation: (tone: typeof operations) => Promise<T>) => {
    const result = pending.then(() => operation(operations));
    pending = result.then(() => {}, () => {});
    return result;
  };
}

function sweepBase64() {
  const bytes = createSweepWave();
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 16384) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  }
  return btoa(chunks.join(''));
}

function bodyFields(body: unknown) {
  return body && typeof body === 'object' ? body as Record<string, unknown> : {};
}

export function createMobileSound(send: (address: string, command: string) => Promise<string>, plugin: SoundPlugin) {
  const tones = new Map<string, ReturnType<typeof mobileTone>>();
  const groups = createGroup(send);
  let wav: string | undefined;
  let sweepExpires = 0;

  function tone(address: string) {
    let run = tones.get(address);
    if (!run) {
      run = mobileTone(address, plugin);
      tones.set(address, run);
    }
    return run;
  }

  return {
    read: (address: string) => tone(address)((controller) => controller.read()),
    async change(address: string, body: unknown) {
      const change = parseToneChange(body);
      if (!change) throw new Error('Choose bass, mid or treble and a whole number from −10 to +10.');
      const gain = await tone(address)((controller) => controller.change(change));
      return { band: change.band, gain };
    },
    async measure(address: string, body: unknown) {
      const speaker = createSpeaker((command) => send(address, command));
      async function checkPlayback(expectedVolume: unknown) {
        const [state, group] = await Promise.all([speaker.read(), groups.read(address)]);
        return verifySweepPlayback(state, group, expectedVolume);
      }
      const volume = await checkPlayback(bodyFields(body).expectedVolume);
      if (performance.now() < sweepExpires) throw new TuningConflict('A sweep is still in progress. Wait for it to finish.');
      sweepExpires = Infinity;
      let sent = false;
      try {
        const { url } = await plugin.serveSweep({ address, wav: wav ??= sweepBase64() });
        await checkPlayback(volume);
        sent = true;
        const reply = await send(address, `setPlayerCmd:play:${url}`).catch(() => null);
        if (reply !== null && reply.trim() !== 'OK') throw new Error('The amplifier rejected the test sweep.');
        return { measuring: true, volume };
      } finally {
        sweepExpires = sent ? performance.now() + sweepLifetimeMs : 0;
      }
    },
    async eq(address: string, body: unknown) {
      const fields = bodyFields(body);
      const expected = parseTuningSettings(fields.expected);
      const target = parseTuningSettings(fields.target);
      if (!expected || !target) throw new Error('Send both valid EQ profiles.');
      return tone(address)(async (controller) => {
        verifyTuningRoom(await groups.read(address));
        return controller.replace(expected, target);
      });
    },
  };
}
