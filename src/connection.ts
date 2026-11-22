import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ToneBand } from './tone.ts';

export const nativePhone = Capacitor.isNativePlatform();
export const standaloneWeb = import.meta.env?.MODE === 'standalone';
export const directBrowser = !nativePhone && (standaloneWeb || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('direct')));
export const directConnection = nativePhone || directBrowser;
export const iosPhone = Capacitor.getPlatform() === 'ios';

export const speakerLan = registerPlugin<{
  discover(): Promise<{ addresses: string[] }>;
  request(options: { address: string; command: string }): Promise<{ response: string }>;
  joinHotspot(): Promise<void>;
  tone(options: { address: string; band: ToneBand; gain?: number }): Promise<{ gain: number }>;
  serveSweep(options: { address: string; wav: string }): Promise<{ url: string }>;
}>('SpeakerLan');
