import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRooms } from '../server/rooms.ts';

const first = { uuid: 'FF31F09E8AFCEBECAF8BF24F', name: 'Living Room' };
const second = { uuid: 'EC32F09E8AFCEBECAF8BF24F', name: 'Office' };

test('migrates a configured speaker and keeps rooms distinct as IP addresses change', () => {
  const rooms = createRooms({ address: '192.168.1.10' }, '', () => {});
  assert.equal(rooms.get()?.address, '192.168.1.10');
  rooms.remember([{ ...first, address: '192.168.1.10' }], first.uuid);
  rooms.remember([{ ...second, address: '192.168.1.11' }], second.uuid);
  rooms.remember([{ ...first, address: '192.168.1.12' }]);
  assert.deepEqual(rooms.list(), [{ id: first.uuid, name: first.name }, { id: second.uuid, name: second.name }]);
  assert.equal(rooms.get(first.uuid)?.address, '192.168.1.12');
  assert.equal(rooms.get()?.id, second.uuid);
});

test('does not replace current rooms when persistence fails', () => {
  const rooms = createRooms(null, '', () => { throw new Error('Disk full'); });
  assert.throws(() => rooms.remember([{ ...first, address: '192.168.1.10' }], first.uuid), /disk full/i);
  assert.deepEqual(rooms.list(), []);
});

test('keeps an address-only room across restart when another room is added first', () => {
  let saved: unknown = { address: '192.168.1.10' };
  const rooms = createRooms(saved, '', (value) => { saved = value; });
  rooms.remember([{ ...second, address: '192.168.1.11' }], second.uuid);
  const reloaded = createRooms(saved, '', () => {});
  assert.equal(reloaded.get('configured')?.address, '192.168.1.10');
  assert.equal(reloaded.get()?.id, second.uuid);
  reloaded.remember([{ ...first, address: '192.168.1.10' }]);
  assert.equal(reloaded.get('configured')?.id, first.uuid);
});
