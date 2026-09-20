import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { createFitStore, migrateFitsDb } from './store.ts';

const naglfar = `[Naglfar, Store Test]
Republic Fleet Gyrostabilizer

Pithum C-Type Multispectrum Shield Hardener

Siege Module II

Capital Semiconductor Memory Cell I

Hail XL x10`;

function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFitsDb(db);
  return db;
}

describe('fit store', () => {
  it('migrates saved fit tables', () => {
    const db = memoryDb();
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('saved_fits', 'saved_fit_items')
      ORDER BY name
    `).all() as Array<{ name: string }>;
    assert.deepEqual(tables.map(t => t.name), ['saved_fit_items', 'saved_fits']);
  });

  it('creates, lists, and gets saved fits with parsed item rows', () => {
    const db = memoryDb();
    let now = 1000;
    const store = createFitStore(db, { now: () => now });

    const saved = store.create({ rawEft: naglfar, fitName: 'Manual Name', notes: 'Doctrine note' });
    assert.equal(saved.id, 1);
    assert.equal(saved.fitName, 'Manual Name');
    assert.equal(saved.ship?.name, 'Naglfar');
    assert.equal(saved.notes, 'Doctrine note');
    assert.equal(saved.items.some(item => item.inputName === 'Hail XL'), true);

    const list = store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].fitName, 'Manual Name');
    assert.equal(list[0].warningCounts.unmatched, 0);

    const loaded = store.get(saved.id);
    assert.equal(loaded?.sections.high.items[0].inputName, 'Siege Module II');
  });

  it('updates names notes raw content and ship overrides', () => {
    const db = memoryDb();
    let now = 1000;
    const store = createFitStore(db, { now: () => now });
    const saved = store.create({ rawEft: naglfar });

    now = 2000;
    const renamed = store.update(saved.id, { fitName: 'Renamed', notes: 'Updated' });
    assert.equal(renamed?.fitName, 'Renamed');
    assert.equal(renamed?.notes, 'Updated');
    assert.equal(renamed?.updatedAt, 2000);
    assert.equal(renamed?.items.length, saved.items.length);

    now = 3000;
    const reparsed = store.update(saved.id, {
      rawEft: `[Archon, Carrier]\nDrone Damage Amplifier II`,
      shipTypeId: 23757,
    });
    assert.equal(reparsed?.ship?.name, 'Archon');
    assert.equal(reparsed?.sections.low.items[0].inputName, 'Drone Damage Amplifier II');
  });

  it('deletes saved fits and cascades item rows', () => {
    const db = memoryDb();
    const store = createFitStore(db);
    const saved = store.create({ rawEft: naglfar });
    assert.equal(store.delete(saved.id), true);
    assert.equal(store.get(saved.id), null);
    const itemRows = db.prepare('SELECT COUNT(*) AS count FROM saved_fit_items').get() as { count: number };
    assert.equal(itemRows.count, 0);
  });

  it('filters private and public fits and copies public fits into a user library', () => {
    const db = memoryDb();
    const store = createFitStore(db, { now: () => 1000 });

    const privateFit = store.create({ rawEft: naglfar, fitName: 'Private Dread', ownerUserId: 'user-a', visibility: 'private' });
    const publicFit = store.create({ rawEft: naglfar, fitName: 'Public Dread', ownerUserId: 'user-a', visibility: 'public' });
    store.create({ rawEft: naglfar, fitName: 'Other Private', ownerUserId: 'user-b', visibility: 'private' });

    assert.deepEqual(store.list({ visibility: 'private', ownerUserId: 'user-a' }).map(fit => fit.id), [privateFit.id]);
    assert.deepEqual(store.list({ visibility: 'public' }).map(fit => fit.id), [publicFit.id]);

    const copied = store.copyToPrivate(publicFit.id, 'user-b');
    assert.equal(copied?.ownerUserId, 'user-b');
    assert.equal(copied?.visibility, 'private');
    assert.equal(copied?.sourcePublicFitId, publicFit.id);
    assert.equal(copied?.fitName, 'Public Dread');
  });

  it('publishes fits without changing ownership', () => {
    const db = memoryDb();
    const store = createFitStore(db, { now: () => 1000 });
    const saved = store.create({ rawEft: naglfar, fitName: 'Publish Me', ownerUserId: 'user-a' });

    const published = store.publish(saved.id);
    assert.equal(published?.ownerUserId, 'user-a');
    assert.equal(published?.visibility, 'public');
  });
});
