import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { createFitStore, migrateFitsDb } from '../fits/store.ts';
import { createDoctrineStore, migrateDoctrinesDb } from '../fits/doctrines.ts';
import { registerDoctrineRoutes } from './doctrines.ts';

const naglfar = `[Naglfar, Route Dread]
Republic Fleet Gyrostabilizer
Siege Module II`;

function appWithStores() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFitsDb(db);
  migrateDoctrinesDb(db);
  const fits = createFitStore(db);
  const store = createDoctrineStore(db);
  const app = Fastify();
  registerDoctrineRoutes(app, { store, fitStore: fits, currentUser: async () => userA });
  return { app, fits, store };
}

const userA = { id: 'user-a', email: null, role: 'user' as const, status: 'active' as const };
const userB = { id: 'user-b', email: null, role: 'user' as const, status: 'active' as const };

test('doctrine CRUD routes create list get update and delete', async () => {
  const { app } = appWithStores();

  const created = await app.inject({
    method: 'POST',
    url: '/api/doctrines',
    payload: {
      name: 'Armor Bomb',
      description: 'Dread comp',
      googleDocUrl: 'https://docs.google.com/document/d/abc123/edit',
    },
  });
  assert.equal(created.statusCode, 200);
  const doctrine = JSON.parse(created.body);
  assert.equal(doctrine.name, 'Armor Bomb');
  assert.equal(doctrine.googleDocUrl, 'https://docs.google.com/document/d/abc123/edit');

  const list = await app.inject({ method: 'GET', url: '/api/doctrines?q=dread' });
  assert.equal(JSON.parse(list.body)[0].id, doctrine.id);

  const got = await app.inject({ method: 'GET', url: `/api/doctrines/${doctrine.id}` });
  assert.equal(JSON.parse(got.body).description, 'Dread comp');

  const updated = await app.inject({
    method: 'PUT',
    url: `/api/doctrines/${doctrine.id}`,
    payload: {
      name: 'Updated Bomb',
      description: 'Updated',
      googleDocUrl: 'https://docs.google.com/document/d/updated456/edit',
    },
  });
  const updatedBody = JSON.parse(updated.body);
  assert.equal(updatedBody.name, 'Updated Bomb');
  assert.equal(updatedBody.googleDocUrl, 'https://docs.google.com/document/d/updated456/edit');

  const deleted = await app.inject({ method: 'DELETE', url: `/api/doctrines/${doctrine.id}` });
  assert.equal(deleted.statusCode, 200);
  assert.equal(JSON.parse(deleted.body).ok, true);
});

test('doctrine routes add and remove saved fits', async () => {
  const { app, fits } = appWithStores();
  const fit = fits.create({ rawEft: naglfar, fitName: 'Route Dread DPS', ownerUserId: 'user-a', visibility: 'private' });
  const created = await app.inject({ method: 'POST', url: '/api/doctrines', payload: { name: 'Route Doctrine' } });
  const doctrine = JSON.parse(created.body);

  const added = await app.inject({ method: 'POST', url: `/api/doctrines/${doctrine.id}/fits`, payload: { fitId: fit.id } });
  assert.equal(added.statusCode, 200);
  assert.equal(JSON.parse(added.body).fits[0].fitName, 'Route Dread DPS');

  const duplicate = await app.inject({ method: 'POST', url: `/api/doctrines/${doctrine.id}/fits`, payload: { fitId: fit.id } });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(JSON.parse(duplicate.body).fitCount, 1);

  const removed = await app.inject({ method: 'DELETE', url: `/api/doctrines/${doctrine.id}/fits/${fit.id}` });
  assert.equal(removed.statusCode, 200);
  assert.equal(JSON.parse(removed.body).fitCount, 0);
});

test('doctrine routes validate blank names invalid ids missing doctrine and missing fit', async () => {
  const { app } = appWithStores();

  const blank = await app.inject({ method: 'POST', url: '/api/doctrines', payload: { name: '   ' } });
  assert.equal(blank.statusCode, 400);

  const invalid = await app.inject({ method: 'GET', url: '/api/doctrines/nope' });
  assert.equal(invalid.statusCode, 400);

  const missingDoctrine = await app.inject({ method: 'GET', url: '/api/doctrines/99999' });
  assert.equal(missingDoctrine.statusCode, 404);

  const created = await app.inject({ method: 'POST', url: '/api/doctrines', payload: { name: 'Missing Fit Test' } });
  const doctrine = JSON.parse(created.body);
  const missingFit = await app.inject({ method: 'POST', url: `/api/doctrines/${doctrine.id}/fits`, payload: { fitId: 99999 } });
  assert.equal(missingFit.statusCode, 404);
});

test('doctrine routes scope private libraries and copy public doctrines privately', async () => {
  const { fits, store } = appWithStores();
  const publicFit = fits.create({ rawEft: naglfar, fitName: 'Public Fit', ownerUserId: 'user-a', visibility: 'public' });
  const privateDoctrine = store.create({ name: 'Private A', ownerUserId: 'user-a', visibility: 'private' });
  const publicDoctrine = store.create({ name: 'Public A', ownerUserId: 'user-a', visibility: 'public' });
  store.addFit(publicDoctrine.id, publicFit.id);
  store.create({ name: 'Private B', ownerUserId: 'user-b', visibility: 'private' });

  const appA = Fastify();
  registerDoctrineRoutes(appA, { store, fitStore: fits, currentUser: async () => userA });
  const privateList = await appA.inject({ method: 'GET', url: '/api/doctrines?visibility=private' });
  assert.deepEqual(JSON.parse(privateList.body).map((doctrine: { id: number }) => doctrine.id), [privateDoctrine.id]);

  const publicList = await appA.inject({ method: 'GET', url: '/api/doctrines?visibility=public' });
  assert.deepEqual(JSON.parse(publicList.body).map((doctrine: { id: number }) => doctrine.id), [publicDoctrine.id]);

  const appB = Fastify();
  registerDoctrineRoutes(appB, { store, fitStore: fits, currentUser: async () => userB });
  const denied = await appB.inject({
    method: 'PUT',
    url: `/api/doctrines/${publicDoctrine.id}`,
    payload: { name: 'Hijacked' },
  });
  assert.equal(denied.statusCode, 403);

  const copied = await appB.inject({ method: 'POST', url: `/api/doctrines/${publicDoctrine.id}/copy-private` });
  assert.equal(copied.statusCode, 200);
  const body = JSON.parse(copied.body);
  assert.equal(body.ownerUserId, 'user-b');
  assert.equal(body.visibility, 'private');
  assert.equal(body.sourcePublicDoctrineId, publicDoctrine.id);
  assert.equal(body.fits[0].ownerUserId, 'user-b');
});

test('doctrine routes filter visible doctrines by exact member fit id', async () => {
  const { fits, store } = appWithStores();
  const userAPrivateFit = fits.create({ rawEft: naglfar, fitName: 'Private A', ownerUserId: 'user-a', visibility: 'private' });
  const userAPublicFit = fits.create({ rawEft: naglfar, fitName: 'Public A', ownerUserId: 'user-a', visibility: 'public' });
  const userBPrivateFit = fits.create({ rawEft: naglfar, fitName: 'Private B', ownerUserId: 'user-b', visibility: 'private' });
  const privateA = store.create({ name: 'Private A Doctrine', ownerUserId: 'user-a', visibility: 'private' });
  const publicA = store.create({ name: 'Public A Doctrine', ownerUserId: 'user-a', visibility: 'public' });
  const privateB = store.create({ name: 'Private B Doctrine', ownerUserId: 'user-b', visibility: 'private' });
  store.addFit(privateA.id, userAPrivateFit.id);
  store.addFit(publicA.id, userAPublicFit.id);
  store.addFit(privateB.id, userBPrivateFit.id);

  const appA = Fastify();
  registerDoctrineRoutes(appA, { store, fitStore: fits, currentUser: async () => userA });
  const privateList = await appA.inject({ method: 'GET', url: `/api/doctrines?visibility=private&fitId=${userAPrivateFit.id}` });
  assert.deepEqual(JSON.parse(privateList.body).map((doctrine: { id: number }) => doctrine.id), [privateA.id]);

  const hiddenPrivate = await appA.inject({ method: 'GET', url: `/api/doctrines?visibility=private&fitId=${userBPrivateFit.id}` });
  assert.deepEqual(JSON.parse(hiddenPrivate.body), []);

  const publicList = await appA.inject({ method: 'GET', url: `/api/doctrines?visibility=public&fitId=${userAPublicFit.id}` });
  assert.deepEqual(JSON.parse(publicList.body).map((doctrine: { id: number }) => doctrine.id), [publicA.id]);

  const invalidFitId = await appA.inject({ method: 'GET', url: '/api/doctrines?fitId=nope' });
  assert.equal(invalidFitId.statusCode, 400);
});

test('doctrine routes publish only owner doctrines with public member fits', async () => {
  const { fits, store } = appWithStores();
  const privateFit = fits.create({ rawEft: naglfar, fitName: 'Private Fit', ownerUserId: 'user-a', visibility: 'private' });
  const doctrine = store.create({ name: 'Needs Public Fits', ownerUserId: 'user-a', visibility: 'private' });
  store.addFit(doctrine.id, privateFit.id);

  const appA = Fastify();
  registerDoctrineRoutes(appA, { store, fitStore: fits, currentUser: async () => userA });
  const blocked = await appA.inject({ method: 'POST', url: `/api/doctrines/${doctrine.id}/publish` });
  assert.equal(blocked.statusCode, 400);

  fits.publish(privateFit.id);
  const published = await appA.inject({ method: 'POST', url: `/api/doctrines/${doctrine.id}/publish` });
  assert.equal(published.statusCode, 200);
  assert.equal(JSON.parse(published.body).visibility, 'public');
});

test('doctrine routes reject member fits the user cannot view', async () => {
  const { fits, store } = appWithStores();
  const userAFit = fits.create({ rawEft: naglfar, fitName: 'Private A', ownerUserId: 'user-a', visibility: 'private' });
  const userBDoctrine = store.create({ name: 'User B Doctrine', ownerUserId: 'user-b', visibility: 'private' });

  const appB = Fastify();
  registerDoctrineRoutes(appB, { store, fitStore: fits, currentUser: async () => userB });
  const denied = await appB.inject({
    method: 'POST',
    url: `/api/doctrines/${userBDoctrine.id}/fits`,
    payload: { fitId: userAFit.id },
  });

  assert.equal(denied.statusCode, 403);
  assert.equal(store.get(userBDoctrine.id)?.fitCount, 0);
});

test('doctrine routes reject private member fits in public doctrines', async () => {
  const { app, fits } = appWithStores();
  const privateFit = fits.create({ rawEft: naglfar, fitName: 'Private Member', ownerUserId: 'user-a', visibility: 'private' });
  const created = await app.inject({
    method: 'POST',
    url: '/api/doctrines',
    payload: { name: 'Public Shell', visibility: 'public' },
  });
  const doctrine = JSON.parse(created.body);

  const rejected = await app.inject({
    method: 'POST',
    url: `/api/doctrines/${doctrine.id}/fits`,
    payload: { fitId: privateFit.id },
  });

  assert.equal(rejected.statusCode, 400);
});
