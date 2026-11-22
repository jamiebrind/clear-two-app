import { setTimeout as delay } from 'node:timers/promises';

import { inputLabels, type InputId } from './inputs.ts';

const inputCommands: Record<InputId, string> = {
  wifi: 'wifi', aux: 'line-in', bluetooth: 'bluetooth', 'usb-drive': 'udisk',
  'usb-dac': 'PCUSB', optical: 'optical', coaxial: 'co-axial', 'aux-2': 'line-in2',
};
const inputBits: Record<Exclude<InputId, 'wifi'>, number> = {
  aux: 1, bluetooth: 2, 'usb-drive': 3, 'usb-dac': 15, optical: 4, coaxial: 6, 'aux-2': 8,
};
const playbackInputs: Record<string, InputId> = {
  '0': 'wifi', '1': 'wifi', '2': 'wifi', '10': 'wifi', '20': 'wifi', '31': 'wifi', '32': 'wifi',
  '11': 'usb-drive', '40': 'aux', '41': 'bluetooth', '43': 'optical',
  '45': 'coaxial', '47': 'aux-2', '51': 'usb-dac',
};
const ampV4Inputs = new Set<InputId>(['aux', 'bluetooth', 'usb-drive', 'usb-dac']);

export class InputConflict extends Error {}

export interface SpeakerState {
  name: string;
  model: string | null;
  firmware: string | null;
  source: string;
  status: string;
  volume: number | null;
  muted: boolean | null;
  title: string | null;
  artist: string | null;
  input: InputId | null;
  inputs: InputId[];
  groupGuest: boolean;
}

export type LevelChange = { volume: number } | { mute: boolean };
export type SendCommand = (command: string) => Promise<string>;

const sources: Record<string, string> = {
  '0': 'Idle', '1': 'AirPlay', '2': 'DLNA', '10': 'Network', '11': 'USB storage',
  '20': 'Network stream', '31': 'Spotify Connect', '32': 'TIDAL Connect', '40': 'Line in', '41': 'Bluetooth',
  '43': 'Optical', '45': 'Coaxial', '47': 'Line in 2', '51': 'USB DAC', '99': 'Grouped playback',
};
const statuses: Record<string, string> = { play: 'Playing', pause: 'Paused', stop: 'Stopped', idle: 'Idle' };

function parseObject(response: string): Record<string, unknown> {
  const value: unknown = JSON.parse(response);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unexpected response from the amplifier.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadata(value: unknown): string | null {
  const hex = text(value);
  if (!hex || !/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const bytes = Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  const decoded = text(new TextDecoder().decode(bytes).replace(/\0+$/, ''));
  return decoded?.toLowerCase() === 'unknown' ? null : decoded;
}

function parseVolume(value: unknown) {
  const volume = typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : value;
  return typeof volume === 'number' && Number.isInteger(volume) && volume >= 0 && volume <= 100 ? volume : null;
}

export function parseLevelChange(body: unknown): LevelChange | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1) return null;
  if ('mute' in body && typeof body.mute === 'boolean') return { mute: body.mute };
  if ('volume' in body && typeof body.volume === 'number' && parseVolume(body.volume) !== null) {
    return { volume: body.volume };
  }
  return null;
}

export function parseInputChange(body: unknown): InputId | null {
  if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !('input' in body)) return null;
  return typeof body.input === 'string' && Object.hasOwn(inputLabels, body.input) ? body.input as InputId : null;
}

function supportedInputs(model: string | null, value: unknown): InputId[] {
  const raw = String(value);
  const mask = /^(?:0x[0-9a-f]{1,8}|\d{1,10})$/i.test(raw) ? Number(raw) : 0;
  return (Object.keys(inputLabels) as InputId[]).filter((input) =>
    input === 'wifi' || (model === 'UP2STREAM_AMP_V4' && ampV4Inputs.has(input)) || Boolean(mask & (1 << inputBits[input])));
}

export function createSpeaker(send: SendCommand) {
  async function read(): Promise<SpeakerState> {
    const [device, player] = await Promise.all([
      send('getStatusEx').then(parseObject),
      send('getPlayerStatus').then(parseObject),
    ]);
    return speakerState(device, player);
  }

  function speakerState(device: Record<string, unknown>, player: Record<string, unknown>): SpeakerState {
    const name = text(device.DeviceName);
    if (!name) throw new Error('The amplifier did not report a device name.');

    const mute = String(player.mute);
    const mode = String(player.mode);
    const groupGuest = String(player.type) === '1' || mode === '99';
    const model = text(device.project);
    return {
      name,
      model,
      firmware: text(device.firmware),
      source: groupGuest ? 'Grouped playback' : (Object.hasOwn(sources, mode) ? sources[mode] : 'Unknown source'),
      status: statuses[String(player.status)] ?? 'Status unavailable',
      volume: parseVolume(player.vol),
      muted: mute === '1' ? true : mute === '0' ? false : null,
      title: metadata(player.Title),
      artist: metadata(player.Artist),
      input: !groupGuest && Object.hasOwn(playbackInputs, mode) ? playbackInputs[mode] : null,
      inputs: supportedInputs(model, device.plm_support),
      groupGuest,
    };
  }

  async function change(level: LevelChange): Promise<SpeakerState> {
    const command = 'volume' in level ? `vol:${level.volume}` : `mute:${level.mute ? 1 : 0}`;
    const response = await send(`setPlayerCmd:${command}`);
    if (response.trim() !== 'OK') throw new Error('The amplifier rejected the change.');

    const state = await read();
    if ('volume' in level ? state.volume !== level.volume : state.muted !== level.mute) {
      throw new Error('The amplifier did not confirm the requested setting.');
    }
    return state;
  }

  async function switchInput(input: InputId): Promise<SpeakerState> {
    const readPlayer = () => send('getPlayerStatus').then(parseObject);
    const [device, player] = await Promise.all([send('getStatusEx').then(parseObject), readPlayer()]);
    const before = speakerState(device, player);
    if (before.groupGuest) throw new InputConflict('Change the input in the host room.');
    if (!before.inputs.includes(input)) throw new InputConflict('This speaker does not report support for that input.');
    if (before.input === input) return before;

    const acknowledgement = await send(`setPlayerCmd:switchmode:${inputCommands[input]}`).catch(() => null);
    if (acknowledgement !== null && acknowledgement.trim() !== 'OK') throw new Error('The amplifier rejected the input change.');
    for (const wait of [0, 300, 600]) {
      if (wait) await delay(wait);
      const updated = await readPlayer().catch(() => null);
      if (!updated) continue;
      const state = speakerState(device, updated);
      if (state.groupGuest) throw new InputConflict('This room joined a group. Change the input in the host room.');
      if (state.input === input) return state;
    }
    throw new Error('Could not confirm the input change. Check the selected input before trying again.');
  }

  return { read, change, switchInput };
}
