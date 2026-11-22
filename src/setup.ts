export interface SetupSpeaker { name: string; uuid: string }
export interface SetupNetwork { ssid: string; channel: number; security: 'WPA2' | 'Open' }
export interface SetupScan { speaker: SetupSpeaker; networks: SetupNetwork[] }
export interface SetupJoin { uuid: string; ssid: string; channel: number; password: string }
export interface SetupProgress {
  status: 'joining' | 'joined' | 'bad-password' | 'failed' | 'hotspot-unavailable';
  address?: string;
}
