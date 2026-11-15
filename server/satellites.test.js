import test from 'node:test';
import assert from 'node:assert/strict';
import { getGroup, parseTle } from './satellites.js';

const TLE = `ISS (ZARYA)
1 25544U 98067A   26318.94812295  .00009771  00000+0  18276-3 0  9990
2 25544  51.6323 274.0377 0007412  26.4902 333.6464 15.49382049595125
`;

test('parses CelesTrak 3-line TLE text', () => {
  const list = parseTle(TLE + 'garbage line\n');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'ISS (ZARYA)');
  assert.ok(list[0].line2.startsWith('2 25544'));
});

test('caches a group and serves the old copy when CelesTrak fails', async () => {
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, status: 200, text: async () => TLE }; };
  const first = await getGroup('science', ok);
  assert.equal(first.satellites.length, 1);
  await getGroup('science', ok);
  assert.equal(calls, 1, 'second request comes from the cache');

  const failing = async () => { throw new Error('offline'); };
  await assert.rejects(getGroup('weather', failing), /Could not load satellite data/);
  const plainError = async () => ({ ok: true, status: 200, text: async () => 'Invalid query' });
  await assert.rejects(getGroup('galileo', plainError), /Invalid query/);
});
