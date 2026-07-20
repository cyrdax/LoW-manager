import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAppRoute, pathForRoute, routeForView } from '../web/src/app-routes.ts';

test('app routes parse top-level shareable pages', () => {
  assert.deepEqual(parseAppRoute('/'), { view: 'pilots' });
  assert.deepEqual(parseAppRoute('/pilots'), { view: 'pilots' });
  assert.deepEqual(parseAppRoute('/fleet'), { view: 'fleet' });
  assert.deepEqual(parseAppRoute('/assets'), { view: 'assets' });
  assert.deepEqual(parseAppRoute('/market'), { view: 'market' });
  assert.deepEqual(parseAppRoute('/contract'), { view: 'contracts' });
  assert.deepEqual(parseAppRoute('/contracts'), { view: 'contracts' });
  assert.deepEqual(parseAppRoute('/industry'), { view: 'industry' });
  assert.deepEqual(parseAppRoute('/planets'), { view: 'planets' });
});

test('app routes parse and format fit and doctrine deep links', () => {
  assert.deepEqual(parseAppRoute('/fits'), { view: 'fits', mode: 'fits' });
  assert.deepEqual(parseAppRoute('/fit/42'), { view: 'fits', mode: 'fits', fitId: 42 });
  assert.deepEqual(parseAppRoute('/doctrines'), { view: 'fits', mode: 'doctrines' });
  assert.deepEqual(parseAppRoute('/doctrine/7'), { view: 'fits', mode: 'doctrines', doctrineId: 7 });
  assert.deepEqual(parseAppRoute('/fit/nope'), { view: 'pilots' });

  assert.equal(pathForRoute({ view: 'fits', mode: 'fits', fitId: 42 }), '/fit/42');
  assert.equal(pathForRoute({ view: 'fits', mode: 'doctrines', doctrineId: 7 }), '/doctrine/7');
  assert.equal(pathForRoute({ view: 'fits', mode: 'doctrines' }), '/doctrines');
  assert.equal(pathForRoute(routeForView('assets')), '/assets');
});
