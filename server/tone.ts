import { once } from 'node:events';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createToneOperations, validGain, type ToneQuery } from '../src/tone.ts';
export { parseToneChange, ToneConflict } from '../src/tone.ts';

const header = Buffer.from('18961820', 'hex');
const commands = { bass: 'BAS', mid: 'MID', treble: 'TRE' };
const checksum = (data: Buffer) => data.reduce((sum, byte) => sum + byte, 0);

export function frameCommand(command: string): Buffer {
  const payload = Buffer.from(command);
  const packet = Buffer.alloc(20 + payload.length);
  header.copy(packet);
  packet.writeUInt32LE(payload.length, 4);
  packet.writeUInt32LE(checksum(payload), 8);
  payload.copy(packet, 20);
  return packet;
}

export function createToneController(host: string, port = 8899) {
  let nextSend = 0;
  let busy = false;

  async function withConnection<T>(operation: (query: ToneQuery) => Promise<T>): Promise<T> {
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

  return createToneOperations(withConnection);
}
