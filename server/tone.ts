import { once } from 'node:events';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { toneBands } from '../src/tone.ts';
import type { ToneBand, ToneChange, ToneSettings } from '../src/tone.ts';

const header = Buffer.from('18961820', 'hex');
const commands = { bass: 'BAS', mid: 'MID', treble: 'TRE' };
const checksum = (data: Buffer) => data.reduce((sum, byte) => sum + byte, 0);

function validGain(gain: unknown): gain is number {
  return typeof gain === 'number' && Number.isInteger(gain) && gain >= -10 && gain <= 10;
}

export function parseToneChange(body: unknown): ToneChange | null {
  if (!body || typeof body !== 'object' || !('band' in body) || !('gain' in body) || Object.keys(body).length !== 2) return null;
  const { band, gain } = body;
  return toneBands.some((known) => known === band) && validGain(gain) ? { band: band as ToneBand, gain } : null;
}

export function frameCommand(command: string): Buffer {
  const payload = Buffer.from(command);
  const packet = Buffer.alloc(20 + payload.length);
  header.copy(packet);
  packet.writeUInt32LE(payload.length, 4);
  packet.writeUInt32LE(checksum(payload), 8);
  payload.copy(packet, 20);
  return packet;
}

type Query = (band: ToneBand, gain?: number) => Promise<number>;

export function createToneController(host: string, port = 8899) {
  let nextSend = 0;
  let busy = false;

  async function withConnection<T>(operation: (query: Query) => Promise<T>): Promise<T> {
    if (busy) throw new Error('A tone request is already in progress.');
    busy = true;
    const socket = createConnection({ host, port });
    const deadline = setTimeout(() => socket.destroy(new Error('Tone request timed out.')), 4300);
    try {
      await once(socket, 'connect');
      const incoming = socket[Symbol.asyncIterator]();
      let buffer = Buffer.alloc(0);

      async function readFrame() {
        while (true) {
          if (buffer.length >= 20) {
            const length = buffer.readUInt32LE(4);
            if (!header.equals(buffer.subarray(0, 4)) || length > 65536) throw new Error('Invalid amplifier packet.');
            if (buffer.length >= length + 20) {
              const expected = buffer.readUInt32LE(8);
              const payload = buffer.subarray(20, 20 + length);
              buffer = buffer.subarray(20 + length);
              if (checksum(payload) !== expected) throw new Error('Invalid amplifier checksum.');
              return payload.toString('utf8').trim();
            }
          }
          const chunk = await incoming.next();
          if (chunk.done) throw new Error('The amplifier closed the tone connection.');
          buffer = Buffer.concat([buffer, chunk.value]);
        }
      }

      return await operation(async (band, gain) => {
        await delay(Math.max(0, Math.ceil(nextSend - performance.now())));
        const command = `MCU+PAS+RAKOIT:${commands[band]}`;
        nextSend = performance.now() + 220;
        socket.write(frameCommand(gain === undefined ? `${command}&` : `${command}:${gain}&`));
        while (true) {
          const reply = await readFrame();
          if (reply.startsWith('MCU+PAS+RAKOIT:ERR:')) throw new Error('The amplifier rejected the tone command.');
          if (reply.startsWith(`${command}:`)) {
            const value = reply.slice(command.length + 1).replace(/&$/, '');
            if (!/^-?\d+$/.test(value) || !validGain(Number(value))) throw new Error('Invalid tone value from the amplifier.');
            return Number(value);
          }
        }
      });
    } finally {
      clearTimeout(deadline);
      socket.destroy();
      busy = false;
    }
  }

  return {
    read: () => withConnection(async (query): Promise<ToneSettings> => ({ bass: await query('bass'), mid: await query('mid'), treble: await query('treble') })),
    change: ({ band, gain }: ToneChange) => withConnection(async (query) => {
      await query(band, gain);
      const actual = await query(band);
      if (actual !== gain) throw new Error('The amplifier did not confirm the requested tone setting.');
      return actual;
    }),
  };
}
