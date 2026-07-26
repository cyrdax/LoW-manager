import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createDoctrineStore, migrateDoctrinesDb } from './doctrines.ts';
import {
  extractEftBlocksFromText,
  extractGoogleDocTabs,
  googleDocApiUrl,
  googleDocTextExportUrl,
  syncDoctrineFitsFromTabs,
  syncDoctrineFitsFromText,
} from './google-doc-sync.ts';
import { createFitStore, migrateFitsDb } from './store.ts';

const oldNaglfar = `[Naglfar, Dread DPS]
Republic Fleet Gyrostabilizer

Siege Module II

Hail XL x10`;

const newNaglfar = `[Naglfar, Dread DPS]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer

Siege Module II

Hail XL x20`;

const archon = `[Archon, Carrier Support]
Drone Damage Amplifier II

Capital Cap Battery II

Equite II x12`;

const thanatos = `[Thanatos, Carrier Support]
Drone Damage Amplifier II

Capital Cap Battery II

Equite II x12`;

function stores() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFitsDb(db);
  migrateDoctrinesDb(db);
  return {
    db,
    fits: createFitStore(db, { now: () => 1000 }),
    doctrines: createDoctrineStore(db, { now: () => 1000 }),
  };
}

test('google doc fit sync extracts EFT blocks from mixed prose', () => {
  const blocks = extractEftBlocksFromText(`Intro text

${newNaglfar}

Some notes between fits.

${archon}`);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].shipName, 'Naglfar');
  assert.equal(blocks[0].fitName, 'Dread DPS');
  assert.equal(blocks[0].rawEft.includes('Hail XL x20'), true);
  assert.equal(blocks[1].shipName, 'Archon');
  assert.equal(blocks[1].fitName, 'Carrier Support');
});

test('google doc fit sync extracts text from every Google Doc tab', () => {
  const tabs = extractGoogleDocTabs({
    tabs: [
      {
        tabProperties: { tabId: 't.dreads', title: 'Dreads', index: 1 },
        documentTab: {
          body: {
            content: [
              { paragraph: { elements: [{ textRun: { content: `${newNaglfar}\n` } }] } },
            ],
          },
        },
      },
      {
        tabProperties: { tabId: 't.support', title: 'Support', index: 2 },
        childTabs: [
          {
            tabProperties: { tabId: 't.carriers', title: 'Carriers', index: 1 },
            documentTab: {
              body: {
                content: [
                  { paragraph: { elements: [{ textRun: { content: `${archon}\n` } }] } },
                ],
              },
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(tabs.map(tab => [tab.id, tab.title, tab.sortOrder]), [
    ['t.dreads', 'Dreads', 1],
    ['t.carriers', 'Carriers', 2001],
  ]);
  assert.equal(tabs[0].text.includes('[Naglfar, Dread DPS]'), true);
  assert.equal(tabs[1].text.includes('[Archon, Carrier Support]'), true);
});

test('google doc fit sync builds public Google Docs text export URLs', () => {
  assert.equal(
    googleDocTextExportUrl('https://docs.google.com/document/d/doc_123-ABC/edit?tab=t.0#heading=h.x'),
    'https://docs.google.com/document/d/doc_123-ABC/export?format=txt',
  );
  assert.equal(googleDocTextExportUrl('https://example.com/document/d/doc_123/edit'), null);
  assert.equal(
    googleDocApiUrl('https://docs.google.com/document/d/doc_123-ABC/edit?tab=t.0#heading=h.x', 'key-1'),
    'https://docs.googleapis.com/v1/documents/doc_123-ABC?includeTabsContent=true&key=key-1',
  );
});

test('google doc fit sync updates matching doctrine fits and keeps absent fits', async () => {
  const { fits, doctrines } = stores();
  const dread = fits.create({ rawEft: oldNaglfar, fitName: 'Dread DPS', ownerUserId: 'user-a', visibility: 'private' });
  const carrier = fits.create({ rawEft: archon, fitName: 'Carrier Support', ownerUserId: 'user-a', visibility: 'private' });
  const doctrine = doctrines.create({ name: 'Caps', ownerUserId: 'user-a', visibility: 'private' });
  doctrines.addFit(doctrine.id, dread.id);
  doctrines.addFit(doctrine.id, carrier.id);

  const result = await syncDoctrineFitsFromText({
    doctrine: doctrines.get(doctrine.id)!,
    fitStore: fits,
    doctrineStore: doctrines,
    rawText: newNaglfar,
    ownerUserId: 'user-a',
  });

  assert.deepEqual(result.updated.map(fit => fit.fitId), [dread.id]);
  assert.deepEqual(result.created, []);
  assert.equal(fits.get(dread.id)?.rawEft.includes('Hail XL x20'), true);
  assert.deepEqual(result.doctrine.fits.map(fit => fit.id), [dread.id, carrier.id]);
});

test('google doc fit sync creates missing fits and adds them to the doctrine', async () => {
  const { fits, doctrines } = stores();
  const doctrine = doctrines.create({ name: 'Caps', ownerUserId: 'user-a', visibility: 'private' });

  const result = await syncDoctrineFitsFromText({
    doctrine,
    fitStore: fits,
    doctrineStore: doctrines,
    rawText: archon,
    ownerUserId: 'user-a',
  });

  assert.equal(result.updated.length, 0);
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].fitName, 'Carrier Support');
  const created = fits.get(result.created[0].fitId);
  assert.equal(created?.ownerUserId, 'user-a');
  assert.equal(created?.visibility, 'private');
  assert.deepEqual(result.doctrine.fits.map(fit => fit.id), [result.created[0].fitId]);
});

test('google doc tab sync replaces doctrine tab memberships from document source of truth', async () => {
  const { fits, doctrines } = stores();
  const oldDread = fits.create({ rawEft: oldNaglfar, fitName: 'Dread DPS', ownerUserId: 'user-a', visibility: 'private' });
  const oldCarrier = fits.create({ rawEft: archon, fitName: 'Carrier Support', ownerUserId: 'user-a', visibility: 'private' });
  const removed = fits.create({ rawEft: thanatos, fitName: 'Removed Fit', ownerUserId: 'user-a', visibility: 'private' });
  const doctrine = doctrines.create({ name: 'Caps', ownerUserId: 'user-a', visibility: 'private' });
  doctrines.addFit(doctrine.id, oldDread.id, { tabId: 't.dreads', tabTitle: 'Dreads' });
  doctrines.addFit(doctrine.id, oldCarrier.id, { tabId: 't.carriers', tabTitle: 'Carriers' });
  doctrines.addFit(doctrine.id, removed.id, { tabId: 't.carriers', tabTitle: 'Carriers' });

  const result = await syncDoctrineFitsFromTabs({
    doctrine: doctrines.get(doctrine.id)!,
    fitStore: fits,
    doctrineStore: doctrines,
    tabs: [
      { id: 't.dreads', title: 'Dreads', sortOrder: 1, text: newNaglfar },
      { id: 't.carriers', title: 'Carriers', sortOrder: 2, text: thanatos },
    ],
    ownerUserId: 'user-a',
  });

  assert.deepEqual(result.updated.map(fit => fit.fitId), [oldDread.id, oldCarrier.id]);
  assert.deepEqual(result.created, []);
  assert.equal(fits.get(oldDread.id)?.rawEft.includes('Hail XL x20'), true);
  assert.equal(fits.get(oldCarrier.id)?.headerShipName, 'Thanatos');
  assert.deepEqual(result.doctrine.fits.map(fit => [fit.fitName, fit.googleDocTabId]), [
    ['Dread DPS', 't.dreads'],
    ['Carrier Support', 't.carriers'],
  ]);
});

test('google doc fit sync skips ambiguous doctrine fit names', async () => {
  const { fits, doctrines } = stores();
  const archonFit = fits.create({ rawEft: archon, fitName: 'Carrier Support', ownerUserId: 'user-a', visibility: 'private' });
  const thanatosFit = fits.create({ rawEft: thanatos, fitName: 'Carrier Support', ownerUserId: 'user-a', visibility: 'private' });
  const doctrine = doctrines.create({ name: 'Caps', ownerUserId: 'user-a', visibility: 'private' });
  doctrines.addFit(doctrine.id, archonFit.id);
  doctrines.addFit(doctrine.id, thanatosFit.id);

  const result = await syncDoctrineFitsFromText({
    doctrine: doctrines.get(doctrine.id)!,
    fitStore: fits,
    doctrineStore: doctrines,
    rawText: archon.replace('Equite II x12', 'Equite II x9'),
    ownerUserId: 'user-a',
  });

  assert.deepEqual(result.updated, []);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.ambiguous, [{ fitName: 'Carrier Support', matchedFitIds: [archonFit.id, thanatosFit.id] }]);
  assert.equal(fits.get(archonFit.id)?.rawEft.includes('Equite II x12'), true);
});
