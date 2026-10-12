import assert from 'node:assert/strict';
import test from 'node:test';
import { searchContracts, searchJumpCapableContracts } from '../web/src/api.ts';

test('ship contract search sends selected JDC level and cyno jump limit', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl = '';
  globalThis.fetch = async input => {
    requestedUrl = String(input);
    return Response.json({});
  };
  const params = {
    shipId: 23757,
    originSystemId: 30000142,
    jdcLevel: 3,
    maxCynoJumps: 4,
  };

  await searchContracts(params);

  assert.equal(requestedUrl, '/api/contracts/search?shipId=23757&originSystemId=30000142&jdcLevel=3&maxCynoJumps=4');
});

test('any-cap contract search sends selected JDC level and cyno jump limit', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl = '';
  globalThis.fetch = async input => {
    requestedUrl = String(input);
    return Response.json({});
  };
  const params = {
    originSystemId: 30000142,
    jdcLevel: 2,
    maxCynoJumps: 5,
  };

  await searchJumpCapableContracts(params);

  assert.equal(requestedUrl, '/api/contracts/search/jump-capable?originSystemId=30000142&jdcLevel=2&maxCynoJumps=5');
});
