import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestJson } from '../src/client.ts';

test('preserves actionable device errors and explains an unreadable bridge response', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Select the host room.' }, { status: 409 }));
  await assert.rejects(requestJson('/api/example'), /Select the host room/);
  fetch.mock.mockImplementation(async () => new Response('<html></html>'));
  await assert.rejects(requestJson('/api/example'), /unreadable response/);
});

test('a lost bridge connection is reported without replaying a command', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(requestJson('/api/example', { mute: true }), /Could not reach the Clear Two bridge/);
  assert.equal(fetch.mock.callCount(), 1);
});
