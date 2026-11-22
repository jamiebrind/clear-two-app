import type { SetupJoin, SetupNetwork, SetupProgress, SetupScan, SetupSpeaker } from '../src/setup.ts';

export const hotspot = '10.10.10.254';
export type SetupTransport = (address: string, command: string) => Promise<string>;

export function localAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(value)) return false;
  const octets = value.split('.');
  return octets.length === 4 && octets.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

export function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{16,40}$/i.test(value);
}

export function parseNetworks(response: string): SetupNetwork[] {
  const payload = JSON.parse(response);
  if (!Array.isArray(payload?.aplist)) throw new Error('The amp did not return a Wi-Fi network list. Try scanning again.');
  const networks = new Map<string, SetupNetwork>();
  for (const entry of payload.aplist) {
    const encoded = entry?.ssid;
    const channel = Number(entry?.channel);
    if (typeof encoded !== 'string' || !/^(?:[0-9a-f]{2}){1,32}$/i.test(encoded) || !Number.isInteger(channel) || channel < 1 || channel > 12) continue;
    let ssid: string;
    try { ssid = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(encoded.match(/../g)!, (pair) => parseInt(pair, 16))); }
    catch { continue; }
    if (!ssid.trim() || networks.has(ssid)) continue;
    const auth = String(entry.auth).toUpperCase();
    const encryption = String(entry.encry).toUpperCase();
    if (auth.includes('WPA2PSK') && encryption.includes('AES')) networks.set(ssid, { ssid, channel, security: 'WPA2' });
    else if (auth === 'OPEN' && ['NONE', 'UNDEFINED', ''].includes(encryption)) networks.set(ssid, { ssid, channel, security: 'Open' });
  }
  return [...networks.values()];
}

function identify(response: string, expected?: string): SetupSpeaker & { address?: string } {
  const metadata = JSON.parse(response);
  if (metadata?.project !== 'UP2STREAM_AMP_V4' || metadata.hardware !== 'A31' || !validUuid(metadata.uuid)) {
    throw new Error('This setup flow supports the A31 Up2Stream Amp V4.');
  }
  if (expected && expected.toUpperCase() !== metadata.uuid.toUpperCase()) {
    throw new Error('That address belongs to a different speaker.');
  }
  const name = typeof metadata.DeviceName === 'string' && metadata.DeviceName.trim() ? metadata.DeviceName : 'Up2Stream Amp V4';
  const address = localAddress(metadata.apcli0) && metadata.apcli0 !== hotspot ? metadata.apcli0 : undefined;
  return { name, uuid: metadata.uuid, ...(address && { address }) };
}

export function createSetup(request: SetupTransport) {
  return {
    async scan(): Promise<SetupScan> {
      const { name, uuid } = identify(await request(hotspot, 'getStatusEx'));
      return { speaker: { name, uuid }, networks: parseNetworks(await request(hotspot, 'wlanGetApListEx')) };
    },
    async join({ uuid, ssid, channel, password }: SetupJoin) {
      identify(await request(hotspot, 'getStatusEx'), uuid);
      const networks = parseNetworks(await request(hotspot, 'wlanGetApListEx'));
      const network = networks.find((entry) => entry.ssid === ssid && entry.channel === channel);
      if (!network) throw new Error('That network is no longer listed. Scan again.');
      const secured = network.security === 'WPA2';
      const encoder = new TextEncoder();
      const bytes = encoder.encode(password);
      if (secured ? bytes.length < 8 || bytes.length > 63 : bytes.length !== 0) {
        throw new Error(secured ? 'Enter a Wi-Fi password between 8 and 63 bytes.' : 'This open network does not use a password.');
      }
      const hex = (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
      const command = `wlanConnectApEx:ssid=${hex(encoder.encode(network.ssid))}:ch=${channel}:auth=${secured ? 'WPA2PSK' : 'OPEN'}:encry=${secured ? 'AES' : 'NONE'}:pwd=${hex(bytes)}:chext=1`;
      // The hotspot may close before the command returns. Verify completion independently.
      let reply: string;
      try { reply = await request(hotspot, command); }
      catch { return; }
      if (reply.trim() && reply.trim() !== 'OK') throw new Error('The speaker rejected the Wi-Fi setup request.');
    },
    async progress(uuid: string): Promise<SetupProgress> {
      let reply: string;
      try { reply = (await request(hotspot, 'wlanGetConnectState')).trim(); }
      catch { return { status: 'hotspot-unavailable' }; }
      if (reply === 'PAIRFAIL') return { status: 'bad-password' };
      if (reply === 'FAIL') return { status: 'failed' };
      if (reply !== 'OK') return { status: 'joining' };
      let metadata: string;
      try { metadata = await request(hotspot, 'getStatusEx'); }
      catch { return { status: 'hotspot-unavailable' }; }
      const { address } = identify(metadata, uuid);
      return { status: 'joined', ...(address && { address }) };
    },
    async verify(address: unknown, expected?: string): Promise<SetupSpeaker> {
      if (!localAddress(address) || address === hotspot) throw new Error('Enter the speaker’s local IPv4 address on your home network.');
      const { name, uuid } = identify(await request(address, 'getStatusEx'), expected);
      return { name, uuid };
    },
  };
}
