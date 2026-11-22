export interface RoomSummary { id: string; name: string }

export interface GroupMember extends RoomSummary {
  volume: number | null;
  muted: boolean | null;
}

export interface GroupState { isGuest: boolean; members: GroupMember[]; hostVolume?: number }

export type GroupAction =
  | { action: 'join' | 'remove'; memberId: string }
  | { action: 'volume'; memberId: string; volume: number }
  | { action: 'mute'; memberId: string; mute: boolean }
  | { action: 'group-volume'; volume: number }
  | { action: 'ungroup' };
