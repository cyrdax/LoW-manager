import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateFitsDb, createFitStore } from './store.ts';
import { createDoctrineStore, migrateDoctrinesDb } from './doctrines.ts';

const naglfar = `[Naglfar, Dread DPS]
Republic Fleet Gyrostabilizer
Siege Module II`;

const archon = `[Archon, Cheap Drones]
Drone Damage Amplifier II
Capital I-a Enduring Armor Repairer`;

function stores() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFitsDb(db);
  migrateDoctrinesDb(db);
  return {
    db,
    fits: createFitStore(db, { now: () => 1000 }),
    doctrines: createDoctrineStore(db, { now: () => 2000 }),
  };
}

test('migrateDoctrinesDb creates doctrine tables and indexes', () => {
  const { db } = stores();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('doctrines', 'doctrine_fits') ORDER BY name").all() as Array<{ name: string }>;
  assert.deepEqual(tables.map(row => row.name), ['doctrine_fits', 'doctrines']);

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_doctrines_updated', 'idx_doctrine_fits_doctrine', 'idx_doctrine_fits_fit') ORDER BY name").all() as Array<{ name: string }>;
  assert.deepEqual(indexes.map(row => row.name), ['idx_doctrine_fits_doctrine', 'idx_doctrine_fits_fit', 'idx_doctrines_updated']);
});

test('doctrine store creates updates deletes and preserves saved fits', () => {
  const { db, fits, doctrines } = stores();
  const fit = fits.create({ rawEft: naglfar, fitName: 'Dread DPS' });
  const doctrine = doctrines.create({ name: 'Armor Dread Bomb', description: 'Dreads with carrier support.' });

  const withFit = doctrines.addFit(doctrine.id, fit.id)!;
  assert.equal(withFit.fitCount, 1);
  assert.equal(withFit.fits[0].fitName, 'Dread DPS');
  assert.equal(withFit.fits[0].sortOrder, 1);

  const duplicate = doctrines.addFit(doctrine.id, fit.id)!;
  assert.equal(duplicate.fitCount, 1);
  assert.equal(duplicate.fits[0].sortOrder, 1);

  const updated = doctrines.update(doctrine.id, { name: 'Updated Bomb', description: 'Updated description.' })!;
  assert.equal(updated.name, 'Updated Bomb');
  assert.equal(updated.description, 'Updated description.');

  assert.equal(doctrines.delete(doctrine.id), true);
  assert.equal(fits.get(fit.id)?.fitName, 'Dread DPS');
  const linkCount = db.prepare('SELECT count(*) AS count FROM doctrine_fits').get() as { count: number };
  assert.equal(linkCount.count, 0);
});

test('deleting a saved fit cascades out of doctrine membership', () => {
  const { fits, doctrines } = stores();
  const fit = fits.create({ rawEft: archon, fitName: 'Carrier Support' });
  const doctrine = doctrines.create({ name: 'Carrier Wing' });
  doctrines.addFit(doctrine.id, fit.id);

  assert.equal(doctrines.get(doctrine.id)?.fitCount, 1);
  fits.delete(fit.id);
  assert.equal(doctrines.get(doctrine.id)?.fitCount, 0);
});

test('doctrine search matches name description member ship and member fit name', () => {
  const { fits, doctrines } = stores();
  const dread = fits.create({ rawEft: naglfar, fitName: 'Dread DPS' });
  const carrier = fits.create({ rawEft: archon, fitName: 'Carrier Support' });
  const armor = doctrines.create({ name: 'Armor Dread Bomb', description: 'Escalation comp' });
  const triage = doctrines.create({ name: 'Slowcat Support', description: 'Capital reps' });
  doctrines.addFit(armor.id, dread.id);
  doctrines.addFit(triage.id, carrier.id);

  assert.deepEqual(doctrines.list('bomb').map(row => row.id), [armor.id]);
  assert.deepEqual(doctrines.list('escalation').map(row => row.id), [armor.id]);
  assert.deepEqual(doctrines.list('naglfar').map(row => row.id), [armor.id]);
  assert.deepEqual(doctrines.list('carrier support').map(row => row.id), [triage.id]);
});

test('removeFit leaves doctrine intact when member is absent', () => {
  const { fits, doctrines } = stores();
  const fit = fits.create({ rawEft: naglfar });
  const doctrine = doctrines.create({ name: 'Empty Doctrine' });

  const result = doctrines.removeFit(doctrine.id, fit.id)!;
  assert.equal(result.id, doctrine.id);
  assert.equal(result.fitCount, 0);
});
