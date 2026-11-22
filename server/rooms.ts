import type { RoomSummary } from '../src/rooms.ts';
import { localAddress, validUuid } from './setup.ts';
import type { SetupSpeaker } from '../src/setup.ts';

export interface Room extends RoomSummary { address: string }
type SavedRooms = { rooms: Room[]; active: string | null; configuredId: string | null; address?: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createRooms(saved: unknown, configured: string, persist: (value: SavedRooms) => void) {
  const initial = record(saved);
  const entries = new Map<string, Room>();
  if (Array.isArray(initial.rooms)) {
    for (const value of initial.rooms) {
      const { id, name, address } = record(value);
      if (validUuid(id) && typeof name === 'string' && localAddress(address)) {
        entries.set(id.toUpperCase(), { id: id.toUpperCase(), name, address });
      }
    }
  }
  const legacyAddress = (localAddress(initial.address) ? initial.address : configured) || '';
  let rooms = entries;
  let active = typeof initial.active === 'string' && entries.has(initial.active) ? initial.active : null;
  let configuredId = typeof initial.configuredId === 'string' && entries.has(initial.configuredId) ? initial.configuredId : null;

  function configuredRoom(): Room | undefined {
    if (configuredId) return rooms.get(configuredId);
    if (!localAddress(legacyAddress)) return;
    return [...rooms.values()].find((room) => room.address === legacyAddress) ??
      { id: 'configured', name: 'Configured speaker', address: legacyAddress };
  }

  function get(id?: string): Room | undefined {
    if (id === 'configured') return configuredRoom();
    if (id !== undefined) return rooms.get(id.toUpperCase());
    return (active && rooms.get(active)) || configuredRoom() || rooms.values().next().value;
  }

  return {
    get,
    list(): RoomSummary[] {
      const configured = configuredRoom();
      const all = [...rooms.values()];
      if (configured?.id === 'configured') all.unshift(configured);
      return all.map(({ id, name }) => ({ id, name }));
    },
    remember(found: Array<SetupSpeaker & { address: string }>, selected?: string) {
      if (!found.length) return;
      const next = new Map(rooms);
      let changed = false;
      let nextConfiguredId = configuredId;
      for (const { uuid, name, address } of found) {
        const id = uuid.toUpperCase();
        if (!nextConfiguredId && address === legacyAddress) nextConfiguredId = id;
        const previous = next.get(id);
        if (previous?.address === address && previous.name === name) continue;
        next.set(id, { id, name, address });
        changed = true;
      }
      const candidate = selected?.toUpperCase();
      const nextActive = candidate && next.has(candidate) ? candidate : active;
      if (!changed && nextActive === active && nextConfiguredId === configuredId) return;
      persist({ rooms: [...next.values()], active: nextActive, configuredId: nextConfiguredId,
        ...(!nextConfiguredId && legacyAddress && { address: legacyAddress }) });
      rooms = next;
      active = nextActive;
      configuredId = nextConfiguredId;
    },
  };
}
