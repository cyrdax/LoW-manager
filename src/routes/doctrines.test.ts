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
  registerDoctrineRoutes(app, { store });
  return { app, fits, store };
}

test('doctrine CRUD routes create list get update and delete', async () => {
  const { app } = appWithStores();

  const created = await app.inject({ method: 'POST', url: '/api/doctrines', payload: { name: 'Armor Bomb', description: 'Dread comp' } });
  assert.equal(created.statusCode, 200);
  const doctrine = JSON.parse(created.body);
  assert.equal(doctrine.name, 'Armor Bomb');

  const list = await app.inject({ method: 'GET', url: '/api/doctrines?q=dread' });
  assert.equal(JSON.parse(list.body)[0].id, doctrine.id);

  const got = await app.inject({ method: 'GET', url: `/api/doctrines/${doctrine.id}` });
  assert.equal(JSON.parse(got.body).description, 'Dread comp');

  const updated = await app.inject({ method: 'PUT', url: `/api/doctrines/${doctrine.id}`, payload: { name: 'Updated Bomb', description: 'Updated' } });
  assert.equal(JSON.parse(updated.body).name, 'Updated Bomb');

  const deleted = await app.inject({ method: 'DELETE', url: `/api/doctrines/${doctrine.id}` });
  assert.equal(deleted.statusCode, 200);
  assert.equal(JSON.parse(deleted.body).ok, true);
});

test('doctrine routes add and remove saved fits', async () => {
  const { app, fits } = appWithStores();
  const fit = fits.create({ rawEft: naglfar, fitName: 'Route Dread DPS' });
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
