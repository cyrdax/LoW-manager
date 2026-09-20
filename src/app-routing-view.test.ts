import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('app syncs top-level views and browser history with shareable URLs', () => {
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const controlPanel = readFileSync(resolve('web/src/components/ControlPanel.tsx'), 'utf8');

  assert.match(app, /parseAppRoute\(window\.location\.pathname\)/);
  assert.match(app, /window\.addEventListener\('popstate'/);
  assert.match(app, /window\.history\.pushState/);
  assert.match(app, /pathForRoute/);
  assert.match(app, /routeForView/);
  assert.match(app, /!window\.location\.pathname\.startsWith\('\/auth'\)/);
  assert.match(app, /route=\{route\}/);
  assert.match(app, /setView=\{navigateToView\}/);
  assert.match(controlPanel, /setView: \(v: View\) => void/);
});

test('fits and doctrines expose deep-link route targets and update URLs from clicks', () => {
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const doctrinesView = readFileSync(resolve('web/src/components/DoctrinesView.tsx'), 'utf8');

  assert.match(app, /route\.view === 'fits' && route\.fitId != null \? route\.fitId : null/);
  assert.match(app, /route\.view === 'fits' && route\.doctrineId != null \? route\.doctrineId : null/);
  assert.match(app, /onOpenFitRoute=\{\(id\) => navigateToRoute\(\{ view: 'fits', mode: 'fits', fitId: id \}\)\}/);
  assert.match(app, /onOpenDoctrineRoute=\{\(id\) => navigateToRoute\(\{ view: 'fits', mode: 'doctrines', doctrineId: id \}\)\}/);

  assert.match(fitsView, /routeFitId: number \| null/);
  assert.match(fitsView, /routeDoctrineId: number \| null/);
  assert.match(fitsView, /onOpenFitRoute: \(id: number\) => void/);
  assert.match(fitsView, /onOpenDoctrineRoute: \(id: number\) => void/);
  assert.match(fitsView, /routeFitId != null/);
  assert.match(fitsView, /routeDoctrineId != null/);
  assert.match(fitsView, /onOpenFitRoute\(row\.id\)/);
  assert.match(fitsView, /onOpenFitRoute\(res\.id\)/);
  assert.match(fitsView, /onOpenDoctrineRoute\(doctrine\.id\)/);

  assert.match(doctrinesView, /routeDoctrineId: number \| null/);
  assert.match(doctrinesView, /onOpenDoctrineRoute: \(id: number\) => void/);
  assert.match(doctrinesView, /routeDoctrineId != null/);
  assert.match(doctrinesView, /onOpenDoctrineRoute\(row\.id\)/);
  assert.match(doctrinesView, /onOpenDoctrineRoute\(res\.id\)/);
});
