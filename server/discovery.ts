import { createSocket } from 'node:dgram';
import { hotspot, localAddress } from './setup.ts';

export async function discoverSpeakers(): Promise<string[]> {
  const socket = createSocket('udp4');
  const candidates = new Set<string>();
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(finish, 2400);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve([...candidates]);
    }
    socket.once('error', finish);
    socket.on('message', (_packet, sender) => {
      if (localAddress(sender.address) && sender.address !== hotspot && candidates.size < 24) candidates.add(sender.address);
    });
    socket.bind(0, () => {
      const query = [
        'M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 1',
        'ST: urn:schemas-upnp-org:device:MediaRenderer:1', '', '',
      ].join('\r\n');
      socket.send(query, 1900, '239.255.255.250');
    });
  });
}
