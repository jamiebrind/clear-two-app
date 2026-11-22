import { createDirectController } from './directController.ts';
import { nativePhone, speakerLan } from './connection.ts';
import { localAddress } from '../server/setup.ts';
import { createMobileSound } from './mobileSound.ts';

async function send(address: string, command: string): Promise<string> {
  if (!localAddress(address)) throw new Error('Enter a private IPv4 address on your network.');
  if (nativePhone) return (await speakerLan.request({ address, command })).response;
  const url = new URL(`http://${address}/httpapi.asp`);
  url.searchParams.set('command', command);
  try {
    const reply = await fetch(url, { cache: 'no-store', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(3000) });
    if (!reply.ok) throw new Error();
    return await reply.text();
  } catch {
    throw new Error('The browser could not read the speaker over Wi-Fi. Check its address, or use the Clear Two phone app for direct access.');
  }
}

export const requestDirect = createDirectController({
  send, storage: localStorage,
  discover: nativePhone ? async () => (await speakerLan.discover()).addresses : undefined,
  sound: nativePhone ? createMobileSound(send, speakerLan) : undefined,
});
