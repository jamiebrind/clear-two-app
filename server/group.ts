import { delay } from '../src/delay.ts';
import type { GroupAction, GroupMember, GroupState } from '../src/rooms.ts';
import { localAddress, validUuid } from './setup.ts';
import type { SetupTransport } from './setup.ts';

type Member = GroupMember & { address: string };
type GroupSnapshot = { isGuest: boolean; members: Member[]; hostVolume?: number };

export class GroupConflict extends Error {}

function volumeValue(value: unknown): number | undefined {
  const digits = String(value);
  return /^\d{1,3}$/.test(digits) && Number(digits) <= 100 ? Number(digits) : undefined;
}

export function parseGroupAction(body: unknown): GroupAction | null {
  if (!body || typeof body !== 'object' || !('action' in body)) return null;
  if (body.action === 'ungroup') return { action: 'ungroup' };
  if (body.action === 'group-volume') {
    return 'volume' in body && typeof body.volume === 'number' && volumeValue(body.volume) !== undefined
      ? { action: 'group-volume', volume: body.volume } : null;
  }
  if (!('memberId' in body) || !validUuid(body.memberId)) return null;
  const memberId = body.memberId.toUpperCase();
  if (body.action === 'join' || body.action === 'remove') return { action: body.action, memberId };
  if (body.action === 'mute' && 'mute' in body && typeof body.mute === 'boolean') return { action: 'mute', memberId, mute: body.mute };
  if (body.action === 'volume' && 'volume' in body && typeof body.volume === 'number' && Number.isInteger(body.volume) && body.volume >= 0 && body.volume <= 100) {
    return { action: 'volume', memberId, volume: body.volume };
  }
  return null;
}

function parseMembers(response: string): Member[] {
  const reply = JSON.parse(response);
  const count = reply?.slaves;
  const reported = reply?.slave_list ?? (String(count) === '0' ? [] : null);
  if (!Array.isArray(reported) || String(reported.length) !== String(count)) throw new Error('The amplifier returned incomplete group data.');
  const members: Member[] = [];
  for (const row of reported) {
    if (!validUuid(row?.uuid) || !localAddress(row.ip) || members.some((member) => member.id === row.uuid.toUpperCase() || member.address === row.ip)) {
      throw new Error('The amplifier returned invalid group data.');
    }
    const mute = String(row.mute);
    members.push({
      id: row.uuid.toUpperCase(), address: row.ip,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Grouped speaker',
      volume: volumeValue(row.volume) ?? null,
      muted: mute === '1' ? true : mute === '0' ? false : null,
    });
  }
  return members;
}

function publicState({ members, ...state }: GroupSnapshot): GroupState {
  return { ...state, members: members.map(({ address: _address, ...member }) => member) };
}

export function createGroup(request: SetupTransport) {
  async function inspect(address: string): Promise<GroupSnapshot> {
    const player = JSON.parse(await request(address, 'getPlayerStatus'));
    if (String(player?.type) === '1' || String(player?.mode) === '99') return { isGuest: true, members: [] };
    const hostVolume = volumeValue(player?.vol);
    if (String(player?.type) !== '0' && !/^\d{1,2}$/.test(String(player?.mode))) throw new Error('The amplifier returned incomplete group data.');
    return { isGuest: false, members: parseMembers(await request(address, 'multiroom:getSlaveList')), ...(hostVolume === undefined ? {} : { hostVolume }) };
  }

  async function read(address: string): Promise<GroupState> {
    return publicState(await inspect(address));
  }

  async function confirm(host: string, matches: (snapshot: GroupSnapshot) => boolean): Promise<GroupSnapshot | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await delay(240 * attempt);
      const actual = await inspect(host).catch(() => null);
      if (actual && !actual.isGuest && matches(actual)) return actual;
    }
    return null;
  }

  async function groupVolume(host: string, before: GroupSnapshot, level: number): Promise<GroupState> {
    if (!before.members.length) throw new GroupConflict('Add another speaker to use group volume.');
    if (before.hostVolume === level && before.members.every((member) => member.volume === level)) return publicState(before);
    if (before.hostVolume !== level) {
      const reply = await request(host, `setPlayerCmd:vol:${level}`).catch(() => null);
      if (reply !== null && reply.trim() !== 'OK') throw new Error('The amplifier rejected the group volume change.');
    }
    const refreshed = await confirm(host, (actual) => actual.hostVolume === level);
    if (!refreshed) {
      throw new Error('Could not confirm host volume. Refresh the group before trying again.');
    }
    const originals = new Set(before.members.map(({ id }) => id));
    for (const member of refreshed.members) {
      if (originals.has(member.id) && member.volume !== level) {
        await request(host, `multiroom:SlaveVolume:${member.address}:${level}`).catch(() => null);
      }
    }
    const result = await confirm(host, (actual) => actual.hostVolume === level && actual.members.length === originals.size &&
      actual.members.every((member) => originals.has(member.id) && member.volume === level));
    if (!result) throw new Error('Could not confirm the volume in every room. Some rooms may have changed. Refresh to check.');
    return publicState(result);
  }

  async function change(host: string, change: GroupAction, joiningAddress?: string): Promise<GroupState> {
    const before = await inspect(host);
    if (before.isGuest) throw new GroupConflict('Select the host room to manage this group.');
    if (change.action === 'group-volume') return groupVolume(host, before, change.volume);
    const member = 'memberId' in change ? before.members.find((item) => item.id === change.memberId) : undefined;
    let command: string;
    let destination = host;
    let matches: (members: Member[]) => boolean;
    switch (change.action) {
      case 'join': {
        if (member) return publicState(before);
        if (!joiningAddress || host === joiningAddress) throw new GroupConflict('Choose a different speaker to join the group.');
        const guest = await inspect(joiningAddress);
        if (guest.isGuest || guest.members.length) throw new GroupConflict('Remove that speaker from its current group before moving it.');
        destination = joiningAddress;
        command = `ConnectMasterAp:JoinGroupMaster:eth${host}:wifi0.0.0.0`;
        matches = (members) => members.some((item) => item.id === change.memberId);
        break;
      }
      case 'remove':
        if (!member) return publicState(before);
        command = `multiroom:SlaveKickout:${member.address}`;
        matches = (members) => !members.some((item) => item.id === change.memberId);
        break;
      case 'ungroup':
        if (!before.members.length) return publicState(before);
        command = 'multiroom:Ungroup';
        matches = (members) => members.length === 0;
        break;
      default:
        if (!member) throw new GroupConflict('That speaker is no longer in this group.');
        if (change.action === 'volume') {
          if (member.volume === change.volume) return publicState(before);
          command = `multiroom:SlaveVolume:${member.address}:${change.volume}`;
          matches = (members) => members.some((item) => item.id === change.memberId && item.volume === change.volume);
        } else {
          if (member.muted === change.mute) return publicState(before);
          command = `multiroom:SlaveMute:${member.address}:${change.mute ? 1 : 0}`;
          matches = (members) => members.some((item) => item.id === change.memberId && item.muted === change.mute);
        }
    }

    // A network transition can close the connection before an acknowledgement. Do not repeat writes.
    const acknowledgement = await request(destination, command).catch(() => null);
    if (acknowledgement !== null && acknowledgement.trim() !== 'OK') throw new Error('The amplifier rejected the group change.');
    const result = await confirm(host, (actual) => matches(actual.members));
    if (result) return publicState(result);
    throw new Error('Could not confirm the group change. Refresh the group to see its current state.');
  }

  return { read, change };
}
