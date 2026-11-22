import { createRooms } from '../server/rooms.ts';
import { createGroup, parseGroupAction } from '../server/group.ts';
import { createSetup, localAddress, validUuid, type SetupTransport } from '../server/setup.ts';
import { createSpeaker, parseInputChange, parseLevelChange, parsePlaybackChange } from './speaker.ts';
import type { SetupJoin } from './setup.ts';
import type { createMobileSound } from './mobileSound.ts';

interface DirectOptions {
  send: SetupTransport;
  discover?: () => Promise<string[]>;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  sound?: ReturnType<typeof createMobileSound>;
}

export function createDirectController({ send, discover, storage, sound }: DirectOptions) {
  const key = 'clear-two:direct-rooms';
  let saved: unknown;
  try { saved = JSON.parse(storage.getItem(key) ?? 'null'); } catch { /* Recover through discovery. */ }
  const rooms = createRooms(saved, '', (value) => storage.setItem(key, JSON.stringify(value)));
  const setup = createSetup(send);
  const groups = createGroup(send);
  let busy = false;
  let scan: Promise<number> | undefined;
  let lastScan = -Infinity;

  async function refreshRooms() {
    if (!discover) throw new Error('Add the speaker by its Wi-Fi or Ethernet IP address.');
    if (!scan) {
      lastScan = Date.now();
      scan = discover().then(async (addresses) => {
        const candidates = [...new Set(addresses.filter(localAddress))].slice(0, 24);
        const results = await Promise.allSettled(candidates.map(async (address) => ({ ...await setup.verify(address), address })));
        const found = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
        rooms.remember(found);
        return new Set(found.map((device) => device.uuid.toUpperCase())).size;
      }).finally(() => { scan = undefined; });
    }
    return scan;
  }

  async function verified(id?: string) {
    const room = rooms.get(id);
    if (!room) throw new Error('Choose a saved speaker first.');
    try { await setup.verify(room.address, room.id); return room; }
    catch {
      if (discover && (scan || Date.now() - lastScan > 8000)) {
        await refreshRooms();
        const moved = rooms.get(room.id);
        if (moved && moved.address !== room.address) {
          await setup.verify(moved.address, room.id);
          return moved;
        }
      }
      throw new Error('Speaker unavailable. Check Wi-Fi and local network access, or add the speaker again at its current address.');
    }
  }

  async function dispatch(endpoint: string, body?: object): Promise<unknown> {
    const url = new URL(endpoint, 'https://localhost');
    const path = url.pathname;
    const summary = () => ({ rooms: rooms.list(), defaultId: rooms.get()?.id });
    if (path === '/api/rooms') return summary();
    if (path === '/api/rooms/discover') {
      const foundCount = await refreshRooms();
      return { ...summary(), foundCount };
    }
    if (path === '/api/setup/scan') return setup.scan();
    if (path === '/api/setup/join') return setup.join(body as SetupJoin);
    if (path === '/api/setup/progress') return setup.progress(url.searchParams.get('uuid') ?? '');
    if (path === '/api/setup/add') {
      const { address, uuid } = (body ?? {}) as { address?: string; uuid?: string };
      if (uuid !== undefined && !validUuid(uuid)) throw new Error('Choose a valid speaker.');
      if (!address && uuid) await refreshRooms();
      const candidate = address || (uuid && rooms.get(uuid)?.address);
      const speaker = await setup.verify(candidate, uuid);
      rooms.remember([{ ...speaker, address: candidate! }], speaker.uuid);
      return speaker;
    }
    const groupPath = /^\/api\/rooms\/([^/]+)\/group$/.exec(path);
    const room = await verified(groupPath?.[1] ?? url.searchParams.get('room') ?? undefined);
    if (groupPath) {
      if (!body) return groups.read(room.address);
      const action = parseGroupAction(body);
      if (!action) throw new Error('Choose a valid group action.');
      const guest = action.action === 'join' ? await verified(action.memberId) : undefined;
      return groups.change(room.address, action, guest?.address);
    }
    const speaker = createSpeaker((command) => send(room.address, command));
    if (path === '/api/speaker') return speaker.read();
    const level = parseLevelChange(body);
    if (path === '/api/speaker/level' && level) return speaker.change(level);
    const input = parseInputChange(body);
    if (path === '/api/speaker/input' && input) return speaker.switchInput(input);
    const playback = parsePlaybackChange(body);
    if (path === '/api/speaker/playback' && playback) return speaker.setPlayback(playback);
    if (sound && path === '/api/speaker/tone') return body ? sound.change(room.address, body) : sound.read(room.address);
    if (sound && path === '/api/tuning/measure') return sound.measure(room.address, body);
    if (sound && path === '/api/tuning/eq') return sound.eq(room.address, body);
    throw new Error('This control is unavailable for the current connection.');
  }

  return async (endpoint: string, body?: object) => {
    if (!body) return dispatch(endpoint);
    if (busy) throw new Error('Another speaker change is in progress. Try again.');
    busy = true;
    try { return await dispatch(endpoint, body); }
    finally { busy = false; }
  };
}
